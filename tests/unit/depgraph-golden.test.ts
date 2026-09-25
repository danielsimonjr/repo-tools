/**
 * Characterization test of the depgraph port: each golden set must come back byte for byte.
 *
 * Fixes F2 (sorted folder listings) and F22 (code-unit sorts) make the goldens independent of
 * the operating system, so this test runs on every CI operating system. A difference between
 * Linux, macOS and Windows is a determinism defect.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GOLDEN_FLAGS, GOLDEN_SETS, maskGolden } from "../../scripts/update-depgraph-goldens.ts";
import { run } from "../../src/depgraph/index.ts";
import { sortCodeUnits } from "../../src/sort.ts";
import { makeTempDir } from "./temp.ts";

const repo = join(import.meta.dir, "../..");
const golden = join(repo, "tests/golden/depgraph");
const work = makeTempDir("golden");
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** One depgraph run on a fresh copy of a fixture: exit code, stdout and every report. */
interface GoldenRun {
  root: string;
  code: number;
  stdout: string;
  reports: Map<string, Buffer>;
}

/**
 * Runs the golden flags on a fresh copy of `fixture` in `root`. The copy also gets a config file
 * with an extension that throws: the golden runs use `--no-extensions` (design 13.2), so the
 * extension must not load.
 */
async function goldenRun(root: string, fixture: string, flags: string[]): Promise<GoldenRun> {
  cpSync(join(repo, "tests/fixtures/depgraph", fixture), root, { recursive: true });
  mkdirSync(join(root, "ext"), { recursive: true });
  writeFileSync(
    join(root, "ext/throws.mjs"),
    "export default { name: 'throws', preflight() { throw new Error('loaded'); } };\n",
  );
  writeFileSync(
    join(root, "repo-tools.config.json"),
    JSON.stringify({ depgraph: { extensions: ["ext/throws.mjs"] } }),
  );
  let stdout = "";
  const code = await run([`--root=${root}`, ...GOLDEN_FLAGS, ...flags], {
    stdout: (s) => {
      stdout += s;
    },
    stderr: () => {},
  });
  const outDir = join(root, "docs/architecture");
  const reports = new Map<string, Buffer>();
  for (const name of sortCodeUnits(readdirSync(outDir))) {
    reports.set(name, readFileSync(join(outDir, name)));
  }
  return { root, code, stdout, reports };
}

describe("depgraph port equals the goldens", () => {
  for (const { set, fixture, flags } of GOLDEN_SETS) {
    test(`${set}: every report and the exit code`, async () => {
      const first = await goldenRun(join(work, `${set.replace("/", "-")}-1`), fixture, flags);
      const { root, code, stdout } = first;

      const expectedDir = join(golden, set);
      expect(`${code}\n`).toBe(readFileSync(join(expectedDir, "_exit-code.txt"), "utf8"));
      const reports = sortCodeUnits(readdirSync(expectedDir).filter((f) => !f.startsWith("_")));
      expect([...first.reports.keys()]).toEqual(reports);
      for (const name of reports) {
        const actual = maskGolden(String(first.reports.get(name)), root);
        expect({ name, text: actual }).toEqual({
          name,
          text: readFileSync(join(expectedDir, name), "utf8"),
        });
      }
      // Standard output names no absolute path, in either separator form, and equals the port's
      // own stdout golden. `_stdout.txt` is the pre-port reference, which held the root.
      expect(stdout).not.toContain(root);
      expect(stdout).not.toContain(root.replace(/\\/g, "/"));
      expect(maskGolden(stdout, root)).toBe(
        readFileSync(join(expectedDir, "_stdout.port.txt"), "utf8"),
      );
    });

    test(`${set}: a second run is byte-identical to the first (design 13.4)`, async () => {
      const a = await goldenRun(join(work, `${set.replace("/", "-")}-a`), fixture, flags);
      const b = await goldenRun(join(work, `${set.replace("/", "-")}-b`), fixture, flags);
      expect(b.code).toBe(a.code);
      expect(b.stdout).toBe(a.stdout);
      expect([...b.reports.keys()]).toEqual([...a.reports.keys()]);
      for (const [name, bytes] of a.reports) {
        expect({ name, same: b.reports.get(name)?.equals(bytes) }).toEqual({ name, same: true });
      }
    });
  }
});
