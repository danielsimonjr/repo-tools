/**
 * The TypeScript and JavaScript analyser of `repo-tools docs` (design section 16). The cases port
 * `ts_lang.py` tests of the code-docs skill: the abstract property, `export type *`, the TSDoc
 * parameter names and the neutral dialect. Then they add the grammar choice for `.tsx` and the
 * single-line comment.
 */
import { describe, expect, test } from "bun:test";
import { STUB_MARKER } from "../../src/docs/model.ts";
import { analyseTypeScript, parsesAsTypeScript, sanitise } from "../../src/docs/typescript.ts";
import { only } from "./docs-helpers.ts";

/** The symbols of a TypeScript source. */
async function symbols(source: string, path = "a.ts") {
  return (await analyseTypeScript(path, source)).symbols;
}

const rulesOf = (sym: { issues: { rule: string }[] }): string[] => sym.issues.map((i) => i.rule);

describe("typescript: the public surface and rule M1", () => {
  test("an exported function with no doc comment is M1", async () => {
    const sym = only(await symbols("export function f() {}\n"));
    expect(sym.exported).toBe(true);
    expect(rulesOf(sym)).toEqual(["M1"]);
  });

  test("a function that is not exported is not gated", async () => {
    const sym = only(await symbols("function f() {}\n"));
    expect(sym.exported).toBe(false);
    expect(sym.issues).toEqual([]);
  });

  test("a method of an exported class is not itself exported", async () => {
    const found = await symbols("/** Doc. */\nexport class K {\n  go() {}\n}\n");
    expect(found.map((s) => `${s.name}:${s.kind}:${s.exported}`)).toEqual([
      "K:class:true",
      "go:method:false",
    ]);
  });

  test("the kinds: function, generator, class, abstract class, interface, type alias", async () => {
    const src = [
      "export function a() {}",
      "export function* b() {}",
      "export class C {}",
      "export abstract class D {}",
      "export interface E {}",
      "export type F = string;",
      "",
    ].join("\n");
    const found = await symbols(src);
    expect(found.map((s) => `${s.name}:${s.kind}`)).toEqual([
      "a:function",
      "b:function",
      "C:class",
      "D:class",
      "E:interface",
      "F:type",
    ]);
    expect(found.every((s) => rulesOf(s).join() === "M1")).toBe(true);
  });

  test("the symbols come in document order", async () => {
    const src = "export class K {\n  b() {}\n  a() {}\n}\nexport function z() {}\n";
    expect((await symbols(src)).map((s) => s.name)).toEqual(["K", "b", "a", "z"]);
  });

  test("a test file is exempt from M1 and not from M3", async () => {
    const path = "tests/unit/x.test.ts";
    expect(only(await symbols("export function t() {}\n", path)).issues).toEqual([]);
    const stale =
      "/**\n * Do it.\n * @param gone - Not a parameter.\n */\nexport function t() {}\n";
    expect(rulesOf(only(await symbols(stale, path)))).toContain("M3");
  });
});

describe("typescript: which comment is a doc comment", () => {
  test("a block comment of two stars documents the next declaration", async () => {
    const sym = only(await symbols("/** Returns one. */\nexport function f() {}\n"));
    expect(sym.hasDoc).toBe(true);
    expect(sym.summary).toBe("Returns one.");
    expect(sym.issues).toEqual([]);
  });

  test("a plain block comment and a line comment are not docs", async () => {
    expect(rulesOf(only(await symbols("/* Not doc. */\nexport function f() {}\n")))).toEqual([
      "M1",
    ]);
    expect(rulesOf(only(await symbols("// Not doc.\nexport function f() {}\n")))).toEqual(["M1"]);
  });

  test("a doc comment that another statement separates from the symbol is not its doc", async () => {
    const sym = only(await symbols("/** Doc. */\nconst x = 1;\nexport function f() {}\n"));
    expect(sym.hasDoc).toBe(false);
  });

  test("a line comment between the doc comment and the symbol hides the doc", async () => {
    const sym = only(await symbols("/** Doc. */\n// note\nexport function f() {}\n"));
    expect(sym.hasDoc).toBe(false);
  });

  test("a doc comment before a decorator documents the decorated class", async () => {
    const src = "/** The class. */\n@Dec()\nexport class K {}\n";
    const sym = only(await symbols(src));
    expect(sym.hasDoc).toBe(true);
    expect(sym.line).toBe(3);
    expect(sym.anchorLine).toBe(2);
  });

  test("the anchor of an undocumented exported class is its first line, the decorator", async () => {
    const sym = only(await symbols("@Dec()\nexport class K {}\n"));
    expect(sym.anchorLine).toBe(1);
    expect(sym.line).toBe(2);
  });
});

