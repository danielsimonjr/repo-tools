import { describe, expect, test } from "bun:test";
import { analyseKotlin, parsesAsKotlin } from "../../src/docs/kotlin.ts";
import type { DocSymbol } from "../../src/docs/model.ts";
import {
  applyInsertions,
  type Insertion,
  planTypeScript,
  splitLines,
} from "../../src/docs/stub.ts";

const symbols = async (src: string, path = "a.kt"): Promise<DocSymbol[]> =>
  (await analyseKotlin(path, src)).symbols;

const byName = (list: readonly DocSymbol[], name: string): DocSymbol => {
  const found = list.find((symbol) => symbol.name === name);
  if (found === undefined) throw new Error(`missing symbol ${name}`);
  return found;
};

const names = (list: readonly DocSymbol[]): string[] => list.map((symbol) => symbol.name);

describe("kinds", () => {
  test("reports symbols in document order", async () => {
    const src = `class A {
  fun m() {}
  val prop = 1
  class Nested {
  }
}
object O {
}
interface I {
}
enum class E {
  X,
}
typealias Alias = Map<String, Int>
fun top() {}
`;
    const list = await symbols(src);
    expect(names(list)).toEqual(["A", "m", "prop", "Nested", "O", "I", "E", "Alias", "top"]);
    expect(byName(list, "A").kind).toBe("class");
    expect(byName(list, "m").kind).toBe("method");
    expect(byName(list, "prop").kind).toBe("property");
    expect(byName(list, "Nested").kind).toBe("class");
    expect(byName(list, "O").kind).toBe("class");
    expect(byName(list, "I").kind).toBe("interface");
    expect(byName(list, "E").kind).toBe("enum");
    expect(byName(list, "Alias").kind).toBe("type");
    expect(byName(list, "top").kind).toBe("function");
  });

  test("treats .kts top-level declarations as functions and properties", async () => {
    const list = await symbols("fun f() {}\nval v = 1\n", "a.kts");
    expect(byName(list, "f").kind).toBe("function");
    expect(byName(list, "v").kind).toBe("property");
  });
});

describe("exported", () => {
  test("uses Kotlin default visibility and ancestor visibility", async () => {
    const src = `fun plain() {}
public fun pub() {}
protected fun prot() {}
internal fun intern() {}
private fun priv() {}
private class Hidden {
  fun h() {}
}
class K {
  companion object {
    fun c() {}
  }
}
class P {
  private companion object {
    fun d() {}
  }
}
fun outer() {
  fun g() {}
  class L
}
`;
    const list = await symbols(src);
    expect(byName(list, "plain").exported).toBe(true);
    expect(byName(list, "pub").exported).toBe(true);
    expect(byName(list, "prot").exported).toBe(true);
    expect(byName(list, "intern").exported).toBe(false);
    expect(byName(list, "priv").exported).toBe(false);
    expect(byName(list, "h").exported).toBe(false);
    expect(byName(list, "c").exported).toBe(true);
    expect(byName(list, "d").exported).toBe(false);
    expect(byName(list, "g").exported).toBe(false);
    expect(byName(list, "L").exported).toBe(false);
  });
});

describe("doc", () => {
  test("associates KDoc across annotations", async () => {
    const src = `/** Doc. */
@Suppress("x")
class A(val x: Int) {
}
`;
    const a = byName(await symbols(src), "A");
    expect(a.hasDoc).toBe(true);
    expect(a.anchorLine).toBe(2);
  });

  test("keeps KDoc across a blank line", async () => {
    const src = `/** Doc. */

fun f() {}
`;
    expect(byName(await symbols(src), "f").hasDoc).toBe(true);
  });

  test("does not treat line or plain block comments as doc", async () => {
    const src = `// line
/* plain */
fun g() {}
`;
    expect(byName(await symbols(src), "g").hasDoc).toBe(false);
  });
});

describe("params", () => {
  test("reads function parameters", async () => {
    const m = byName(
      await symbols("fun m(a: Int = 1, vararg rest: String, cb: (Int) -> Unit) {}\n"),
      "m",
    );
    expect(m.params).toEqual(["a", "rest", "cb"]);
  });

  test("reads class primary constructor parameters", async () => {
    const d = byName(await symbols("class D(val x: Int, y: String) {\n}\n"), "D");
    expect(d.params).toEqual(["x", "y"]);
  });
});

