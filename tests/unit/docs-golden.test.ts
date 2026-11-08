/**
 * `repo-tools docs` equals its goldens (`tests/golden/docs`): the report files, the output of
 * `scan`, of a dry-run `stub` and of `stub --apply`, and every source file after the apply. Rewrite
 * the goldens with `bun scripts/update-docs-goldens.ts` in the commit of a named change.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { DOCS_GOLDEN_FIXTURES, docsGolden } from "../../scripts/update-docs-goldens.ts";

const GOLDEN = join(import.meta.dir, "../golden/docs");

/** The POSIX relative path of every file below `dir`, sorted. */
function filesBelow(dir: string, base = dir): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...filesBelow(path, base));
    else found.push(relative(base, path).replace(/\\/g, "/"));
  }
  return found.sort();
}

describe("docs equals the goldens", () => {
  for (const fixture of DOCS_GOLDEN_FIXTURES) {
    test(`${fixture}: reports, output of each action, and the stubbed sources`, async () => {
      const got = await docsGolden(fixture);
      const dir = join(GOLDEN, fixture);
      expect(Object.keys(got).sort()).toEqual(filesBelow(dir));
      for (const [name, text] of Object.entries(got)) {
        expect(`${name}\n${text}`).toBe(`${name}\n${readFileSync(join(dir, name), "utf8")}`);
      }
    });
  }
});
