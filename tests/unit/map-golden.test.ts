/**
 * `repo-tools map` equals its goldens (`tests/golden/map`): every report, the exit code and the
 * standard output, for each fixture. Rewrite the goldens with `bun scripts/update-map-goldens.ts`
 * in the commit of a named change.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { maskGolden } from "../../scripts/update-depgraph-goldens.ts";
import { MAP_GOLDEN_SETS } from "../../scripts/update-map-goldens.ts";
import { runMap } from "../../src/map/command.ts";
import { sortCodeUnits } from "../../src/sort.ts";
import { makeTempDir } from "./temp.ts";

const REPO = join(import.meta.dir, "../..");
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

describe("map equals the goldens", () => {
  for (const { set, fixture } of MAP_GOLDEN_SETS) {
    test(`${set}: every report, the exit code and the standard output`, async () => {
      const base = makeTempDir("map-golden");
      made.push(base);
      const root = join(base, fixture);
      cpSync(join(REPO, "tests/fixtures/depgraph", fixture), root, { recursive: true });
      let stdout = "";
      const code = await runMap([`--root=${root}`, "--no-extensions"], {
        stdout: (s) => {
          stdout += s;
        },
        stderr: () => {},
      });
      const golden = join(REPO, "tests/golden/map", set);
      expect(`${code}\n`).toBe(readFileSync(join(golden, "_exit-code.txt"), "utf8"));
      expect(maskGolden(stdout, root)).toBe(readFileSync(join(golden, "_stdout.txt"), "utf8"));
      const out = join(root, "docs/architecture");
      const want = sortCodeUnits(readdirSync(golden).filter((f) => !f.startsWith("_")));
      expect(sortCodeUnits(readdirSync(out))).toEqual(want);
      for (const name of want) {
        expect(maskGolden(readFileSync(join(out, name), "utf8"), root)).toBe(
          readFileSync(join(golden, name), "utf8"),
        );
      }
    });
  }
});
