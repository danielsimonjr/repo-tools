import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Coverage, CoverageFile, CoverageSymbol } from "../../scripts/docs-compare.ts";
import {
  classifyUnparsed,
  countCppHeaderShapes,
  delegationLambdaHoldsDeclaration,
  diffCoverage,
  filesByLanguage,
  headerFunctionCount,
  isEmpty,
  parseArgs,
  renderDiff,
  rewriteCppMacros,
  rewriteKotlinOneLineBody,
  summaryRow,
  triageHeaderTree,
  unparsedByError,
} from "../../scripts/docs-compare.ts";
import { parsesAsCFamily } from "../../src/docs/cfamily.ts";
import { parsesAsKotlin } from "../../src/docs/kotlin.ts";
import { loadGrammar } from "../../src/map/grammars.ts";

const baseSummary = {
  files_scanned: 1,
  files_parsed: 1,
  files_unparsed: 0,
  symbols: 1,
  exported_symbols: 1,
  exported_documented: 1,
  exported_documented_pct: 100,
  must_issues: 0,
  should_issues: 0,
  files_mixed_dialect: 0,
};

function makeCoverage(files: CoverageFile[]): Coverage {
  return { summary: { ...baseSummary }, provenance: "test", files };
}

function makeSymbol(overrides: Partial<CoverageSymbol> = {}): CoverageSymbol {
  return {
    file: "src/a.ts",
    line: 1,
    name: "f",
    kind: "function",
    exported: true,
    has_doc: true,
    params: [],
    doc_params: [],
    summary: "",
    dialect: "ts",
    issues: [],
    ...overrides,
  };
}

function makeFile(overrides: Partial<CoverageFile> = {}): CoverageFile {
  return {
    path: "src/a.ts",
    language: "ts",
    error: "",
    dialects: ["ts"],
    symbols: [],
    ...overrides,
  };
}

describe("parseArgs", () => {
  test("parses the three modes and their flags", () => {
    expect(parseArgs(["diff", "a.json", "b.json", "--json"])).toEqual({
      mode: "diff",
      files: ["a.json", "b.json"],
      json: true,
    });
    expect(parseArgs(["summary", "c.json", "--name=repo", "--commit=abc"])).toEqual({
      mode: "summary",
      files: ["c.json"],
      json: false,
      name: "repo",
      commit: "abc",
    });
    expect(parseArgs(["triage", "c.json", "--root=clone"])).toEqual({
      mode: "triage",
      files: ["c.json"],
      json: false,
      root: "clone",
    });
  });

  test("returns errors for bad modes, flags, counts, and missing root", () => {
    expect("error" in parseArgs(["bogus"])).toBe(true);
    expect("error" in parseArgs(["diff", "a.json"])).toBe(true);
    expect("error" in parseArgs(["summary", "a.json", "b.json"])).toBe(true);
    expect("error" in parseArgs(["triage", "a.json"])).toBe(true);
    expect("error" in parseArgs(["diff", "a.json", "b.json", "--bad"])).toBe(true);
  });
});

