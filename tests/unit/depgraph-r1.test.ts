/**
 * Rule R1: every file that depgraph writes ends with exactly one LF. The pre-port generator
 * wrote JSON with no trailing newline and two Markdown reports with two.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/depgraph/index.ts";
import { makeTempDir } from "./temp.ts";

const repo = join(import.meta.dir, "../..");
const work = makeTempDir("r1");
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** Returns "LF" for one trailing LF, else a short name of the defect. */
function ending(text: string): string {
  if (text.endsWith("\n\n")) return "more than one LF";
  return text.endsWith("\n") ? "LF" : "no LF";
}

describe("R1: every report ends with exactly one LF", () => {
  for (const [set, fixture, flags] of [
    ["mini-repo/default", "mini-repo", []],
    ["mini-repo/all", "mini-repo", ["--all"]],
    ["mono-repo/default", "mono-repo", []],
    ["mono-repo/all", "mono-repo", ["--all"]],
  ] as const) {
    test(`${set}: the written reports`, async () => {
      const root = join(work, set.replace("/", "-"));
      cpSync(join(repo, "tests/fixtures/depgraph", fixture), root, { recursive: true });
      await run([`--root=${root}`, ...flags], { stdout: () => {}, stderr: () => {} });
      const out = join(root, "docs/architecture");
      const names = readdirSync(out);
      expect(names.length).toBeGreaterThan(9);
      for (const name of names) {
        expect({ name, ending: ending(readFileSync(join(out, name), "utf8")) }).toEqual({
          name,
          ending: "LF",
        });
      }
    });

    test(`${set}: the committed goldens`, () => {
      const dir = join(repo, "tests/golden/depgraph", set);
      for (const name of readdirSync(dir).filter((n) => !n.startsWith("_"))) {
        expect({ name, ending: ending(readFileSync(join(dir, name), "utf8")) }).toEqual({
          name,
          ending: "LF",
        });
      }
    });
  }
});
