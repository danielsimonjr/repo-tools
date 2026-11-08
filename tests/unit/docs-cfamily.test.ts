/**
 * Unit tests for the C and C++ documentation analyser.
 */

import { describe, expect, test } from "bun:test";
import { analyseCFamily, parsesAsCFamily, sanitiseGuards } from "../../src/docs/cfamily.ts";
import type { DocSymbol } from "../../src/docs/model.ts";
import { applyInsertions, planTypeScript, splitLines } from "../../src/docs/stub.ts";

/**
 * Analyse the source and return its symbols.
 */
async function symbols(path: string, source: string): Promise<DocSymbol[]> {
  const report = await analyseCFamily(path, source);
  return report.symbols;
}

/**
 * Find a symbol by name, or throw when it is absent.
 */
function byName(all: readonly DocSymbol[], name: string): DocSymbol {
  const found = all.find((symbol) => symbol.name === name);
  if (!found) {
    throw new Error(`missing symbol ${name}`);
  }
  return found;
}

const STUB = [
  "/**",
  " * @brief TODO: state what this does, in one active-voice sentence.",
  " *",
  " * @param a TODO: state what it is. Do not repeat the type.",
  " * @param b TODO: state what it is. Do not repeat the type.",
  " * @return TODO: state what the caller gets back.",
  " */",
  "",
].join("\n");