describe("M3", () => {
  test("reports only a documented parameter that the function lacks", async () => {
    const src = `/**
 * Does things.
 *
 * @param a real
 * @property x real
 * @param gone missing
 */
fun f(a: Int, x: Int) {
}
`;
    const f = byName(await symbols(src), "f");
    const m3 = f.issues.filter((issue) => issue.rule === "M3");
    expect(m3).toHaveLength(1);
    expect(m3[0]?.detail ?? "").toContain("gone");
  });

  test("accepts a bracketed parameter tag", async () => {
    const g = byName(await symbols("/** @param[a] ok */\nfun g(a: Int) {}\n"), "g");
    expect(g.docParams).toContain("a");
  });
});

describe("dialect", () => {
  test("detects KDoc tags", async () => {
    const withTag = byName(
      await symbols("/**\n * @property x\n */\nclass C(val x: Int) {\n}\n"),
      "C",
    );
    expect(withTag.dialect).toBe("kdoc");
  });

  test("gives no dialect without KDoc tags", async () => {
    const plain = byName(await symbols("/** Runs it. */\nfun f() {}\n"), "f");
    expect(plain.dialect).toBe("");
  });
});

describe("names", () => {
  test("reads type aliases and top-level properties", async () => {
    const list = await symbols("typealias Alias = Map<String, Int>\nval top: Int = 1\n");
    expect(names(list)).toEqual(["Alias", "top"]);
  });
});

describe("returnsValue", () => {
  test("reads function return types and bodies", async () => {
    const list = await symbols(`fun f(): Int = 1
fun g() {}
fun h() = 1
fun i(): Unit {}
fun j(): String? = null
`);
    expect(byName(list, "f").returnsValue).toBe(true);
    expect(byName(list, "g").returnsValue).toBe(false);
    expect(byName(list, "h").returnsValue).toBeUndefined();
    expect(byName(list, "i").returnsValue).toBe(false);
    expect(byName(list, "j").returnsValue).toBe(true);
  });
});

describe("stub", () => {
  test("plans and applies a KDoc stub for a function", async () => {
    const src = "fun area(w: Int): Int {\n  return w\n}\n";
    const area = byName(await symbols(src), "area");
    const plan = planTypeScript(area, splitLines(src), "kdoc");
    const plans: Insertion[] = plan === null ? [] : [plan];
    const applied = await applyInsertions(src, plans, (text: string) =>
      parsesAsKotlin("a.kt", text),
    );
    expect(applied.ok).toBe(true);
    expect(await parsesAsKotlin("a.kt", applied.text)).toBe(true);

    const lines = applied.text.split("\n");
    expect(lines).toContain("/**");
    expect(lines).toContain(" * TODO: state what this does, in one active-voice sentence.");
    expect(lines).toContain(" *");
    expect(lines).toContain(" * @param w TODO: state what it is. Do not repeat the type.");
    expect(lines).toContain(" * @return TODO: state what the caller gets back.");
    expect(lines).toContain(" */");

    const after = byName(await symbols(applied.text), "area");
    expect(after.issues.some((issue) => issue.rule === "M1")).toBe(false);
    expect(after.issues.some((issue) => issue.rule === "M3")).toBe(false);
    expect(after.issues.some((issue) => issue.rule === "M4")).toBe(true);
  });

  test("plans a parameter stub without a return tag for a class", async () => {
    const src = "class Tool(val name: String) {\n}\n";
    const tool = byName(await symbols(src), "Tool");
    const plan = planTypeScript(tool, splitLines(src), "kdoc");
    const plans: Insertion[] = plan === null ? [] : [plan];
    const applied = await applyInsertions(src, plans, (text: string) =>
      parsesAsKotlin("a.kt", text),
    );
    expect(applied.text).toContain(
      " * @param name TODO: state what it is. Do not repeat the type.",
    );
    expect(applied.text).not.toContain("@return");
  });
});

describe("parse errors", () => {
  test("reports an incomplete function", async () => {
    const report = await analyseKotlin("a.kt", "fun f( {");
    expect(report.error ?? "").toMatch(/^parse error/);
    expect(report.symbols).toEqual([]);
  });

  test("reports a class body that closes on the line of its last member", async () => {
    const report = await analyseKotlin("a.kt", "object O { fun o() {} }\n");
    expect(report.error ?? "").toMatch(/^parse error/);
    expect(report.symbols).toEqual([]);
  });
});