describe("typescript: the summary", () => {
  test("a one-line comment has its closing delimiter removed", async () => {
    const sym = only(await symbols("/** Returns one. */\nexport function f() {}\n"));
    expect(sym.summary).toBe("Returns one.");
    expect(rulesOf(sym)).not.toContain("S2");
  });

  test("the first prose line is the summary, and a tag line is not prose", async () => {
    const src = "/**\n * @internal\n *\n * Does a thing.\n * More.\n */\nexport function f() {}\n";
    expect(only(await symbols(src)).summary).toBe("Does a thing.");
  });

  test("a comment of only tags has no summary: M2", async () => {
    const src = "/**\n * @param x - A thing.\n */\nexport function f(x: number) {}\n";
    expect(rulesOf(only(await symbols(src)))).toContain("M2");
  });

  test("an empty comment is M2", async () => {
    expect(rulesOf(only(await symbols("/** */\nexport function f() {}\n")))).toEqual(["M2"]);
  });

  test("S2 flags a summary with no full stop", async () => {
    const sym = only(await symbols("/** Returns one */\nexport function f() {}\n"));
    expect(rulesOf(sym)).toEqual(["S2"]);
    expect(sym.issues[0]?.tier).toBe("SHOULD");
  });

  // The Python tool counted the opening delimiter as the 21st word of this 20-word sentence.
  test("the comment delimiters are not words: a sentence of 20 words passes", async () => {
    const src =
      "/** True when a walk can start at `dir`: it exists and it is not a link (a link is recorded). */\nexport function f() {}\n";
    expect(only(await symbols(src)).issues).toEqual([]);
  });

  test("the first sentence is checked for Simplified Technical English", async () => {
    const sym = only(
      await symbols("/** Call it in order to reset the state. */\nexport function f() {}\n"),
    );
    expect(rulesOf(sym)).toEqual(["S6/STE-WORD"]);
  });

  test("a surviving stub marker is M4", async () => {
    const src = `/**\n * ${STUB_MARKER} state what this does.\n */\nexport function f() {}\n`;
    expect(rulesOf(only(await symbols(src)))).toContain("M4");
  });
});

