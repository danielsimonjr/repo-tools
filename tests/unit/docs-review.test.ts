/**
 * The review of the first `repo-tools docs` pull request, one test group for each finding. Each
 * group fails on the first version of the command, and passes on the fix. Design section 16.6 lists
 * the differences from the Python tool that these fixes make.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { analysePython } from "../../src/docs/python.ts";
import { analyseTypeScript } from "../../src/docs/typescript.ts";
import { cli, only, read, removeTrees, trackAll, tree } from "./docs-helpers.ts";

afterAll(removeTrees, 30_000);

const NO_DOC = "export function f() {}\n";

/** A committed tree. */
function repo(files: Record<string, string>): string {
  const root = tree(files);
  trackAll(root);
  return root;
}

/** True when this host lets the test make a symbolic link (Windows needs a privilege for it). */
function canLink(): boolean {
  const dir = tree({ "t.txt": "x" });
  try {
    symlinkSync(join(dir, "t.txt"), join(dir, "l.txt"));
    return true;
  } catch {
    return false;
  }
}
const CAN_LINK = canLink();

describe("review 1: stub never writes through a link", () => {
  test.skipIf(!CAN_LINK)("a link to a file outside the root is skipped", async () => {
    const outside = tree({ "secret.ts": NO_DOC });
    const root = tree({ "a.ts": "/** Returns one. */\nexport function a() {}\n" });
    symlinkSync(join(outside, "secret.ts"), join(root, "link.ts"));
    trackAll(root);
    const run = await cli(["docs", "stub", root, "--apply"]);
    expect(readFileSync(join(outside, "secret.ts"), "utf8")).toBe(NO_DOC);
    expect(run.out).toContain(
      "  SKIPPED link.ts: the path is a link, or it resolves outside the root\n",
    );
    expect(run.out).toContain("0 stub(s) planned");
  });

  test.skipIf(!CAN_LINK)("a dry run names the link and plans nothing for it", async () => {
    const outside = tree({ "secret.ts": NO_DOC });
    const root = tree({ "a.ts": "/** Returns one. */\nexport function a() {}\n" });
    symlinkSync(join(outside, "secret.ts"), join(root, "link.ts"));
    trackAll(root);
    const run = await cli(["docs", "stub", root]);
    expect(run.out).toContain(
      "  SKIPPED link.ts: the path is a link, or it resolves outside the root\n",
    );
    expect(run.out).not.toContain("would document link.ts");
  });
});

describe("review 2: a path that git quotes", () => {
  test("--paths-from decodes the octal form of a non-ASCII name", async () => {
    const root = repo({
      "src/café.ts": NO_DOC,
      "ok.ts": "/** Returns one. */\nexport function g() {}\n",
    });
    const list = tree({ "changed.txt": '"src/caf\\303\\251.ts"\n' });
    const run = await cli(["docs", "check", root, `--paths-from=${join(list, "changed.txt")}`]);
    expect(run.code).toBe(1);
    expect(run.out).toContain("src/café.ts:1 f: M1");
  });

  test("the whole-repository gate sees a non-ASCII file name", async () => {
    const run = await cli(["docs", "check", repo({ "src/café.ts": NO_DOC })]);
    expect(run.code).toBe(1);
    expect(run.out).toContain("src/café.ts:1 f: M1");
  });

  test("a quoted ASCII path loses its quotes", async () => {
    const root = repo({ "a.ts": NO_DOC });
    const list = tree({ "changed.txt": '"a.ts"\n' });
    const run = await cli(["docs", "check", root, `--paths-from=${join(list, "changed.txt")}`]);
    expect(run.code).toBe(1);
    expect(run.out).toContain("a.ts:1 f: M1");
  });
});

describe("review 3: the TypeScript stub goes above the declaration", () => {
  test("a declaration that follows the end of a template on its line is not stubbed", async () => {
    const source = "const t = `x\n`; export function f() {}\n";
    const root = repo({ "a.ts": source });
    const run = await cli(["docs", "stub", root, "--apply"]);
    expect(read(root, "a.ts")).toBe(source);
    expect(run.out).toContain(
      "  cannot place a stub for a.ts:2 f: another token precedes the declaration on its line\n",
    );
  });

  test("of two declarations on one line, the first gets the stub and the second is named", async () => {
    const root = repo({ "a.ts": "export function a() {} export function b() {}\n" });
    const run = await cli(["docs", "stub", root, "--apply"]);
    const lines = read(root, "a.ts").split("\n");
    expect(lines[0]).toBe("/**");
    expect(lines.at(-2)).toBe("export function a() {} export function b() {}");
    expect(run.out).toContain("  wrote a.ts: inserted 1 stub(s)\n");
    expect(run.out).toContain(
      "  cannot place a stub for a.ts:1 b: another token precedes the declaration on its line\n",
    );
  });
});