describe("docs cfamily", () => {
  test("recognises declarations and skips plain values", async () => {
    const source = [
      "int add(int a, int b);",
      "struct Node { int x; };",
      "enum Color { RED };",
      "typedef struct Point { int x; } Point;",
      "class Box { public: void m(); };",
      "namespace outer { }",
      "using Vec = int;",
      "struct Fwd;",
      "int g_def = 1;",
      "extern int g_count;",
      "",
    ].join("\n");
    const all = await symbols("a.h", source);
    expect(byName(all, "add").kind).toBe("function");
    expect(byName(all, "Node").kind).toBe("struct");
    expect(byName(all, "Color").kind).toBe("enum");
    const points = all.filter((symbol) => symbol.name === "Point");
    expect(points.length).toBe(1);
    expect(points[0]?.kind).toBe("struct");
    expect(byName(all, "Box").kind).toBe("class");
    expect(byName(all, "m").kind).toBe("method");
    expect(byName(all, "outer").kind).toBe("module");
    expect(byName(all, "Vec").kind).toBe("type");
    expect(all.some((symbol) => symbol.name === "Fwd")).toBe(false);
    expect(all.some((symbol) => symbol.name === "g_def")).toBe(false);
    expect(all.some((symbol) => symbol.name === "g_count")).toBe(false);
  });

  test("keeps the length of guard regions", async () => {
    const header = [
      "#ifdef __cplusplus",
      'extern "C" {',
      "#endif",
      "",
      "/** Adds. */",
      "int add(int a, int b);",
      "",
      "#ifdef __cplusplus",
      "}",
      "#endif",
      "",
    ].join("\n");
    expect(sanitiseGuards(header).length).toBe(header.length);
    const report = await analyseCFamily("a.h", header);
    expect(report.error).toBe("");
    expect(byName(report.symbols, "add").hasDoc).toBe(true);
    const untouched = "#ifdef __cplusplus\n#define X 1\n#endif\n";
    expect(sanitiseGuards(untouched)).toBe(untouched);
  });

  test("flags exports in headers only", async () => {
    expect(byName(await symbols("a.h", "int add(int a, int b);\n"), "add").exported).toBe(true);
    expect(byName(await symbols("a.h", "static int hidden(void);\n"), "hidden").exported).toBe(
      false,
    );
    expect(
      byName(await symbols("a.h", "namespace { void hidden_ns(); }\n"), "hidden_ns").exported,
    ).toBe(false);
    const boxSource = [
      "class Box {",
      "  void priv0();",
      "public:",
      "  void get();",
      "protected:",
      "  void prot();",
      "private:",
      "  void priv();",
      "};",
      "",
    ].join("\n");
    const box = await symbols("a.h", boxSource);
    expect(byName(box, "priv0").exported).toBe(false);
    expect(byName(box, "get").exported).toBe(true);
    expect(byName(box, "prot").exported).toBe(true);
    expect(byName(box, "priv").exported).toBe(false);
    expect(
      byName(await symbols("a.h", "struct S {\n  void pub_default();\n};\n"), "pub_default")
        .exported,
    ).toBe(true);
  });

  test("source files export nothing", async () => {
    for (const path of ["a.c", "a.cpp"]) {
      const add = byName(await symbols(path, "int add(int a, int b) { return a + b; }\n"), "add");
      expect(add.exported).toBe(false);
    }
  });

  test("drops undocumented duplicates", async () => {
    const shadowed = [
      "/** Adds. */",
      "int add(int a, int b);",
      "int add(int a, int b) { return a + b; }",
      "",
    ].join("\n");
    const adds = (await symbols("a.h", shadowed)).filter((symbol) => symbol.name === "add");
    expect(adds.length).toBe(2);
    const second = adds.reduce((left, right) => (left.line > right.line ? left : right));
    expect(second.exported).toBe(false);
    expect(second.issues).toEqual([]);
    const drifted = ["/** F. */", "int f(int a);", "int f(int a, int b) { return a; }", ""].join(
      "\n",
    );
    const laterF = (await symbols("a.h", drifted))
      .filter((symbol) => symbol.name === "f")
      .reduce((left, right) => (left.line > right.line ? left : right));
    expect(laterF.issues.some((issue) => issue.rule === "M1")).toBe(true);
  });

  test("accepts every doxygen comment form", async () => {
    for (const doc of ["/** D. */", "/*! D. */", "/// D.", "//! D."]) {
      expect(byName(await symbols("a.h", `${doc}\nint f(void);\n`), "f").hasDoc).toBe(true);
    }
    expect(byName(await symbols("a.h", "//// D.\nint f(void);\n"), "f").hasDoc).toBe(false);
    expect(byName(await symbols("a.h", "/** @file x.h */\nint f(void);\n"), "f").hasDoc).toBe(
      false,
    );
    expect(byName(await symbols("a.h", "/** D. */\n// plain\nint f(void);\n"), "f").hasDoc).toBe(
      true,
    );
    const box = byName(
      await symbols("a.h", "/// Class doc.\ntemplate <typename T>\nclass Box {};\n"),
      "Box",
    );
    expect(box.hasDoc).toBe(true);
    expect(box.anchorLine).toBe(2);
  });

  test("reads parameter names", async () => {
    const ext = byName(
      await symbols("a.h", "void ext(const char *name, int arr[], int (*cb)(int));\n"),
      "ext",
    );
    expect(ext.params).toEqual(["name", "arr", "cb"]);
    expect(byName(await symbols("a.h", "void noargs(void);\n"), "noargs").params).toEqual([]);
    expect(byName(await symbols("a.h", "void cfunc(int);\n"), "cfunc").params).toEqual([]);
  });

  test("reports undocumented parameters once", async () => {
    const source = [
      "/**",
      " * @brief Adds.",
      " * @param a x",
      " * @param[in] b y",
      " * @param gone z",
      " */",
      "int add(int a, int b);",
      "",
    ].join("\n");
    const add = byName(await symbols("a.h", source), "add");
    const m3 = add.issues.filter((issue) => issue.rule === "M3");
    expect(m3.length).toBe(1);
    expect(JSON.stringify(m3[0])).toContain("gone");
  });

  test("detects the doxygen dialect", async () => {
    const brief = byName(
      await symbols("a.h", "/** @brief Adds two numbers. */\nint add(int a, int b);\n"),
      "add",
    );
    expect(brief.dialect).toBe("doxygen");
    expect(brief.summary).toContain("Adds two numbers.");
    const plain = byName(await symbols("a.h", "/// Plain.\nint f(void);\n"), "f");
    expect(plain.dialect).toBe("");
  });

  test("reads destructor and operator names", async () => {
    const source = [
      "class Box {",
      "public:",
      "  ~Box();",
      "  int operator()(int x);",
      "};",
      "",
    ].join("\n");
    const names = (await symbols("a.h", source)).map((symbol) => symbol.name);
    expect(names).toContain("~Box");
    expect(names).toContain("operator()");
  });

  test("detects value returns", async () => {
    expect(byName(await symbols("a.h", "void v(void);\n"), "v").returnsValue).toBe(false);
    expect(byName(await symbols("a.h", "int i(void);\n"), "i").returnsValue).toBe(true);
    expect(byName(await symbols("a.h", "void *vp(void);\n"), "vp").returnsValue).toBe(true);
  });

  test("plans and applies the doxygen stub", async () => {
    const source = "int add(int a, int b);\n";
    const lines = splitLines(source);
    const add = byName(await symbols("a.h", source), "add");
    const plan = planTypeScript(add, lines, "doxygen");
    expect(plan).not.toBeNull();
    if (!plan) {
      throw new Error("no insertion planned");
    }
    expect(plan.text).toBe(STUB);
    const applied = applyInsertions(source, [plan], (text) => parsesAsCFamily("a.h", text));
    expect(applied.ok).toBe(true);
    const documented = byName((await analyseCFamily("a.h", applied.text)).symbols, "add");
    expect(documented.issues.some((issue) => issue.rule === "M1")).toBe(false);
    expect(documented.issues.some((issue) => issue.rule === "M4")).toBe(true);
    expect(documented.dialect).toBe("doxygen");
  });

  test("reports misparsed array references", async () => {
    const broken = await analyseCFamily("a.cpp", "void g1(int (&arr)[3]);\n");
    expect(broken.error).toMatch(/^parse error \(/);
    expect(broken.symbols).toEqual([]);
    const fine = await analyseCFamily("a.cpp", "int x(3);\n");
    expect(fine.error).toBe("");
  });
});

describe("docs cfamily review fixes", () => {
  test("refuses a declaration with several function declarators", async () => {
    for (const path of ["a.h", "a.c", "a.cpp"]) {
      const report = await analyseCFamily(path, "int m1(void), m2(void);\n");
      expect(report.error).toMatch(/^parse error \(/);
    }
  });

  test("refuses a typedef with a pointer or several declarators", async () => {
    const pointer = await analyseCFamily("a.h", "typedef struct Point { int x; } *PointPtr;\n");
    expect(pointer.error).toMatch(/^parse error \(/);
    const many = await analyseCFamily("a.c", "typedef struct P2 { int x; } P2, *P2Ptr;\n");
    expect(many.error).toMatch(/^parse error \(/);
    const plain = await analyseCFamily("a.h", "typedef struct P3 { int x; } P3;\n");
    expect(plain.error).toBe("");
    expect(byName(plain.symbols, "P3").kind).toBe("struct");
  });

  test("keeps the export flag of an undocumented overload in another namespace", async () => {
    const source = [
      "namespace a {",
      "/** Does a. */",
      "void f(int x);",
      "}",
      "namespace b {",
      "void f(int x);",
      "}",
      "",
    ].join("\n");
    const all = await symbols("a.h", source);
    const second = all.filter((symbol) => symbol.name === "f")[1];
    expect(second?.exported).toBe(true);
    expect(second?.hasDoc).toBe(false);
  });

  test("drops the export flag of an out-of-class method only for the declared one", async () => {
    const source = [
      "struct S {",
      "  /** Does m. */",
      "  void m(int x);",
      "};",
      "struct T {",
      "  void m(int x);",
      "};",
      "",
    ].join("\n");
    const all = await symbols("a.h", source);
    const second = all.filter((symbol) => symbol.name === "m")[1];
    expect(second?.exported).toBe(true);
  });

  test("skips anonymous enums, structs and unions", async () => {
    const source = "enum { A, B };\nstruct { int x; } s;\nunion { int i; } u;\n";
    const all = await symbols("a.h", source);
    expect(all.some((symbol) => symbol.name === "<anonymous>")).toBe(false);
  });

  test("skips function-pointer variables and members", async () => {
    const header = await symbols("a.h", "int (*hook)(int);\nstruct S { int (*cb)(int); };\n");
    expect(header.some((symbol) => symbol.name === "hook")).toBe(false);
    expect(header.some((symbol) => symbol.name === "cb")).toBe(false);
    const source = await symbols("a.c", "int (*fp)(int) = 0;\n");
    expect(source.some((symbol) => symbol.name === "fp")).toBe(false);
    const signal = await symbols("a.h", "void (*signal(int sig, void (*func)(int)))(int);\n");
    expect(byName(signal, "signal").kind).toBe("function");
    expect(byName(signal, "signal").returnsValue).toBe(true);
  });

  test("reads the return type of a template function", async () => {
    const all = await symbols(
      "a.h",
      "template <typename T> void tv(T x);\ntemplate <typename T> T tr(T x);\n",
    );
    expect(byName(all, "tv").returnsValue).toBe(false);
    expect(byName(all, "tr").returnsValue).toBe(true);
  });

  test("exports a static template member of a struct", async () => {
    const all = await symbols(
      "a.h",
      "struct S {\n  template <typename T> static void sm(T x);\n};\n",
    );
    expect(byName(all, "sm").exported).toBe(true);
  });

  test("keeps a class default-private static member unexported", async () => {
    const all = await symbols("a.h", "class Q { static void sm(); };\n");
    expect(byName(all, "sm").exported).toBe(false);
  });

  test("names a conversion operator without its qualifiers", async () => {
    const all = await symbols("a.h", "struct S {\n  operator int() const;\n};\n");
    expect(all.some((symbol) => symbol.name === "operator int")).toBe(true);
  });

  test("reads a variadic pack parameter name", async () => {
    const source = [
      "/**",
      " * Forwards.",
      " * @param args The arguments.",
      " */",
      "template <typename... Args> void va(Args&&... args);",
      "",
    ].join("\n");
    const va = byName(await symbols("a.h", source), "va");
    expect(va.params).toEqual(["args"]);
    expect(va.issues.map((issue) => issue.rule)).not.toContain("M3");
  });

  test("finds the doc of a single extern C declaration", async () => {
    const all = await symbols("a.h", '/** Does ef. */\nextern "C" int ef(int x);\n');
    expect(byName(all, "ef").hasDoc).toBe(true);
  });

  test("marks the doxygen dialect for grouping and reference tags", async () => {
    for (const tag of [
      "ingroup g",
      "def X",
      "var v",
      "fn f",
      "typedef T",
      "struct S",
      "enum E",
      "copydoc f",
    ]) {
      const report = await analyseCFamily("a.h", `/** Does f.\n * @${tag}\n */\nvoid f(void);\n`);
      expect(byName(report.symbols, "f").dialect).toBe("doxygen");
    }
  });
});
