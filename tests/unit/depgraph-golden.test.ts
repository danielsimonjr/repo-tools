/**
 * Characterization test of the depgraph port: each golden set must come back byte for byte.
 *
 * Fixes F2 (sorted folder listings) and F22 (code-unit sorts) make the goldens independent of
 * the operating system, so this test runs on every CI operating system. A difference between
 * Linux, macOS and Windows is a determinism defect.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/depgraph/index.ts";
import { sortCodeUnits } from "../../src/sort.ts";

const repo = join(import.meta.dir, "../..");
const golden = join(repo, "tests/golden/depgraph");
const work = mkdtempSync(join(tmpdir(), "repo-tools-golden-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** The masking of the golden README: date-times, dates and the fixture root. */
function mask(text: string, root: string): string {
  return text
    .split(root)
    .join("<ROOT>")
    .split(root.replace(/\\/g, "/"))
    .join("<ROOT>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<DATETIME>")
    .replace(/\d{4}-\d{2}-\d{2}/g, "<DATE>");
}

const sets = [
  { set: "mini-repo/default", fixture: "mini-repo", flags: [] },
  { set: "mini-repo/all", fixture: "mini-repo", flags: ["--all"] },
  { set: "mono-repo/default", fixture: "mono-repo", flags: [] },
  { set: "mono-repo/all", fixture: "mono-repo", flags: ["--all"] },
];

describe("depgraph port equals the goldens", () => {
  for (const { set, fixture, flags } of sets) {
    test(`${set}: every report and the exit code`, async () => {
      const root = join(work, set.replace("/", "-"));
      cpSync(join(repo, "tests/fixtures/depgraph", fixture), root, { recursive: true });
      let stdout = "";
      const code = await run([`--root=${root}`, ...flags], {
        stdout: (s) => {
          stdout += s;
        },
        stderr: () => {},
      });

      const expectedDir = join(golden, set);
      expect(`${code}\n`).toBe(readFileSync(join(expectedDir, "_exit-code.txt"), "utf8"));
      const outDir = join(root, "docs/architecture");
      const reports = sortCodeUnits(readdirSync(expectedDir).filter((f) => !f.startsWith("_")));
      expect(sortCodeUnits(readdirSync(outDir))).toEqual(reports);
      for (const name of reports) {
        const actual = mask(readFileSync(join(outDir, name), "utf8"), root);
        expect({ name, text: actual }).toEqual({
          name,
          text: readFileSync(join(expectedDir, name), "utf8"),
        });
      }
      // Standard output names no absolute path, in either separator form, and equals the port's
      // own stdout golden. `_stdout.txt` is the pre-port reference, which held the root.
      expect(stdout).not.toContain(root);
      expect(stdout).not.toContain(root.replace(/\\/g, "/"));
      expect(mask(stdout, root)).toBe(readFileSync(join(expectedDir, "_stdout.port.txt"), "utf8"));
    });
  }
});
