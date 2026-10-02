/**
 * The stub writer of `repo-tools docs` (design section 16). The planners decide where a stub goes
 * and what it says. `applyInsertions` decides whether the result may be written. The cases port
 * `test_stub.py` of the code-docs skill, then add the revert, the line ends and the `.tsx` check.
 */
import { describe, expect, test } from "bun:test";
import { STUB_MARKER } from "../../src/docs/model.ts";
import { analysePython, parsesAsPython } from "../../src/docs/python.ts";
import {
  applyInsertions,
  type Insertion,
  planPython,
  planTypeScript,
  splitLines,
} from "../../src/docs/stub.ts";
import { analyseTypeScript, parsesAsTypeScript } from "../../src/docs/typescript.ts";
import { only } from "./docs-helpers.ts";

/** Plans and applies every Python stub of `source`; returns the new text. */
async function stubPython(source: string): Promise<string> {
  const report = await analysePython("a.py", source);
  const lines = splitLines(source);
  const plans = report.symbols
    .map((s) => planPython(s, lines))
    .filter((p): p is Insertion => p !== null);
  const done = applyInsertions(source, plans, parsesAsPython);
  expect(done.message).toMatch(/^inserted \d+ stub/);
  return done.text;
}

/** Plans and applies every TypeScript stub of `source`; returns the new text. */
async function stubTypeScript(source: string, path = "a.ts"): Promise<string> {
  const report = await analyseTypeScript(path, source);
  const lines = splitLines(source);
  const plans = report.symbols
    .map((s) => planTypeScript(s, lines))
    .filter((p): p is Insertion => p !== null);
  const done = applyInsertions(source, plans, (text) => parsesAsTypeScript(path, text));
  expect(done.message).toMatch(/^inserted \d+ stub/);
  return done.text;
}

describe("splitLines", () => {
  test("keeps each line end, and the last line when it has none", () => {
    expect(splitLines("a\nb\r\nc")).toEqual(["a\n", "b\r\n", "c"]);
    expect(splitLines("")).toEqual([]);
    expect(splitLines("a\n")).toEqual(["a\n"]);
  });
});

describe("planPython", () => {
  test("puts a docstring on the line after the def, with an Args and a Returns section", async () => {
    const out = await stubPython("def f(a, b):\n    return a\n");
    expect(out).toBe(
      [
        "def f(a, b):",
        `    """${STUB_MARKER} state what this does, in one active-voice sentence.`,
        "",
        "    Args:",
        `        a: ${STUB_MARKER} state what it is. Do not repeat the type.`,
        `        b: ${STUB_MARKER} state what it is. Do not repeat the type.`,
        "",
        "    Returns:",
        `        ${STUB_MARKER} state what the caller gets back.`,
        '    """',
        "    return a",
        "",
      ].join("\n"),
    );
  });

  test("a class gets a summary line only", async () => {
    const out = await stubPython("class C:\n    x = 1\n");
    expect(out).toBe(
      [
        "class C:",
        `    """${STUB_MARKER} state what this does, in one active-voice sentence.`,
        '    """',
        "    x = 1",
        "",
      ].join("\n"),
    );
  });

  test("a signature over several lines takes the docstring after the line that ends it", async () => {
    const src = "def f(\n    a,\n    b=(1, 2),\n) -> int:\n    return a\n";
    const out = await stubPython(src);
    const lines = out.split("\n");
    expect(lines[3]).toBe(") -> int:");
    expect(lines[4]).toStartWith(`    """${STUB_MARKER}`);
    expect(parsesAsPython(out)).toBe(true);
  });

  test("a method takes the indent of its body", async () => {
    const out = await stubPython("class C:\n    def m(self, x):\n        return x\n");
    expect(out).toContain(`        """${STUB_MARKER} state what this does`);
    expect(out).toContain("            x: ");
    expect(out).not.toContain("self:");
    expect(parsesAsPython(out)).toBe(true);
  });

  test("a symbol with a docstring gets no stub", async () => {
    const src = 'def f(a):\n    """Do it."""\n    return a\n';
    const report = await analysePython("a.py", src);
    expect(planPython(only(report.symbols), splitLines(src))).toBeNull();
  });

  test("the stubbed file has no M1, has M4 on every stub, and has no M3", async () => {
    const src =
      "def f(a, *args, **kw):\n    return a\n\nclass C:\n    def m(self, x):\n        pass\n";
    const out = await stubPython(src);
    const after = await analysePython("a.py", out);
    for (const sym of after.symbols) {
      const rules = sym.issues.map((i) => i.rule);
      expect(rules).not.toContain("M1");
      expect(rules).not.toContain("M3");
      expect(rules).toContain("M4");
    }
  });
});

