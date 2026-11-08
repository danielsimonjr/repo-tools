/**
 * The C# analyser of `repo-tools docs` (design section 16). The cases follow the plan order: the
 * grammar loads, the exported rule, a doc across an attribute, the parameters, the stale `<param>`
 * (M3), the dialect, the stub and its re-parse, and a file with a syntax error.
 */
import { describe, expect, test } from "bun:test";
import { analyseCSharp, parsesAsCSharp } from "../../src/docs/csharp.ts";
import type { DocSymbol } from "../../src/docs/model.ts";
import {
  applyInsertions,
  type Insertion,
  planTypeScript,
  splitLines,
} from "../../src/docs/stub.ts";

const symbols = async (src: string): Promise<DocSymbol[]> =>
  (await analyseCSharp("a.cs", src)).symbols;
const byName = (all: DocSymbol[], name: string): DocSymbol => {
  const found = all.find((s) => s.name === name);
  if (!found) throw new Error(`no symbol '${name}'`);
  return found;
};

describe("analyseCSharp", () => {
  test("a valid file parses, and its declarations are reported with their kinds", async () => {
    const all = await symbols(
      "public class K { public void M() {} public int P { get; set; } }\n" +
        "public struct S {}\npublic interface I {}\npublic enum E { A }\n" +
        "public record R(int X);\npublic record struct T(int Y);\npublic delegate int D(int x);\n",
    );
    expect(all.map((s) => `${s.name}:${s.kind}`)).toEqual([
      "K:class",
      "M:method",
      "P:property",
      "S:struct",
      "I:interface",
      "E:enum",
      "R:class",
      "T:struct",
      "D:type",
    ]);
  });

  test("public and protected are exported; internal, private and no modifier are not", async () => {
    const all = await symbols(
      "public class K {\n  public void A() {}\n  protected void B() {}\n  internal void C() {}\n" +
        "  private void D() {}\n  void E() {}\n  protected internal void F() {}\n" +
        "  private protected void G() {}\n}\nclass Hidden { public void H() {} }\n",
    );
    const exported = Object.fromEntries(all.map((s) => [s.name, s.exported]));
    expect(exported).toEqual({
      K: true,
      A: true,
      B: true,
      C: false,
      D: false,
      E: false,
      F: true,
      G: false,
      Hidden: false,
      H: false,
    });
  });

  test("an interface member is public with no modifier, when the interface is exported", async () => {
    const all = await symbols("public interface I { void F(int x); }\ninterface J { void G(); }\n");
    expect(byName(all, "F").exported).toBe(true);
    expect(byName(all, "G").exported).toBe(false);
  });

  test("a declaration inside a namespace is read, also with a file-scoped namespace", async () => {
    expect((await symbols("namespace N { public class K {} }\n")).map((s) => s.name)).toEqual([
      "K",
    ]);
    expect((await symbols("namespace N;\npublic class K {}\n")).map((s) => s.name)).toEqual(["K"]);
  });

  test("a /// run above an attribute documents the declaration", async () => {
    const [k] = await symbols("/// <summary>Holds it.</summary>\n[Obsolete]\npublic class K {}\n");
    expect(k?.hasDoc).toBe(true);
    expect(k?.summary).toBe("Holds it.");
    expect(k?.anchorLine).toBe(2);
  });

  test("a blank line keeps the doc, as the compiler does; a plain comment is not a doc", async () => {
    const gap = await symbols("/// <summary>Holds it.</summary>\n\npublic class K {}\n");
    expect(gap[0]?.hasDoc).toBe(true);
    const plain = await symbols("// Holds it.\npublic class K {}\n");
    expect(plain[0]?.hasDoc).toBe(false);
    expect(plain[0]?.issues.map((i) => i.rule)).toEqual(["M1"]);
  });

  test("a /** */ block is a doc comment", async () => {
    const [k] = await symbols("/** <summary>Holds it.</summary> */\npublic class K {}\n");
    expect(k?.hasDoc).toBe(true);
    expect(k?.summary).toBe("Holds it.");
  });

  test("the summary of a doc without <summary> is its first prose line", async () => {
    const [k] = await symbols("/// Holds it.\npublic class K {}\n");
    expect(k?.summary).toBe("Holds it.");
  });

  test("parameters: ref, out, params, a default and this", async () => {
    const all = await symbols(
      "public static class X {\n" +
        "  public static void M(this string s, ref int a, out int b, params int[] c, int d = 1) { b = 0; }\n}\n",
    );
    expect(byName(all, "M").params).toEqual(["s", "a", "b", "c", "d"]);
  });

  test("a record takes the parameters of its primary constructor", async () => {
    const [r] = await symbols("public record R(int X, string Y);\n");
    expect(r?.params).toEqual(["X", "Y"]);
  });

  test("a <param> that names no parameter is M3", async () => {
    const [m] = await symbols(
      '/// <summary>Runs it.</summary>\n/// <param name="a">A.</param>\n' +
        '/// <param name="gone">G.</param>\npublic class K {}\n',
    );
    expect(m?.docParams).toEqual(["a", "gone"]);
    const all = await symbols(
      'public class K {\n  /// <summary>Runs it.</summary>\n  /// <param name="gone">G.</param>\n' +
        "  public void M(int a) {}\n}\n",
    );
    const issues = byName(all, "M").issues.filter((i) => i.tier === "MUST");
    expect(issues).toEqual([
      {
        rule: "M3",
        tier: "MUST",
        detail: "documents parameter 'gone' which is not in the signature",
      },
    ]);
  });

  test("an XML tag marks the xmldoc dialect; a doc with no tag is neutral", async () => {
    const tagged = await analyseCSharp("a.cs", "/// <summary>A.</summary>\npublic class K {}\n");
    expect(tagged.symbols[0]?.dialect).toBe("xmldoc");
    expect([...tagged.dialects]).toEqual(["xmldoc"]);
    const plain = await analyseCSharp("a.cs", "/// A.\npublic class K {}\n");
    expect(plain.symbols[0]?.dialect).toBe("");
    expect(plain.dialects.size).toBe(0);
  });

  test("a file with a syntax error is unparsed", async () => {
    const report = await analyseCSharp("a.cs", "public class K { void M( }\n");
    expect(report.error).toMatch(/^parse error/);
    expect(report.symbols).toEqual([]);
  });
});

