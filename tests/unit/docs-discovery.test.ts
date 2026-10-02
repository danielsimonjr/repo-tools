/**
 * Source discovery of `repo-tools docs` (design section 16). The cases port `test_discovery.py` and
 * `test_config_exclude.py` of the code-docs skill: git is the source of the file list, a walk is
 * the named fallback, and an exclusion needs a reason.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyseFile, analyseRepo, readSourceText } from "../../src/docs/analyse.ts";
import { ConfigError, discover, languageOf } from "../../src/docs/discovery.ts";
import { git, removeTrees, trackAll, tree } from "./docs-helpers.ts";

// A removal of dozens of git work trees can pass the 5 s limit of a hook on a busy disk.
afterAll(removeTrees, 30_000);

const SRC = "export const x = 1;\n";

describe("languageOf", () => {
  test("names the language of a source path and nothing else", () => {
    expect(languageOf("a.py")).toBe("python");
    for (const name of ["a.ts", "a.tsx", "a.js", "a.jsx", "a.mjs", "a.cjs"]) {
      expect(languageOf(`src/${name}`)).toBe("typescript");
    }
    for (const name of ["a.md", "a.json", "a.rs", "Makefile", "a.pyc"]) {
      expect(languageOf(name)).toBe("");
    }
  });
});

describe("discover: a git work tree", () => {
  test("lists the tracked source files in code-unit order, with the provenance", () => {
    const root = tree({ "b.ts": SRC, "a.py": "x = 1\n", "README.md": "# r\n", "src/c.js": SRC });
    trackAll(root);
    const found = discover(root);
    expect(found.files).toEqual(["a.py", "b.ts", "src/c.js"]);
    expect(found.provenance).toBe("git ls-files");
  });

  test("skips generated output, vendored folders and generated names", () => {
    const root = tree({
      "src/a.ts": SRC,
      "dist/a.js": SRC,
      "build/a.js": SRC,
      "bundle/index.mjs": SRC,
      "node_modules/p/i.js": SRC,
      "vendor/v.py": "x = 1\n",
      "src/types.d.ts": "export {};\n",
      "src/a.min.js": SRC,
      "src/m_pb2.py": "x = 1\n",
      "src/api.g.ts": SRC,
    });
    git(root, "init", "-q", "--template=");
    git(root, "add", "-A", "-f");
    expect(discover(root).files).toEqual(["src/a.ts"]);
  });

  test("an untracked source file is named in the provenance, and is not measured", () => {
    const root = tree({ "a.ts": SRC });
    trackAll(root);
    writeFileSync(join(root, "new.ts"), SRC);
    const found = discover(root);
    expect(found.files).toEqual(["a.ts"]);
    expect(found.provenance).toBe(
      "git ls-files (1 tracked) -- WARNING: 1 untracked source file(s) were NOT measured",
    );
  });

  test("a tree where git tracks no source falls back to the untracked files, and says so", () => {
    const root = tree({ "a.ts": SRC, "README.md": "# r\n" });
    git(root, "init", "-q");
    const found = discover(root);
    expect(found.files).toEqual(["a.ts"]);
    expect(found.provenance).toBe(
      "filesystem walk -- git tracks NO source here, 1 untracked file(s) found; commit them or the gate measures nothing",
    );
  });
});

describe("discover: no git", () => {
  test("walks the folder, prunes the skipped folders, and says so", () => {
    const root = tree({ "src/a.ts": SRC, "node_modules/p/i.js": SRC, "src/b.py": "x = 1\n" });
    const found = discover(root);
    expect(found.files).toEqual(["src/a.ts", "src/b.py"]);
    expect(found.provenance).toBe(
      "filesystem walk (NOT a git repo -- may include generated files)",
    );
  });

  test("a folder with no source gives no file", () => {
    expect(discover(tree({ "README.md": "# r\n" })).files).toEqual([]);
  });

  test("a link that points nowhere is not a file", () => {
    const root = tree({ "src/a.ts": SRC });
    try {
      symlinkSync(join(root, "gone.ts"), join(root, "src", "link.ts"));
    } catch {
      return; // A link needs a privilege on some systems; nothing to test there.
    }
    expect(discover(root).files).toEqual(["src/a.ts"]);
  });
});

describe("discover: .code-docs.json", () => {
  const config = (exclude: unknown) => JSON.stringify({ exclude });

  test("excludes a folder, names the reason, and counts the files", () => {
    const root = tree({
      "src/a.ts": SRC,
      "assembly/b.ts": SRC,
      "assembly/deep/c.ts": SRC,
      ".code-docs.json": config([{ path: "assembly/", reason: "AssemblyScript" }]),
    });
    trackAll(root);
    const found = discover(root);
    expect(found.files).toEqual(["src/a.ts"]);
    expect(found.provenance).toBe(
      "git ls-files -- 2 file(s) excluded by .code-docs.json: assembly/ (AssemblyScript)",
    );
  });

  test("a prefix matches whole path segments", () => {
    const root = tree({
      "assembly/a.ts": SRC,
      "assembly_tools/b.ts": SRC,
      ".code-docs.json": config([{ path: "assembly", reason: "r" }]),
    });
    trackAll(root);
    expect(discover(root).files).toEqual(["assembly_tools/b.ts"]);
  });

  test("excludes one file by its exact path", () => {
    const root = tree({
      "a.ts": SRC,
      "b.ts": SRC,
      ".code-docs.json": config([{ path: "b.ts", reason: "generated by hand" }]),
    });
    trackAll(root);
    expect(discover(root).files).toEqual(["a.ts"]);
  });

  test("an exclusion with no reason is an error", () => {
    const root = tree({ "a.ts": SRC, ".code-docs.json": config([{ path: "a.ts" }]) });
    trackAll(root);
    expect(() => discover(root)).toThrow(ConfigError);
    expect(() => discover(root)).toThrow("exclude[0] (a.ts) needs a non-empty 'reason'");
  });

  test("a blank reason, a missing path and a bad shape are errors", () => {
    const cases: [unknown, string][] = [
      [[{ path: "a", reason: "  " }], "needs a non-empty 'reason'"],
      [[{ reason: "r" }], "exclude[0] needs a string 'path'"],
      [[{ path: "", reason: "r" }], "exclude[0] needs a string 'path'"],
      [[7], "exclude[0] needs a string 'path'"],
      ["x", "'exclude' must be an array"],
    ];
    for (const [exclude, message] of cases) {
      const root = tree({ "a.ts": SRC, ".code-docs.json": config(exclude) });
      expect(() => discover(root)).toThrow(message);
    }
  });

  test("invalid JSON and a top level that is not an object are errors", () => {
    expect(() => discover(tree({ "a.ts": SRC, ".code-docs.json": "{nope" }))).toThrow(
      ".code-docs.json: invalid JSON",
    );
    expect(() => discover(tree({ "a.ts": SRC, ".code-docs.json": "[]" }))).toThrow(
      "the top level must be an object",
    );
  });

  test("a config with no exclude key excludes nothing", () => {
    const root = tree({ "a.ts": SRC, ".code-docs.json": "{}" });
    trackAll(root);
    expect(discover(root).provenance).toBe("git ls-files");
  });
});

describe("analyseRepo and readSourceText", () => {
  test("reads each file with the analyser of its language", async () => {
    const root = tree({ "a.py": "def f():\n    pass\n", "b.ts": "export function g() {}\n" });
    trackAll(root);
    const { reports } = await analyseRepo(root);
    expect(reports.map((r) => `${r.path}:${r.language}:${r.symbols.length}`)).toEqual([
      "a.py:python:1",
      "b.ts:typescript:1",
    ]);
  });

  test("a CRLF file gives the line numbers of the file", async () => {
    const root = tree({ "a.ts": "// one\r\n// two\r\nexport function f() {}\r\n" });
    const report = await analyseFile(root, "a.ts");
    expect(report.symbols[0]?.line).toBe(3);
  });

  test("a byte order mark is removed", () => {
    const root = tree({ "a.py": new Uint8Array([0xef, 0xbb, 0xbf, 0x78, 0x0a]) });
    expect(readSourceText(join(root, "a.py"))).toBe("x\n");
  });

  test("a file that is not UTF-8 is an unparsed file with the reason", async () => {
    const root = tree({ "a.py": new Uint8Array([0xff, 0xfe, 0x00, 0x80]) });
    const report = await analyseFile(root, "a.py");
    expect(report.error).toBe("unreadable: the file is not valid UTF-8");
    expect(report.symbols).toEqual([]);
  });

  test("a tracked file that is missing from the work tree is an unparsed file", async () => {
    const root = tree({ "a.py": "x = 1\n" });
    const report = await analyseFile(root, "gone.py");
    expect(report.error).toBe("unreadable: the file is tracked but missing from the work tree");
  });
});