describe("diffCoverage", () => {
  test("finds no difference for equal unordered coverage", () => {
    const base = makeCoverage([
      makeFile({ path: "b.ts", symbols: [makeSymbol({ file: "b.ts" })] }),
      makeFile({ path: "a.ts", symbols: [makeSymbol({ file: "a.ts" })] }),
    ]);
    const next = makeCoverage([
      makeFile({ path: "a.ts", symbols: [makeSymbol({ file: "a.ts" })] }),
      makeFile({ path: "b.ts", symbols: [makeSymbol({ file: "b.ts" })] }),
    ]);
    const diff = diffCoverage(base, next);
    expect(isEmpty(diff)).toBe(true);
    expect(renderDiff(diff)).toBe(
      "files +0 -0, symbols +0 -0, fields changed 0, file records changed 0",
    );
  });

  test("finds added and removed symbols", () => {
    const base = makeCoverage([makeFile({ symbols: [makeSymbol({ name: "old" })] })]);
    const next = makeCoverage([makeFile({ symbols: [makeSymbol({ name: "new" })] })]);
    const diff = diffCoverage(base, next);
    expect(diff.symbolsAdded).toEqual(["src/a.ts:1 new function"]);
    expect(diff.symbolsRemoved).toEqual(["src/a.ts:1 old function"]);
  });

  test("finds field changes with JSON values", () => {
    const base = makeCoverage([makeFile({ symbols: [makeSymbol({ dialect: "ts", issues: [] })] })]);
    const next = makeCoverage([
      makeFile({ symbols: [makeSymbol({ dialect: "tsx", issues: ["missing-doc"] })] }),
    ]);
    const diff = diffCoverage(base, next);
    expect(diff.fieldChanges).toEqual([
      'src/a.ts:1 f function dialect: "ts" -> "tsx"',
      'src/a.ts:1 f function issues: [] -> ["missing-doc"]',
    ]);
  });

  test("finds file error and dialect changes", () => {
    const base = makeCoverage([makeFile({ error: "", dialects: ["ts"] })]);
    const next = makeCoverage([makeFile({ error: "bad parse", dialects: ["tsx"] })]);
    const diff = diffCoverage(base, next);
    expect(diff.fileChanges).toEqual([
      'src/a.ts dialects: ["ts"] -> ["tsx"]',
      'src/a.ts error: "" -> "bad parse"',
    ]);
  });

  test("finds added and removed files", () => {
    const base = makeCoverage([makeFile({ path: "a.ts" })]);
    const next = makeCoverage([makeFile({ path: "b.ts" })]);
    const diff = diffCoverage(base, next);
    expect(diff.filesAdded).toEqual(["b.ts"]);
    expect(diff.filesRemoved).toEqual(["a.ts"]);
  });
});

describe("summaryRow", () => {
  test("formats the exact table row", () => {
    expect(summaryRow(makeCoverage([]), "repo", "abc123")).toBe(
      "| repo | `abc123` | 1 | 1 | 1 | 1 | 0 | 0 |",
    );
  });
});

describe("file counts", () => {
  test("groups unparsed files by error text", () => {
    const coverage = makeCoverage([
      makeFile({ path: "a.ts", error: "e1" }),
      makeFile({ path: "b.ts", error: "e1" }),
      makeFile({ path: "c.kt", language: "kotlin", error: "e2" }),
      makeFile({ path: "d.kt", language: "kotlin", error: "" }),
    ]);
    expect([...unparsedByError(coverage).entries()]).toEqual([
      ["e1", 2],
      ["e2", 1],
    ]);
  });

  test("counts files by language", () => {
    const coverage = makeCoverage([
      makeFile({ path: "a.ts" }),
      makeFile({ path: "b.ts" }),
      makeFile({ path: "c.kt", language: "kotlin" }),
    ]);
    expect([...filesByLanguage(coverage).entries()]).toEqual([
      ["ts", 2],
      ["kotlin", 1],
    ]);
  });
});

describe("rewriteKotlinOneLineBody", () => {
  test("rewrites a one-line body and leaves other lines alone", () => {
    expect(rewriteKotlinOneLineBody("class C { fun f() {} }")).toBe("class C { fun f() {};}");
    expect(rewriteKotlinOneLineBody("class C {\n  fun f() {}\n}")).toBe(
      "class C {\n  fun f() {}\n}",
    );
    expect(rewriteKotlinOneLineBody("class E { }")).toBe("class E {;}");
    expect(rewriteKotlinOneLineBody('val s = "a }"')).toBe('val s = "a }"');
  });

  test("keeps the length and gives a clean Kotlin parse", async () => {
    await loadGrammar("kotlin");
    for (const input of ["class C { fun f() {} }", "class E { }"]) {
      const output = rewriteKotlinOneLineBody(input);
      expect(output.length).toBe(input.length);
      expect(parsesAsKotlin("a.kt", output)).toBe(true);
    }
  });
});

describe("delegationLambdaHoldsDeclaration", () => {
  test("tells a lambda delegate from a misread class body", async () => {
    const parser = await loadGrammar("kotlin");
    const cases: [string, boolean][] = [
      ["class A : B by lazy { x }", false],
      ["class A : B by c { fun f() {} }", true],
    ];
    for (const [source, expected] of cases) {
      const tree = parser.parse(source);
      if (!tree) throw new Error("parse failed");
      try {
        expect(delegationLambdaHoldsDeclaration(tree.rootNode)).toBe(expected);
      } finally {
        tree.delete();
      }
    }
  });
});

