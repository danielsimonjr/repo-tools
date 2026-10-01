/**
 * Guard: no file under `src/`, `tests/` or `scripts/` holds a literal U+FEFF, the byte-order
 * mark. The character is invisible in an editor, in a diff and in a review. A source file
 * spells it as an escape sequence, and a test that needs the character builds it at run time.
 *
 * The scan reads bytes. A text decoder drops a leading mark, and a pattern on decoded text
 * depends on the locale of the tool that runs it. The first test is the control: it proves that
 * the scan finds a mark, at the start of a file and inside one, before the second test relies on
 * an empty answer.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { makeTempDir } from "./temp.ts";

/** The UTF-8 bytes of U+FEFF. */
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** The folders that the guard covers, relative to the root of the repository. */
const GUARDED = ["src", "tests", "scripts"];

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** Returns the files below the `dirs` of `base` that hold the bytes of U+FEFF, sorted. */
function filesWithLiteralBom(base: string, dirs: readonly string[]): string[] {
  const found: string[] = [];
  for (const dir of dirs) {
    for (const entry of readdirSync(join(base, dir), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      if (readFileSync(path).includes(BOM)) found.push(relative(base, path).replaceAll("\\", "/"));
    }
  }
  return found.sort();
}

describe("no literal U+FEFF in the guarded folders", () => {
  test("the scan finds a mark inside a file and at the start of a file, and no other file", () => {
    const base = makeTempDir("no-bom");
    made.push(base);
    const files: Record<string, Buffer> = {
      "src/clean.ts": Buffer.from("export const a = 1;\n"),
      "src/inside.ts": Buffer.concat([Buffer.from("const s = '"), BOM, Buffer.from("';\n")]),
      "tests/unit/leading.ts": Buffer.concat([BOM, Buffer.from("export {};\n")]),
      "scripts/clean.ts": Buffer.from("export {};\n"),
    };
    for (const [rel, data] of Object.entries(files)) {
      mkdirSync(dirname(join(base, rel)), { recursive: true });
      writeFileSync(join(base, rel), data);
    }
    expect(filesWithLiteralBom(base, GUARDED)).toEqual(["src/inside.ts", "tests/unit/leading.ts"]);
  });

  test("no file under src, tests or scripts holds one", () => {
    const root = join(import.meta.dir, "../..");
    expect(filesWithLiteralBom(root, GUARDED)).toEqual([]);
  });
});
