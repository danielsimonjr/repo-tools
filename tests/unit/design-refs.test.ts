/**
 * The check for dangling references to the design document (`scripts/design-refs.ts`): which
 * headings define a section number, which text is a reference, which files are read, and that
 * this repository has no dangling reference.
 *
 * The test text builds each reference from a variable, so the scan of this file finds no
 * reference in it.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  danglingReferences,
  findReferences,
  headingsOf,
  scanRepository,
} from "../../scripts/design-refs.ts";
import { makeTempDir } from "./temp.ts";

const D = "design";
const work = makeTempDir("design-refs");
afterAll(() => rmSync(work, { recursive: true, force: true }));

function git(cwd: string, ...args: string[]): void {
  const run = Bun.spawnSync(
    ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...args],
    { cwd },
  );
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`);
}

describe("headingsOf", () => {
  test("reads the number of a section and of a subsection", () => {
    const text = ["# Title", "## 1. Purpose", "### 14.1 Modules", "#### 3.2.1 Deep"].join("\n");
    expect([...headingsOf(text)].sort()).toEqual(["1", "14.1", "3.2.1"]);
  });

  test("ignores a heading with no number, a number in a paragraph and the title", () => {
    const text = ["# 5. The title", "## Notes", "1. A list item", "See 7.2 for more."].join("\n");
    expect(headingsOf(text).size).toBe(0);
  });

  test("reads a heading with CRLF line ends", () => {
    expect([...headingsOf("## 2. Distribution\r\n### 2.1 Forms\r\n")].sort()).toEqual(["2", "2.1"]);
  });
});

describe("findReferences", () => {
  const sections = (text: string): string[] => findReferences(text).map((r) => r.section);

  test("finds a number, with or without the word section, in any case", () => {
    expect(sections(`(${D} 11.4)`)).toEqual(["11.4"]);
    expect(sections(`(${D} section 3.5)`)).toEqual(["3.5"]);
    expect(sections(`Design sections 15`)).toEqual(["15"]);
    expect(sections(`${D.toUpperCase()} 6.2`)).toEqual(["6.2"]);
  });

  test("finds the numbers of a list, a range and an and", () => {
    expect(sections(`(${D} 11.3, 11.4)`)).toEqual(["11.3", "11.4"]);
    expect(sections(`${D} 11.1-11.3`)).toEqual(["11.1", "11.3"]);
    expect(sections(`${D} 11.1 and 11.2`)).toEqual(["11.1", "11.2"]);
  });

  test("does not read a step number as a section", () => {
    expect(sections(`${D} 13.3 steps 1-5 and 7`)).toEqual(["13.3"]);
    expect(sections(`${D} 13.3 step 4`)).toEqual(["13.3"]);
    expect(sections(`${D} 13.3 steps 2, 3 and 7`)).toEqual(["13.3"]);
  });

  test("does not read a version number, a decision name or the word alone", () => {
    expect(sections(`the ${D} 2.0.0 engine`)).toEqual([]);
    expect(sections(`(${D} decision D8)`)).toEqual([]);
    expect(sections(`the ${D} of the tool`)).toEqual([]);
    expect(sections(`${D}s 3.5`)).toEqual([]);
  });

  test("ends a reference at the full stop of a sentence", () => {
    expect(sections(`It holds no token (${D} 11.4).`)).toEqual(["11.4"]);
    expect(sections(`The rule is in ${D} 11.4.`)).toEqual(["11.4"]);
  });

  test("gives the line number of each reference, from 1", () => {
    const text = `first\nsee ${D} 4.1\r\nthird\n${D} 5.2, 5.3`;
    expect(findReferences(text)).toEqual([
      { line: 2, section: "4.1" },
      { line: 4, section: "5.2" },
      { line: 4, section: "5.3" },
    ]);
  });
});

describe("danglingReferences", () => {
  const headings = new Set(["3", "11", "11.4"]);

  test("reports the references that no heading defines, with file and line", () => {
    const files = [
      { path: "src/a.ts", text: `// ${D} 11.4\n// ${D} 11.3\n` },
      { path: "src/b.ts", text: `// ${D} section 3\n// ${D} 3.5\n` },
    ];
    expect(danglingReferences(files, headings)).toEqual([
      { file: "src/a.ts", line: 2, section: "11.3" },
      { file: "src/b.ts", line: 2, section: "3.5" },
    ]);
  });

  test("reads no history file and no file that is not text", () => {
    const text = `${D} 99.9`;
    const files = [
      { path: "CHANGELOG.md", text },
      { path: "todo.md", text },
      { path: "tests/fixtures/golden.json", text },
      { path: "src/c.ts", text },
    ];
    expect(danglingReferences(files, headings).map((r) => r.file)).toEqual(["src/c.ts"]);
  });
});

describe("scanRepository", () => {
  test("reads tracked and untracked files, and not an ignored or a deleted file", () => {
    const root = join(work, "repo");
    const put = (path: string, text: string): void => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    mkdirSync(root, { recursive: true });
    git(root, "init", "-q");
    put("docs/design.md", "# Design\n\n## 1. Purpose\n\n### 1.1 Goal\n");
    put("src/tracked.ts", `// ${D} 1.1\n// ${D} 7.7\n`);
    put("src/gone.ts", `// ${D} 6.6\n`);
    put(".gitignore", "ignored.ts\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "init");
    rmSync(join(root, "src/gone.ts"));
    put("src/untracked.ts", `// ${D} 8.8\n`);
    put("ignored.ts", `// ${D} 9.9\n`);
    expect(scanRepository(root)).toEqual([
      { file: "src/tracked.ts", line: 2, section: "7.7" },
      { file: "src/untracked.ts", line: 1, section: "8.8" },
    ]);
  });
});

describe("this repository", () => {
  test("has no reference to a section that docs/design.md lacks", () => {
    const found = scanRepository(resolve(import.meta.dir, "../.."));
    expect(found.map((r) => `${r.file}:${r.line}: ${r.section}`)).toEqual([]);
  });
});