describe("the xmldoc stub", () => {
  test("goes above the attributes, holds a <param> per parameter, and the file still parses", async () => {
    const src = "public class K {\n  [Pure]\n  public int M(int a, int b) { return a; }\n}\n";
    const report = await analyseCSharp("a.cs", src);
    const lines = splitLines(src);
    const plans = report.symbols
      .map((s) => planTypeScript(s, lines, "xmldoc"))
      .filter((p): p is Insertion => p !== null);
    const done = applyInsertions(src, plans, (text) => parsesAsCSharp("a.cs", text));
    expect(done.ok).toBe(true);
    expect(done.text).toContain(
      [
        "  /// <summary>",
        "  /// TODO: state what this does, in one active-voice sentence.",
        "  /// </summary>",
        '  /// <param name="a">TODO: state what it is. Do not repeat the type.</param>',
        '  /// <param name="b">TODO: state what it is. Do not repeat the type.</param>',
        "  /// <returns>TODO: state what the caller gets back.</returns>",
        "  [Pure]",
      ].join("\n"),
    );
    const after = await analyseCSharp("a.cs", done.text);
    for (const sym of after.symbols) {
      const rules = sym.issues.map((i) => i.rule);
      expect(rules).not.toContain("M1");
      expect(rules).not.toContain("M3");
      expect(rules).toContain("M4");
    }
  });

  test("a void method and a constructor get no <returns> line", async () => {
    const src = "public class K {\n  public K() {}\n  public void M() {}\n}\n";
    const report = await analyseCSharp("a.cs", src);
    const lines = splitLines(src);
    for (const name of ["K", "M"]) {
      const sym = report.symbols.filter((s) => s.kind === "method").find((s) => s.name === name);
      expect(sym).toBeDefined();
      const plan = planTypeScript(sym as DocSymbol, lines, "xmldoc");
      expect(plan?.text).not.toContain("<returns>");
    }
  });
});