describe("review 4 and 5: the scope of stub", () => {
  test("stub on a root with no source file exits 1, as scan and check do", async () => {
    const run = await cli(["docs", "stub", repo({ "README.md": "# r\n" })]);
    expect(run.code).toBe(1);
    expect(run.err).toContain("nothing to measure");
  });

  test("a --path that matches no file is not an error", async () => {
    const run = await cli(["docs", "stub", repo({ "a.ts": NO_DOC }), "--path=missing"]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("0 stub(s) planned across 0 file(s)");
  });

  for (const form of [".", "./", ".//", "ROOT"]) {
    test(`--path=${form} selects the whole repository`, async () => {
      const root = repo({ "a.ts": NO_DOC, "src/b.ts": NO_DOC });
      const value = form === "ROOT" ? root : form;
      const run = await cli(["docs", "stub", root, `--path=${value}`]);
      expect(run.out).toContain("would document a.ts:1 f");
      expect(run.out).toContain("would document src/b.ts:1 f");
    });
  }
});

describe("review 6: a typed reST field", () => {
  const typed = [
    "def f(x):",
    '    """Do it.',
    "",
    "    :param int x: The value.",
    "    :param int gone: Not here.",
    '    """',
    "",
  ].join("\n");

  test("names the parameter, not the type, so a stale one is M3", async () => {
    const r = only((await analysePython("a.py", typed)).symbols);
    expect(r.dialect).toBe("rest");
    expect(r.docParams).toEqual(["x", "gone"]);
    expect(r.issues.map((i) => i.detail)).toContain(
      "documents parameter 'gone' which is not in the signature",
    );
  });

  test("a typed field alone sets the dialect, so M5 sees a mix", async () => {
    const google = 'def g(y):\n    """Do it.\n\n    Args:\n        y: The value.\n    """\n';
    const report = await analysePython("a.py", `${typed}\n${google}`);
    expect([...report.dialects].sort()).toEqual(["google", "rest"]);
  });

  test("a type with a bracket and a space still leaves the name", async () => {
    const source = 'def f(x):\n    """Do it.\n\n    :param Dict[str, int] x: The value.\n    """\n';
    expect(only((await analysePython("a.py", source)).symbols).docParams).toEqual(["x"]);
  });
});

describe("review 7: the header of a Python function", () => {
  test("a comment after the colon does not hide the colon", async () => {
    const root = repo({ "a.py": "def f():  # note\n    if True:\n        return 1\n" });
    await cli(["docs", "stub", root, "--apply"]);
    const lines = read(root, "a.py").split("\n");
    expect(lines[0]).toBe("def f():  # note");
    expect(lines[1]).toStartWith('    """TODO:');
    expect(lines.at(-3)).toBe("    if True:");
  });

  test("a bracket inside a default string does not move the insertion point", async () => {
    const root = repo({ "a.py": 'def f(\n    a="(",\n    b=1,\n):\n    return a\n' });
    const run = await cli(["docs", "stub", root, "--apply"]);
    expect(run.out).toContain("  wrote a.py: inserted 1 stub(s)\n");
    const lines = read(root, "a.py").split("\n");
    expect(lines[3]).toBe("):");
    expect(lines[4]).toStartWith('    """TODO:');
  });
});

describe("review 8: the name of a JSDoc parameter", () => {
  test("a name may hold $", async () => {
    const source =
      "/**\n * Do it.\n * @param foo$bar - A thing.\n */\nexport function f(foo$bar: string) {}\n";
    const s = only((await analyseTypeScript("a.ts", source)).symbols);
    expect(s.docParams).toEqual(["foo$bar"]);
    expect(s.dialect).toBe("tsdoc");
    expect(s.issues.filter((i) => i.rule === "M3")).toEqual([]);
  });

  test("a name in brackets is a name, with or without a default", async () => {
    const source = [
      "/**",
      " * Do it.",
      " * @param {string} [gone] - Not here.",
      " * @param {number} [kept=1] - Here.",
      " */",
      "export function f(kept) {}",
      "",
    ].join("\n");
    const s = only((await analyseTypeScript("a.js", source)).symbols);
    expect(s.docParams).toEqual(["gone", "kept"]);
    expect(s.issues.map((i) => i.detail)).toContain(
      "documents parameter 'gone' which is not in the signature",
    );
  });
});

describe("review 9: the text of the source, and the names that a pattern binds", () => {
  test("a parameter named abstract keeps its name", async () => {
    const source =
      'const x = "\u{1F600}";\n/**\n * Do it.\n * @param abstract - A flag.\n */\nexport function f(abstract: string) {}\n';
    const s = only((await analyseTypeScript("a.ts", source)).symbols);
    expect(s.params).toEqual(["abstract"]);
    expect(s.issues.filter((i) => i.rule === "M3")).toEqual([]);
  });

  test("a doc comment that holds abstract: is read as written", async () => {
    const source = "/**\n * Sets abstract: yes.\n */\nexport function f() {}\n";
    expect(only((await analyseTypeScript("a.ts", source)).symbols).summary).toBe(
      "Sets abstract: yes.",
    );
  });

  const patterns: [string, string[]][] = [
    ["{ a = fallback }", ["a"]],
    ["{ opts: { b } }", ["b"]],
    ["{ x: y = 1 }", ["y"]],
    ["{ x: [p, q = 2] }", ["p", "q"]],
    ["[a = 1, ...rest]", ["a", "rest"]],
    ["{ a, ...others }", ["a", "others"]],
    ["first, { second }", ["first", "second"]],
  ];
  for (const [pattern, names] of patterns) {
    test(`the parameter ${pattern} binds ${names.join(", ")}`, async () => {
      const source = `export function f(${pattern}) {}\n`;
      expect(only((await analyseTypeScript("a.js", source)).symbols).params).toEqual(names);
    });
  }
});
