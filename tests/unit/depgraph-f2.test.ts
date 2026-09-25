/**
 * Fix F2: the walks sort each folder listing, so the output does not depend on the order that
 * the file system returns. A reversed reader must give the same bytes as the normal reader.
 */
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { cpSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readdirHook } from "../../src/depgraph/dirlist.ts";
import { run } from "../../src/depgraph/index.ts";
import { makeTempDir } from "./temp.ts";

const repo = join(import.meta.dir, "../..");
const work = makeTempDir("f2");
afterAll(() => rmSync(work, { recursive: true, force: true }));

const normal = { ...readdirHook };
afterEach(() => Object.assign(readdirHook, normal));

/** Runs depgraph on a fresh copy of `fixture`; returns the exit code, stdout and every report. */
async function snapshot(fixture: string, flags: string[], tag: string) {
  const root = join(work, `${fixture}-${tag}`);
  cpSync(join(repo, "tests/fixtures/depgraph", fixture), root, { recursive: true });
  let stdout = "";
  const code = await run([`--root=${root}`, ...flags], {
    stdout: (s) => {
      stdout += s;
    },
    stderr: () => {},
  });
  const out = join(root, "docs/architecture");
  const files: Record<string, string> = {};
  for (const name of readdirSync(out)) {
    // Dates differ between runs until fix F1; they are not what this test is about.
    files[name] = readFileSync(join(out, name), "utf8").replace(
      /\d{4}-\d{2}-\d{2}[T\d:.Z]*/g,
      "<D>",
    );
  }
  return { code, stdout, files };
}

describe("F2: the output does not depend on the folder listing order", () => {
  for (const [fixture, flags] of [
    ["mini-repo", []],
    ["mini-repo", ["--all"]],
    ["mono-repo", []],
    ["mono-repo", ["--all"]],
  ] as const) {
    test(`${fixture} ${flags.join(" ") || "(default)"}`, async () => {
      const forward = await snapshot(fixture, [...flags], "fwd");
      readdirHook.names = (dir) => normal.names(dir).reverse();
      readdirHook.entries = (dir) => normal.entries(dir).reverse();
      const reversed = await snapshot(fixture, [...flags], "rev");
      expect(reversed.code).toBe(forward.code);
      expect(reversed.stdout).toBe(forward.stdout);
      expect(Object.keys(reversed.files).sort()).toEqual(Object.keys(forward.files).sort());
      for (const name of Object.keys(forward.files)) {
        expect({ name, text: reversed.files[name] }).toEqual({ name, text: forward.files[name] });
      }
    });
  }
});