describe("typescript: parameters", () => {
  const params = async (signature: string) =>
    only((await symbols(`export function f(${signature}) {}\n`)).filter((s) => s.name === "f"))
      .params;

  test("plain, optional, defaulted and typed parameters", async () => {
    expect(await params("a: number, b?: string, c = 1, d: boolean = true")).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  test("a destructured parameter gives the names that it binds", async () => {
    expect(await params("{ a, b }: { a: number; b: number }")).toEqual(["a", "b"]);
    expect(await params("[p, q]: number[]")).toEqual(["p", "q"]);
    expect(await params("{ a: renamed }: { a: number }")).toEqual(["renamed"]);
  });

  test("a rest parameter gives its name", async () => {
    expect(await params("first: number, ...rest: number[]")).toEqual(["first", "rest"]);
  });

  test("a class and an interface have no parameters", async () => {
    const found = await symbols(
      "export class K { constructor(x: number) {} }\nexport interface I {}\n",
    );
    expect(found.filter((s) => s.kind !== "method").every((s) => s.params.length === 0)).toBe(true);
  });

  test("an untyped TSDoc @param keeps its whole name", async () => {
    const src =
      "/**\n * Do it.\n * @param alpha - First.\n * @param beta - Second.\n */\nexport function f(alpha: number, beta: number) {}\n";
    const sym = only(await symbols(src));
    expect(sym.docParams).toEqual(["alpha", "beta"]);
    expect(sym.issues).toEqual([]);
  });

  test("a typed JSDoc @param gives the name after the brace", async () => {
    const src = "/**\n * Do it.\n * @param {string} x - A thing.\n */\nexport function f(x) {}\n";
    expect(only(await symbols(src, "a.js")).docParams).toEqual(["x"]);
  });

  test("a stale documented parameter is M3", async () => {
    const src =
      "/**\n * Do it.\n * @param gone - Not here.\n */\nexport function f(x: number) {}\n";
    const m3 = only(await symbols(src)).issues.filter((i) => i.rule === "M3");
    expect(m3.map((i) => i.detail)).toEqual([
      "documents parameter 'gone' which is not in the signature",
    ]);
  });
});

describe("typescript: the dialect", () => {
  const typed = "/**\n * Do it.\n * @param {string} x - A thing.\n */\nexport function f(x) {}\n";
  const tsdoc = "/**\n * Do it.\n * @param x - A thing.\n */\nexport function g(x: string) {}\n";

  test("a typed tag is JSDoc and a dashed @param is TSDoc", async () => {
    const js = await analyseTypeScript("a.js", typed);
    expect([...js.dialects]).toEqual(["jsdoc"]);
    const ts = await analyseTypeScript("a.ts", tsdoc);
    expect([...ts.dialects]).toEqual(["tsdoc"]);
  });

  test("a comment with neither is neutral and counts for no dialect", async () => {
    const report = await analyseTypeScript(
      "a.ts",
      "/** Plain. */\nexport function f() {}\n\n" +
        typed.replace("export function f(x)", "export function h(x: string)"),
    );
    expect([...report.dialects]).toEqual(["jsdoc"]);
  });

  test("a file with both dialects reports both", async () => {
    const report = await analyseTypeScript("a.ts", `${typed}\n${tsdoc}`);
    expect([...report.dialects].sort()).toEqual(["jsdoc", "tsdoc"]);
  });

  test("S5: a typed @param in a TypeScript file restates the annotation; in JavaScript it does not", async () => {
    const ts = only(await symbols(typed, "a.ts"));
    expect(rulesOf(ts)).toContain("S5");
    const js = only(await symbols(typed, "a.js"));
    expect(rulesOf(js)).not.toContain("S5");
  });
});

describe("typescript: syntax the grammar reads only after a rewrite", () => {
  test("a property named abstract parses, and the rewrite keeps the length", async () => {
    const src = "export interface E {\n  abstract: string;\n  abstract?: number;\n}\n";
    expect(sanitise(src)).toHaveLength(src.length);
    const report = await analyseTypeScript("a.ts", src);
    expect(report.error).toBe("");
    expect(report.symbols.map((s) => s.name)).toEqual(["E"]);
  });

  test("an abstract class is still an abstract class after the rewrite", async () => {
    const src = "export abstract class A {\n  abstract run(): void;\n}\n";
    expect(sanitise(src)).toBe(src);
    expect(only((await symbols(src)).filter((s) => s.kind === "class")).name).toBe("A");
  });

  test("export type * from parses, and the rewrite keeps the length", async () => {
    const src = 'export type * from "./m";\nexport function f() {}\n';
    expect(sanitise(src)).toHaveLength(src.length);
    const report = await analyseTypeScript("a.ts", src);
    expect(report.error).toBe("");
    expect(report.symbols.map((s) => s.name)).toEqual(["f"]);
  });

  test("a type-only named export is left alone", () => {
    const src = 'export type { T } from "./m";\n';
    expect(sanitise(src)).toBe(src);
  });
});

describe("typescript: the grammar follows the extension", () => {
  const jsx = "export function View() {\n  return <div>hi</div>;\n}\n";

  test("a .tsx file with JSX parses and a .ts file with JSX does not", async () => {
    expect((await analyseTypeScript("a.tsx", jsx)).error).toBe("");
    expect((await analyseTypeScript("a.ts", jsx)).error).toContain("parse error");
  });

  test("a .jsx file uses the TSX grammar", async () => {
    const report = await analyseTypeScript("a.jsx", jsx);
    expect(report.error).toBe("");
    expect(only(report.symbols).name).toBe("View");
  });

  test("an angle-bracket type assertion parses in .ts and not in .tsx", async () => {
    const src = "export function f(x: unknown) {\n  return <string>x;\n}\n";
    expect((await analyseTypeScript("a.ts", src)).error).toBe("");
    expect((await analyseTypeScript("a.tsx", src)).error).toContain("parse error");
  });
});

describe("typescript: a parse error", () => {
  test("is reported on the file, not raised, and no symbol is guessed", async () => {
    const report = await analyseTypeScript("bad.ts", "export function (\n");
    expect(report.error).toBe("parse error (tree-sitter reported ERROR nodes)");
    expect(report.symbols).toEqual([]);
  });

  test("parsesAsTypeScript tells a valid text from an invalid one, and reads a BOM", async () => {
    await analyseTypeScript("a.ts", "export const x = 1;\n");
    expect(parsesAsTypeScript("a.ts", "export const x = 1;\n")).toBe(true);
    expect(parsesAsTypeScript("a.ts", "export function (\n")).toBe(false);
    expect(parsesAsTypeScript("a.ts", "\uFEFFexport const x = 1;\n")).toBe(true);
  });
});