describe("planTypeScript", () => {
  test("puts a TSDoc block above an exported function, with @param and @returns", async () => {
    const out = await stubTypeScript("export function f(a: number, b: number) {}\n");
    expect(out).toBe(
      [
        "/**",
        ` * ${STUB_MARKER} state what this does, in one active-voice sentence.`,
        " *",
        ` * @param a - ${STUB_MARKER} state what it is. Do not repeat the type.`,
        ` * @param b - ${STUB_MARKER} state what it is. Do not repeat the type.`,
        ` * @returns ${STUB_MARKER} state what the caller gets back.`,
        " */",
        "export function f(a: number, b: number) {}",
        "",
      ].join("\n"),
    );
  });

  test("a class and an interface get a summary line only", async () => {
    const out = await stubTypeScript("export class K {}\nexport interface I {}\n");
    expect(out).not.toContain("@param");
    expect(out).not.toContain("@returns");
    expect(out.match(/\/\*\*/g)).toHaveLength(2);
  });

  test("a method takes the indent of its line", async () => {
    const out = await stubTypeScript(
      "/** The class. */\nexport class K {\n  go(x: number) {}\n}\n",
    );
    expect(out).toContain("\n  /**\n   * ");
    expect(out).toContain("   * @param x - ");
    expect(out).toContain("   * @returns ");
    expect(out).toContain("   */\n  go(x: number) {}");
  });

  test("a decorated class gets its block above the decorator", async () => {
    const out = await stubTypeScript("@Dec()\nexport class K {}\n");
    expect(out.startsWith("/**\n")).toBe(true);
    expect(out.indexOf("@Dec()")).toBeGreaterThan(out.indexOf(" */"));
  });

  test("a .tsx file is checked with the TSX grammar", async () => {
    const src = "export function View() {\n  return <div>hi</div>;\n}\n";
    const out = await stubTypeScript(src, "a.tsx");
    expect(parsesAsTypeScript("a.tsx", out)).toBe(true);
    expect(out.startsWith("/**\n")).toBe(true);
  });

  test("the stubbed file has no M1, has M4 on every stub, and has no M3", async () => {
    const src = "export function f(a: number) {}\nexport class K {\n  go(x: number) {}\n}\n";
    const out = await stubTypeScript(src);
    const after = await analyseTypeScript("a.ts", out);
    const exported = after.symbols.filter((s) => s.exported);
    expect(exported.length).toBeGreaterThan(0);
    for (const sym of exported) {
      const rules = sym.issues.map((i) => i.rule);
      expect(rules).not.toContain("M1");
      expect(rules).not.toContain("M3");
      expect(rules).toContain("M4");
    }
  });

  test("a symbol with a doc comment gets no stub", async () => {
    const src = "/** Done. */\nexport function f() {}\n";
    const report = await analyseTypeScript("a.ts", src);
    expect(planTypeScript(only(report.symbols), splitLines(src))).toBeNull();
  });
});

describe("applyInsertions", () => {
  const stub = (lineIndex: number, text: string, symbol = "s"): Insertion => ({
    lineIndex,
    text,
    symbol,
  });

  test("applies from the bottom up, so each insertion point stays valid", () => {
    const original = "a\nb\nc\n";
    const done = applyInsertions(original, [stub(0, "X\n"), stub(2, "Y\n")], () => true);
    expect(done.ok).toBe(true);
    expect(done.text).toBe("X\na\nb\nY\nc\n");
    expect(done.message).toBe("inserted 2 stub(s)");
  });

  test("the order of the input does not matter", () => {
    const original = "a\nb\nc\n";
    const forward = applyInsertions(original, [stub(0, "X\n"), stub(2, "Y\n")], () => true);
    const backward = applyInsertions(original, [stub(2, "Y\n"), stub(0, "X\n")], () => true);
    expect(backward.text).toBe(forward.text);
  });

  test("writes the line end that the file uses", () => {
    const done = applyInsertions("a\r\nb\r\n", [stub(1, "X\nY\n")], () => true);
    expect(done.text).toBe("a\r\nX\r\nY\r\nb\r\n");
  });

  test("an insertion past the end goes at the end", () => {
    const done = applyInsertions("a\n", [stub(99, "Z\n")], () => true);
    expect(done.text).toBe("a\nZ\n");
  });

  test("reverts, and keeps the original text, when the result does not parse", () => {
    const original = "a\nb\n";
    const done = applyInsertions(original, [stub(1, "X\n")], () => false);
    expect(done.ok).toBe(false);
    expect(done.text).toBe(original);
    expect(done.message).toBe("REVERTED: the file would no longer parse after insertion");
  });

  test("hands the new text, not the old text, to the check", () => {
    let seen = "";
    applyInsertions("a\n", [stub(0, "X\n")], (text) => {
      seen = text;
      return true;
    });
    expect(seen).toBe("X\na\n");
  });

  test("no insertion is not ok", () => {
    const done = applyInsertions("a\n", [], () => true);
    expect(done).toEqual({ ok: false, text: "a\n", message: "no insertions" });
  });
});
