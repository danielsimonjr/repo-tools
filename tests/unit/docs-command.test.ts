/**
 * `repo-tools docs` (design section 16), end to end: the exit code and the text of each outcome,
 * with a real git repository. The cases port `test_code_docs.py`, `test_diff_scoped_gate.py` and
 * `test_stub.py` of the code-docs skill, then add the usage errors and the masking.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STUB_MARKER } from "../../src/docs/model.ts";
import { cli, read, removeTrees, trackAll, tree } from "./docs-helpers.ts";

// A removal of dozens of git work trees can pass the 5 s limit of a hook on a busy disk.
afterAll(removeTrees, 30_000);

const DOC = "/** Returns one. */\nexport function f() {}\n";
const NO_DOC = "export function f() {}\n";

/** A committed tree. */
function repo(files: Record<string, string | Uint8Array>): string {
  const root = tree(files);
  trackAll(root);
  return root;
}

describe("docs: help and usage errors", () => {
  test("--help prints the usage and exits 0", async () => {
    const run = await cli(["docs", "--help"]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("\nUsage: repo-tools docs scan  [root] [--out=<dir>]\n");
    expect(run.out).toContain("M5  A file uses one doc dialect only");
    expect(run.err).toBe("");
  });

  test("the top-level help lists the docs subcommand", async () => {
    const run = await cli(["--help"]);
    expect(run.out).toContain("docs");
  });

  test("no action and an unknown action are usage errors", async () => {
    const none = await cli(["docs"]);
    expect(none.code).toBe(2);
    expect(none.err).toContain("an action is required");
    const bad = await cli(["docs", "mend"]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("unknown action 'mend'");
  });

  const root = (): string => repo({ "a.ts": DOC });
  const cases: [string[], string][] = [
    [["scan", "--apply"], "flag --apply applies to 'stub' only"],
    [["stub", "--paths", "a.ts"], "flag --paths applies to 'check' only"],
    [["check", "--out", "x"], "flag --out applies to 'scan' only"],
    [["check", "--bogus"], "unknown flag '--bogus'"],
    [["scan", "--out"], "flag --out needs a value"],
    [["stub", "--apply=1"], "flag --apply takes no value"],
    [["check", "--paths", "a.ts", "--paths-from=x.txt"], "use --paths or --paths-from, not both"],
  ];
  for (const [args, message] of cases) {
    test(`${args.join(" ")} is a usage error`, async () => {
      const run = await cli(["docs", args[0] as string, root(), ...args.slice(1)]);
      expect(run.code).toBe(2);
      expect(run.err).toContain(message);
    });
  }

  test("the root set twice is a usage error", async () => {
    const run = await cli(["docs", "check", root(), `--root=${root()}`]);
    expect(run.code).toBe(2);
    expect(run.err).toContain("the root is set twice");
  });

  test("a root that is not a folder exits 2", async () => {
    const run = await cli(["docs", "check", join(root(), "missing")]);
    expect(run.code).toBe(2);
    expect(run.err).toContain("is not an existing directory");
  });

  test("a malformed .code-docs.json exits 2", async () => {
    const run = await cli(["docs", "check", repo({ "a.ts": DOC, ".code-docs.json": "{nope" })]);
    expect(run.code).toBe(2);
    expect(run.err).toContain(".code-docs.json: invalid JSON");
  });
});

describe("docs check: the gate on the whole repository", () => {
  test("passes a documented repository, with the exact text", async () => {
    const run = await cli(["docs", "check", repo({ "a.ts": DOC })]);
    expect(run.code).toBe(0);
    expect(run.out).toBe(
      "checked 1 file(s) via git ls-files\nPASS -- 1/1 exported symbols documented, 0 MUST issues\n",
    );
  });

  test("the root may be given with --root", async () => {
    const run = await cli(["docs", "check", `--root=${repo({ "a.ts": DOC })}`]);
    expect(run.code).toBe(0);
  });

  test("fails on an undocumented exported symbol with M1", async () => {
    const run = await cli(["docs", "check", repo({ "a.ts": NO_DOC })]);
    expect(run.code).toBe(1);
    expect(run.out).toBe(
      "checked 1 file(s) via git ls-files\nFAIL -- 1 MUST issue(s):\n  a.ts:1 f: M1 exported symbol has no doc comment\n",
    );
  });

  test("a SHOULD issue is reported and does not gate", async () => {
    const run = await cli([
      "docs",
      "check",
      repo({ "a.ts": "/** Returns one */\nexport function f() {}\n" }),
    ]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("PASS -- 1/1 exported symbols documented, 0 MUST issues\n");
    expect(run.out).toContain("  (1 SHOULD issue(s) reported, not gated)\n");
  });

  test("fails on a file with two dialects (M5), and names them as Python lists them", async () => {
    const src = [
      "/**\n * Do it.\n * @param {string} x - A thing.\n */\nexport function a(x) {}\n",
      "/**\n * Do it.\n * @param x - A thing.\n */\nexport function b(x) {}\n",
    ].join("\n");
    const run = await cli(["docs", "check", repo({ "a.js": src })]);
    expect(run.code).toBe(1);
    expect(run.out).toContain("  a.js: M5 mixed docstring dialects ['jsdoc', 'tsdoc']\n");
  });

  test("fails on a file that does not parse, and never counts it as clean", async () => {
    const run = await cli(["docs", "check", repo({ "ok.ts": DOC, "bad.py": "def broken(:\n" })]);
    expect(run.code).toBe(1);
    expect(run.out).toContain("  bad.py: UNPARSED -- SyntaxError: invalid syntax at line 1\n");
  });

  test("fails on a stale parameter (M3) and on a stub marker (M4)", async () => {
    const src = `/**\n * ${STUB_MARKER} say it.\n * @param gone - Not here.\n */\nexport function f(x: number) {}\n`;
    const run = await cli(["docs", "check", repo({ "a.ts": src })]);
    expect(run.code).toBe(1);
    expect(run.out).toContain(
      "a.ts:5 f: M3 documents parameter 'gone' which is not in the signature",
    );
    expect(run.out).toContain("a.ts:5 f: M4 unfilled stub marker left by `stub`");
  });

  test("prints the first 100 failures and counts the rest", async () => {
    const lines = Array.from({ length: 105 }, (_, i) => `export function f${i}() {}`);
    const run = await cli(["docs", "check", repo({ "a.ts": `${lines.join("\n")}\n` })]);
    expect(run.code).toBe(1);
    expect(run.out).toContain("FAIL -- 105 MUST issue(s):\n");
    expect(run.out).toContain("  ... and 5 more (TRUNCATED)\n");
    expect(run.out.split("\n").filter((l) => l.startsWith("  a.ts:"))).toHaveLength(100);
  });

  test("a repository with no source file fails: nothing was measured", async () => {
    const run = await cli(["docs", "check", repo({ "README.md": "# r\n" })]);
    expect(run.code).toBe(1);
    expect(run.err).toContain("nothing to measure. This is a failure, not a pass");
  });

  // The Python tool counts the exported symbols of a test file in the denominator and exempts them
  // from M1 only, so the figure is 1/2 here and the gate still passes. The port keeps that rule.
  test("a test file is exempt from M1 but its exports stay in the denominator", async () => {
    const run = await cli(["docs", "check", repo({ "a.ts": DOC, "tests/a.test.ts": NO_DOC })]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("PASS -- 1/2 exported symbols documented, 0 MUST issues");
  });

  test(".code-docs.json removes an excluded folder and the output names it", async () => {
    const files = {
      "a.ts": DOC,
      "gen/b.ts": NO_DOC,
      ".code-docs.json": JSON.stringify({ exclude: [{ path: "gen/", reason: "generated" }] }),
    };
    const run = await cli(["docs", "check", repo(files)]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("-- 1 file(s) excluded by .code-docs.json: gen/ (generated)");
  });
});

describe("docs check --paths: the gate on the changed files", () => {
  const files = { "good.ts": DOC, "bad.ts": NO_DOC, "other.py": "def p():\n    pass\n" };

  test("passes when the changed files are clean, whatever the rest holds", async () => {
    const run = await cli(["docs", "check", repo(files), "--paths", "good.ts"]);
    expect(run.code).toBe(0);
    expect(run.out).toBe(
      "checked 1 changed source file(s) of 3 tracked (git ls-files)\nPASS -- 0 MUST issue(s) in the changed files\n",
    );
  });

  test("fails when a changed file holds a MUST issue", async () => {
    const run = await cli(["docs", "check", repo(files), "--paths", "good.ts", "bad.ts"]);
    expect(run.code).toBe(1);
    expect(run.out).toContain("FAIL -- 1 MUST issue(s):\n  bad.ts:1 f: M1");
  });

  test("an empty list checks nothing and passes", async () => {
    const run = await cli(["docs", "check", repo(files), "--paths"]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("checked 0 changed source file(s) of 3 tracked");
  });

  test("an empty list in a repository with no source still passes", async () => {
    const run = await cli(["docs", "check", repo({ "README.md": "# r\n" }), "--paths"]);
    expect(run.code).toBe(0);
  });

  test("a leading ./ and an absolute path name the same file", async () => {
    const root = repo(files);
    const dot = await cli(["docs", "check", root, "--paths", "./bad.ts"]);
    expect(dot.code).toBe(1);
    const abs = await cli(["docs", "check", root, "--paths", join(root, "bad.ts")]);
    expect(abs.code).toBe(1);
  });

  test("a non-source path is ignored, and an unmeasured source path is named in a note", async () => {
    const root = repo(files);
    const run = await cli(["docs", "check", root, "--paths", "README.md", "gone.ts"]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("note: 1 requested source path(s) were not measured");
    expect(run.out).toContain("gone.ts");
    expect(run.out).not.toContain("README.md");
  });

  test("--paths-from reads one path on each line", async () => {
    const root = repo(files);
    const list = join(tree({}), "paths.txt");
    writeFileSync(list, "good.ts\r\n\r\n  bad.ts  \n");
    const run = await cli(["docs", "check", root, `--paths-from=${list}`]);
    expect(run.code).toBe(1);
    expect(run.out).toContain("checked 2 changed source file(s) of 3 tracked");
  });

  test("an unreadable --paths-from file is a usage error", async () => {
    const run = await cli(["docs", "check", repo(files), "--paths-from=/no/such/file.txt"]);
    expect(run.code).toBe(2);
    expect(run.err).toContain("cannot read the paths file file.txt as UTF-8 text");
  });
});

describe("docs scan: the report", () => {
  test("writes COVERAGE.md and coverage.json, and prints the totals", async () => {
    const root = repo({ "a.ts": DOC, "b.ts": NO_DOC });
    const run = await cli(["docs", "scan", root]);
    expect(run.code).toBe(0);
    expect(run.out).toBe(
      [
        "scanned 2 file(s) via git ls-files",
        "  exported symbols   : 2",
        "  documented         : 1 (50.0%)",
        "  MUST issues        : 1",
        "  SHOULD issues      : 0",
        "wrote <root>/docs/code-docs/COVERAGE.md",
        "wrote <root>/docs/code-docs/coverage.json",
        "",
      ].join("\n"),
    );
    const json = JSON.parse(read(root, "docs/code-docs/coverage.json"));
    expect(json.summary).toMatchObject({
      files_scanned: 2,
      exported_symbols: 2,
      exported_documented: 1,
      exported_documented_pct: 50,
      must_issues: 1,
    });
    expect(json.provenance).toBe("git ls-files");
  });

  test("the totals of the Markdown, the JSON and the console agree", async () => {
    const root = repo({ "a.ts": DOC, "b.ts": NO_DOC, "c.py": "def p():\n    pass\n" });
    await cli(["docs", "scan", root]);
    const md = read(root, "docs/code-docs/COVERAGE.md");
    const json = JSON.parse(read(root, "docs/code-docs/coverage.json"));
    const fromFiles = json.files.flatMap(
      (f: { symbols: { exported: boolean; has_doc: boolean }[] }) => f.symbols,
    );
    const exported = fromFiles.filter((s: { exported: boolean }) => s.exported);
    expect(json.summary.exported_symbols).toBe(exported.length);
    expect(json.summary.exported_documented).toBe(
      exported.filter((s: { has_doc: boolean }) => s.has_doc).length,
    );
    expect(md).toContain(`- exported_symbols: ${json.summary.exported_symbols}`);
    expect(md).toContain(`- exported_documented: ${json.summary.exported_documented}`);
    expect(md).toContain(`- must_issues: ${json.summary.must_issues}`);
    expect(md).toContain("- discovery: git ls-files");
    expect(md).toContain("| `b.ts` | 1 | `f` | M1 |");
  });

  test("both files end with one line feed and hold no carriage return", async () => {
    const root = repo({ "a.ts": DOC });
    await cli(["docs", "scan", root]);
    for (const name of ["COVERAGE.md", "coverage.json"]) {
      const text = readFileSync(join(root, "docs/code-docs", name), "utf8");
      expect(text.endsWith("\n")).toBe(true);
      expect(text.endsWith("\n\n")).toBe(false);
      expect(text).not.toContain("\r");
    }
  });

  test("--out sets the folder", async () => {
    const root = repo({ "a.ts": DOC });
    const out = join(tree({}), "reports");
    const run = await cli(["docs", "scan", root, `--out=${out}`]);
    expect(run.code).toBe(0);
    expect(readFileSync(join(out, "coverage.json"), "utf8")).toContain('"files_scanned": 1');
    expect(run.out).toContain(`wrote ${out}`);
  });

  test("an unparsed file is counted and named, and the exit code stays 0", async () => {
    const root = repo({ "a.ts": DOC, "bad.py": "def broken(:\n" });
    const run = await cli(["docs", "scan", root]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("  UNPARSED (unknown) : 1  <- not counted as clean\n");
    const md = read(root, "docs/code-docs/COVERAGE.md");
    expect(md).toContain("## Unparsed files");
    expect(md).toContain("- `bad.py` -- SyntaxError: invalid syntax at line 1");
  });

  test("an empty repository fails: nothing was measured", async () => {
    const run = await cli(["docs", "scan", repo({ "README.md": "# r\n" })]);
    expect(run.code).toBe(1);
    expect(run.err).toContain("nothing to measure");
  });
});

describe("docs stub", () => {
  test("a dry run changes no file and lists what it would document", async () => {
    const root = repo({ "a.ts": NO_DOC, "b.py": "def g(x):\n    return x\n" });
    const before = [read(root, "a.ts"), read(root, "b.py")];
    const run = await cli(["docs", "stub", root]);
    expect(run.code).toBe(0);
    expect(run.out).toBe(
      [
        "  would document a.ts:1 f",
        "  would document b.py:2 g",
        "DRY RUN (pass --apply to write): 2 stub(s) planned across 2 file(s); 0 file(s) modified",
        "Every stub carries a TODO: marker, which `check` FAILS on -- fill them in.",
        "",
      ].join("\n"),
    );
    expect([read(root, "a.ts"), read(root, "b.py")]).toEqual(before);
  });

  test("--apply writes the stubs; the files still parse; check then fails on M4 only", async () => {
    const root = repo({ "a.ts": NO_DOC, "b.py": "def g(x):\n    return x\n" });
    const run = await cli(["docs", "stub", root, "--apply"]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("  wrote a.ts: inserted 1 stub(s)\n");
    expect(run.out).toContain("  wrote b.py: inserted 1 stub(s)\n");
    expect(run.out).toContain("APPLIED: 2 stub(s) planned across 2 file(s); 2 file(s) modified\n");
    expect(read(root, "a.ts")).toContain(STUB_MARKER);
    const gate = await cli(["docs", "check", root]);
    expect(gate.code).toBe(1);
    const rules = gate.out.match(/: (M\d) /g)?.map((m) => m.slice(2, 4));
    expect(rules).toEqual(["M4", "M4"]);
  });

  test("a second apply plans nothing", async () => {
    const root = repo({ "a.ts": NO_DOC });
    await cli(["docs", "stub", root, "--apply"]);
    const again = await cli(["docs", "stub", root, "--apply"]);
    expect(again.out).toBe("APPLIED: 0 stub(s) planned across 1 file(s); 0 file(s) modified\n");
  });

  test("a test file and a private symbol get no stub", async () => {
    const root = repo({
      "tests/a.test.ts": NO_DOC,
      "p.py": "def _hidden():\n    pass\n",
      "ok.ts": DOC,
    });
    const run = await cli(["docs", "stub", root]);
    expect(run.out).toStartWith("DRY RUN (pass --apply to write): 0 stub(s)");
    expect(run.out).not.toContain("Every stub carries");
  });

  test("--path limits the stubs to one file or one folder", async () => {
    const root = repo({ "a.ts": NO_DOC, "src/b.ts": NO_DOC, "src/c.ts": NO_DOC });
    const one = await cli(["docs", "stub", root, "--path", "a.ts"]);
    expect(one.out).toContain("would document a.ts:1 f");
    expect(one.out).not.toContain("src/");
    const folder = await cli(["docs", "stub", root, "--path=./src/"]);
    expect(folder.out).toContain("would document src/b.ts:1 f");
    expect(folder.out).toContain("would document src/c.ts:1 f");
    expect(folder.out).not.toContain("would document a.ts");
  });

  test("keeps a CRLF file in CRLF", async () => {
    const root = repo({ "a.ts": "export function f() {}\r\n" });
    await cli(["docs", "stub", root, "--apply"]);
    const text = readFileSync(join(root, "a.ts"), "utf8");
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
    expect(text).toContain(`/**\r\n * ${STUB_MARKER}`);
  });

  test("skips a file that holds a lone carriage return", async () => {
    const root = repo({ "a.ts": "export function f() {}\rexport function g() {}\r" });
    const run = await cli(["docs", "stub", root, "--apply"]);
    expect(run.out).toContain(
      "  SKIPPED a.ts: the file holds a carriage return with no line feed\n",
    );
    expect(read(root, "a.ts")).not.toContain(STUB_MARKER);
  });

  test("does not stub a file that does not parse", async () => {
    const root = repo({ "bad.py": "def broken(:\n" });
    const run = await cli(["docs", "stub", root, "--apply"]);
    expect(run.out).toStartWith("APPLIED: 0 stub(s)");
    expect(read(root, "bad.py")).toBe("def broken(:\n");
  });

  test("a .tsx file is stubbed with the TSX grammar", async () => {
    const root = repo({ "v.tsx": "export function V() {\n  return <i/>;\n}\n" });
    const run = await cli(["docs", "stub", root, "--apply"]);
    expect(run.out).toContain("  wrote v.tsx: inserted 1 stub(s)\n");
  });
});
