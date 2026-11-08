import { describe, expect, test } from "bun:test";
import { analyseJava, parsesAsJava } from "../../src/docs/java.ts";
import type { DocSymbol } from "../../src/docs/model.ts";
import {
  applyInsertions,
  type Insertion,
  planTypeScript,
  splitLines,
} from "../../src/docs/stub.ts";

/** Return symbols of a Java source string. */
const symbols = async (src: string): Promise<DocSymbol[]> =>
  (await analyseJava("A.java", src)).symbols;

/** Return a named symbol, or throw when it is absent. */
const byName = (list: readonly DocSymbol[], name: string, kind?: DocSymbol["kind"]): DocSymbol => {
  const found = list.find(
    (symbol) => symbol.name === name && (kind === undefined || symbol.kind === kind),
  );
  if (found === undefined) {
    throw new Error(`missing symbol ${name}`);
  }
  return found;
};

describe("docs/java", () => {
  test("reports kinds in document order", async () => {
    const source = `public class A {
  public void m() {}
  public A() {}
  public static class Nested {}
}
record R(int x, int y) { R { } }
enum E { X }
@interface Ann {}
interface I {}`;
    const list = await symbols(source);
    expect(list.map((symbol) => `${symbol.name}:${symbol.kind}`)).toEqual([
      "A:class",
      "m:method",
      "A:method",
      "Nested:class",
      "R:class",
      "R:method",
      "E:enum",
      "Ann:type",
      "I:interface",
    ]);
  });

  test("computes export visibility", async () => {
    const source = `public class PublicOuter {
  public void pub() {}
  protected void prot() {}
  void pkg() {}
  private void priv() {}
  public static class Nested {}
}
class Inner { public void p() {} }
public interface I { void implicit(); }
interface J { void k(); }
public interface K { private void priv() {} }
public sealed interface Shape permits Sq {}
final class Sq implements Shape {}`;
    const report = await analyseJava("A.java", source);
    expect(report.error ?? "").toBe("");
    const list = report.symbols;
    expect(byName(list, "pub").exported).toBe(true);
    expect(byName(list, "prot").exported).toBe(true);
    expect(byName(list, "pkg").exported).toBe(false);
    expect(byName(list, "priv").exported).toBe(false);
    expect(byName(list, "Nested").exported).toBe(true);
    expect(byName(list, "p").exported).toBe(false);
    expect(byName(list, "implicit").exported).toBe(true);
    expect(byName(list, "k").exported).toBe(false);
    expect(byName(list, "priv", "method").exported).toBe(false);
  });

  test("finds Javadoc across annotations and skipped comments", async () => {
    const source = `public class A {
  /** Doc. */
  @Override
  @SuppressWarnings("x")
  public void m() {}
}`;
    const m = byName(await symbols(source), "m");
    expect(m.hasDoc).toBe(true);
    expect(m.anchorLine).toBe(3);
  });

  test("finds Javadoc across blank lines", async () => {
    const source = `public class A {
  /** Doc. */

  public void m() {}
}`;
    expect(byName(await symbols(source), "m").hasDoc).toBe(true);
  });

  test("finds Javadoc across a line comment", async () => {
    const source = `public class A {
  /** Doc. */
  // note
  public void m() {}
}`;
    expect(byName(await symbols(source), "m").hasDoc).toBe(true);
  });

  test("rejects non-Javadoc comments", async () => {
    const source = `public class A {
  // line
  public void a() {}
  /* plain */
  public void b() {}
  /**/
  public void c() {}
}`;
    const list = await symbols(source);
    expect(byName(list, "a").hasDoc).toBe(false);
    expect(byName(list, "b").hasDoc).toBe(false);
    expect(byName(list, "c").hasDoc).toBe(false);
  });

  test("reads parameters from methods and records", async () => {
    const source = `public class A {
  public void m(int a, String... rest) {}
}
record R(int x, int y) { R { } }`;
    const list = await symbols(source);
    expect(byName(list, "m").params).toEqual(["a", "rest"]);
    expect(byName(list, "R", "class").params).toEqual(["x", "y"]);
    expect(byName(list, "R", "method").params).toEqual(["x", "y"]);
  });

  test("reports a stale documented parameter", async () => {
    const source = `public class A {
  /**
   * Does.
   * @param a first
   * @param gone second
   */
  public void m(int a) {}
}`;
    const m = byName(await symbols(source), "m");
    const must = m.issues.filter((issue) => issue.tier === "MUST");
    expect(must).toHaveLength(1);
    expect(must[0]?.rule).toBe("M3");
    expect(must[0]?.detail).toBe("documents parameter 'gone' which is not in the signature");
  });

  test("ignores a generic parameter tag for M3", async () => {
    const source = `public class A {
  /**
   * Does.
   * @param <T> type
   */
  public <T> void g(T a) {}
}`;
    const g = byName(await symbols(source), "g");
    expect(g.issues.some((issue) => issue.rule === "M3")).toBe(false);
  });

  test("detects Javadoc dialect evidence", async () => {
    const source = `public class A {
  /**
   * Does.
   * @param x docs
   */
  public void a(int x) {}
  /**
   * Does.
   * {@link X}
   */
  public void b() {}
  /**
   * Runs it.
   */
  public void c() {}
  /**
   * Runs.
   * @returns x
   */
  public void d() {}
}`;
    const list = await symbols(source);
    expect(byName(list, "a").dialect).toBe("javadoc");
    expect(byName(list, "b").dialect).toBe("javadoc");
    expect(byName(list, "c").dialect).toBe("");
    expect(byName(list, "d").dialect).toBe("");
  });

  test("plans Javadoc stubs and validates the result", async () => {
    const source = `public class A {
    public int area(int w) {
        return w;
    }
}`;
    const symbol = byName(await symbols(source), "area");
    const insertion: Insertion | null = planTypeScript(symbol, splitLines(source), "javadoc");
    if (insertion === null) {
      throw new Error("missing insertion");
    }
    const fragments = [
      "/**",
      " * TODO: state what this does, in one active-voice sentence.",
      " *",
      " * @param w TODO: state what it is. Do not repeat the type.",
      " * @return TODO: state what the caller gets back.",
      " */",
    ];
    let from = 0;
    for (const fragment of fragments) {
      const needle = `    ${fragment}`;
      const index = insertion.text.indexOf(needle, from);
      expect(index).toBeGreaterThanOrEqual(0);
      from = index + needle.length;
    }

    const voidSource = `public class A {
    public void v() {}
}`;
    const voidSymbol = byName(await symbols(voidSource), "v");
    const voidInsertion = planTypeScript(voidSymbol, splitLines(voidSource), "javadoc");
    if (voidInsertion === null) {
      throw new Error("missing void insertion");
    }
    expect(voidInsertion.text.includes("@return")).toBe(false);

    const ctorSource = `public class A {
    public A() {}
}`;
    const ctorSymbol = byName(await symbols(ctorSource), "A", "method");
    const ctorInsertion = planTypeScript(ctorSymbol, splitLines(ctorSource), "javadoc");
    if (ctorInsertion === null) {
      throw new Error("missing constructor insertion");
    }
    expect(ctorInsertion.text.includes("@return")).toBe(false);

    const result = applyInsertions(source, [insertion], (text) => parsesAsJava("", text));
    expect(result.ok).toBe(true);
    const after = await symbols(result.text);
    const exportedMethods = after.filter((item) => item.exported && item.kind === "method");
    expect(exportedMethods.length).toBeGreaterThan(0);
    for (const item of exportedMethods) {
      expect(item.issues.some((issue) => issue.rule === "M1")).toBe(false);
      expect(item.issues.some((issue) => issue.rule === "M3")).toBe(false);
      expect(item.issues.some((issue) => issue.rule === "M4")).toBe(true);
    }
  });

  test("does not export local or anonymous-class members", async () => {
    const source = `public class A {
  public void m() {
    class Local {}
  }
  public void make() {
    Runnable r = new Runnable() {
      public void run() {}
    };
  }
}`;
    const list = await symbols(source);
    expect(byName(list, "Local").exported).toBe(false);
    expect(byName(list, "run").exported).toBe(false);
  });

  test("reports a syntax error", async () => {
    const report = await analyseJava("A.java", "public class A { void m( {} }");
    expect(report.error).toMatch(/^parse error/);
    expect(report.symbols).toEqual([]);
  });
});
