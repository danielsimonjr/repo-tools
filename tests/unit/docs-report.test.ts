/**
 * The counts and the coverage report of `repo-tools docs` (design section 16). The cases port the
 * report part of `test_code_docs.py` of the code-docs skill, and add the rounding that differs
 * between Python and JavaScript on an exact tie.
 */
import { describe, expect, test } from "bun:test";
import { type DocSymbol, type FileReport, newReport } from "../../src/docs/model.ts";
import { percent, renderMarkdown, summarise } from "../../src/docs/report.ts";

/** A symbol with the given state; the issues are the ones that the caller lists. */
function symbol(name: string, over: Partial<DocSymbol> = {}): DocSymbol {
  return {
    file: "a.ts",
    line: 1,
    anchorLine: 1,
    anchorColumn: 0,
    name,
    kind: "function",
    exported: true,
    hasDoc: true,
    params: [],
    docParams: [],
    summary: "Does it.",
    dialect: "",
    issues: [],
    ...over,
  };
}

/** A report for `path` that holds `symbols`. */
function report(path: string, symbols: DocSymbol[], dialects: string[] = []): FileReport {
  const r = newReport(path, "typescript");
  r.symbols = symbols;
  for (const d of dialects) r.dialects.add(d);
  return r;
}

const m1 = (name: string): DocSymbol =>
  symbol(name, {
    hasDoc: false,
    issues: [{ rule: "M1", tier: "MUST", detail: "exported symbol has no doc comment" }],
  });

describe("percent", () => {
  test("an empty denominator is 100", () => {
    expect(percent(0, 0)).toBe(100);
  });

  test("rounds to one decimal", () => {
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(2, 3)).toBe(66.7);
    expect(percent(1, 1)).toBe(100);
    expect(percent(0, 7)).toBe(0);
  });

  // Python `round(x, 1)` takes the even neighbour on an exact binary tie, and `toFixed` takes the
  // larger one. These four values are the ties of the form odd/4.
  test("an exact tie goes to the even neighbour, as Python rounds it", () => {
    expect(percent(1, 16)).toBe(6.2);
    expect(percent(3, 16)).toBe(18.8);
    expect(percent(1, 400)).toBe(0.2);
    expect(percent(3, 400)).toBe(0.8);
  });

  test("a value that is exact at one decimal is not changed", () => {
    expect(percent(1, 8)).toBe(12.5);
    expect(percent(5, 8)).toBe(62.5);
  });
});

describe("summarise", () => {
  test("counts the exported symbols, the documented ones and the issues", () => {
    const stats = summarise([
      report("a.ts", [symbol("a"), m1("b"), symbol("c", { exported: false })]),
      report("b.ts", [symbol("d", { issues: [{ rule: "S2", tier: "SHOULD", detail: "x" }] })]),
    ]);
    expect(stats).toEqual({
      filesScanned: 2,
      filesParsed: 2,
      filesUnparsed: 0,
      symbols: 4,
      exportedSymbols: 3,
      exportedDocumented: 2,
      exportedDocumentedPct: 66.7,
      mustIssues: 1,
      shouldIssues: 1,
      filesMixedDialect: 0,
    });
  });

  test("an unparsed file is counted apart, and none of its symbols counts", () => {
    const bad = report("bad.ts", [m1("x")]);
    bad.error = "parse error";
    const stats = summarise([report("a.ts", [symbol("a")]), bad]);
    expect(stats.filesScanned).toBe(2);
    expect(stats.filesParsed).toBe(1);
    expect(stats.filesUnparsed).toBe(1);
    expect(stats.exportedSymbols).toBe(1);
    expect(stats.mustIssues).toBe(0);
  });

  test("counts the files with more than one dialect", () => {
    const stats = summarise([
      report("a.ts", [], ["jsdoc", "tsdoc"]),
      report("b.ts", [], ["tsdoc"]),
    ]);
    expect(stats.filesMixedDialect).toBe(1);
  });

  test("no exported symbol gives 100 percent", () => {
    expect(
      summarise([report("a.ts", [symbol("p", { exported: false })])]).exportedDocumentedPct,
    ).toBe(100);
  });
});

describe("renderMarkdown", () => {
  const render = (reports: FileReport[]): string =>
    renderMarkdown(reports, summarise(reports), "git ls-files", "demo");

  test("has the summary table, the verification block and the provenance", () => {
    const md = render([report("a.ts", [symbol("a"), m1("b")])]);
    expect(md).toContain("# Code documentation coverage\n\n**Repo:** `demo`\n");
    expect(md).toContain("| Exported documented % | 50.0 |");
    expect(md).toContain("| **Files UNPARSED** (unknown, not clean) | **0** |");
    expect(md).toContain("## Verification\n\n- files_scanned: 1\n");
    expect(md).toContain("- discovery: git ls-files\n");
    expect(md.endsWith("does not read this file.\n")).toBe(true);
  });

  test("names the check command and does not claim that it reads the report", () => {
    const md = render([report("a.ts", [symbol("a")])]);
    expect(md).toContain("Run `repo-tools docs check .` to gate the repository.");
    expect(md).toContain("It does not read this file.");
  });

  test("lists each MUST issue in a table, and no table when there is none", () => {
    expect(render([report("a.ts", [symbol("a")])])).not.toContain("## MUST issues");
    const md = render([report("a.ts", [m1("b")])]);
    expect(md).toContain("| `a.ts` | 1 | `b` | M1 | exported symbol has no doc comment |");
  });

  test("cuts the MUST table at 200 rows and says so", () => {
    const many = Array.from({ length: 205 }, (_, i) => m1(`s${i}`));
    const md = render([report("a.ts", many)]);
    expect(md.match(/^\| `a\.ts` \|/gm)).toHaveLength(200);
    expect(md).toContain("**5 more not shown -- this table is TRUNCATED**");
  });

  test("names the unparsed files and says they are unknown", () => {
    const bad = report("bad.ts", []);
    bad.error = "parse error (tree-sitter reported ERROR nodes)";
    const md = render([bad]);
    expect(md).toContain("## Unparsed files");
    expect(md).toContain("These were NOT measured. They are unknown, not clean.");
    expect(md).toContain("- `bad.ts` -- parse error (tree-sitter reported ERROR nodes)");
  });
});