describe("rewriteCppMacros", () => {
  test("blanks an export macro and keeps the parse clean", async () => {
    const input = "EXPORT_API int f(int a);\n";
    const output = rewriteCppMacros(input);
    expect(output.length).toBe(input.length);
    expect(output.slice(0, 10)).toBe("          ");
    await loadGrammar("cpp");
    expect(parsesAsCFamily("a.h", output)).toBe(true);
  });

  test("keeps a function-like macro call", () => {
    expect(rewriteCppMacros("FOO_BAR(x)")).toBe("FOO_BAR(x)");
  });
});

describe("countCppHeaderShapes", () => {
  test("counts macros, externs and data members", async () => {
    const source =
      "#define SQ(x) ((x)*(x))\nextern int n;\n" +
      "struct P { int x; int y; };\nint f(void);\nint g(void);\n";
    const parser = await loadGrammar("cpp");
    const tree = parser.parse(source);
    if (!tree) throw new Error("parse failed");
    try {
      expect(countCppHeaderShapes(tree.rootNode)).toEqual({ macros: 1, externs: 1, members: 2 });
    } finally {
      tree.delete();
    }
  });
});

describe("triage header counts", () => {
  test("struct members follow access specifiers; class starts private", async () => {
    const source =
      "struct S { int a; private: int b; public: int c; };\n" +
      "class C { int d; public: int e; };\n";
    const parser = await loadGrammar("cpp");
    const tree = parser.parse(source);
    if (!tree) throw new Error("parse failed");
    try {
      expect(countCppHeaderShapes(tree.rootNode).members).toBe(3);
    } finally {
      tree.delete();
    }
  });

  test("a function-like macro symbol is not counted as a function", async () => {
    const source = "#define SQ(x) ((x)*(x))\nint f(void);\n";
    const parser = await loadGrammar("cpp");
    const tree = parser.parse(source);
    if (!tree) throw new Error("parse failed");
    try {
      const symbols = [
        makeSymbol({ file: "a.h", line: 1, name: "SQ", kind: "function" }),
        makeSymbol({ file: "a.h", line: 2, name: "f", kind: "function" }),
      ];
      expect(headerFunctionCount(tree.rootNode, symbols)).toBe(1);
    } finally {
      tree.delete();
    }
  });

  test("guards are blanked and an error tree is skipped", async () => {
    const guarded =
      '#ifdef __cplusplus\nextern "C" {\n#endif\nextern int n;\n#ifdef __cplusplus\n}\n#endif\n';
    const ok = await triageHeaderTree(guarded, []);
    expect(ok).toEqual({ functions: 0, macros: 0, externs: 1, members: 0 });
    expect(await triageHeaderTree("int f( {{{\n", [])).toBeNull();
  });
});

describe("classifyUnparsed", () => {
  test("maps the named error texts to their causes", async () => {
    const many =
      "parse error (a declaration declares several names, and the report keeps one name per declaration)";
    const array =
      "parse error (the grammar reads a function with an array-reference parameter as a variable)";
    expect(await classifyUnparsed("a.cpp", many, "")).toBe("cpp-many-names");
    expect(await classifyUnparsed("a.cpp", array, "")).toBe("cpp-array-reference");
  });
});

describe("main", () => {
  test("exits 0 for equal reports and 1 for a difference", () => {
    const dir = mkdtempSync(join(tmpdir(), `docs-compare-${process.pid}-`));
    try {
      const empty = JSON.stringify({ summary: {}, files: [] });
      const base = join(dir, "base.json");
      const next = join(dir, "next.json");
      const different = join(dir, "different.json");
      writeFileSync(base, empty);
      writeFileSync(next, empty);
      writeFileSync(
        different,
        JSON.stringify({ summary: {}, files: [makeFile({ path: "a.ts" })] }),
      );
      const run = (a: string, b: string) =>
        Bun.spawnSync([process.execPath, "scripts/docs-compare.ts", "diff", a, b]).exitCode;
      expect(run(base, next)).toBe(0);
      expect(run(base, different)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
