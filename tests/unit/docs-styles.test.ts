/**
 * The docstring styles of `docs stub --style=`: each style writes the marker on every line that
 * needs text, and the analyser reads the stub back as the dialect of the style.
 */
import { describe, expect, test } from "bun:test";
import { analyseGo, parsesAsGo } from "../../src/docs/go.ts";
import { analyseJava, parsesAsJava } from "../../src/docs/java.ts";
import { analyseKotlin, parsesAsKotlin } from "../../src/docs/kotlin.ts";
import { type DocSymbol, type FileReport, STUB_MARKER } from "../../src/docs/model.ts";
import { analysePython, parsesAsPython } from "../../src/docs/python.ts";
import {
  applyInsertions,
  type Insertion,
  planPython,
  planTypeScript,
  splitLines,
} from "../../src/docs/stub.ts";
import { STYLES } from "../../src/docs/styles.ts";
import { analyseTypeScript, parsesAsTypeScript } from "../../src/docs/typescript.ts";

/** A function symbol with two parameters, for the render tests. */
const FN: DocSymbol = {
  file: "a",
  line: 1,
  anchorLine: 1,
  anchorColumn: 0,
  name: "f",
  kind: "function",
  exported: true,
  hasDoc: false,
  params: ["a", "b"],
  docParams: [],
  summary: "",
  dialect: "",
  issues: [],
};

/** Stubs every symbol of a Python `source` in `style`; returns the new text. */
async function stubPy(source: string, style: string): Promise<string> {
  const report = await analysePython("a.py", source);
  const lines = splitLines(source);
  const plans = report.symbols
    .map((s) => planPython(s, lines, style))
    .filter((p): p is Insertion => p !== null);
  const done = applyInsertions(source, plans, parsesAsPython);
  expect(done.ok).toBe(true);
  return done.text;
}

/** Stubs every symbol of a TypeScript or JavaScript `source` in `style`; returns the new text. */
async function stubTs(source: string, style: string, path: string): Promise<string> {
  const report = await analyseTypeScript(path, source);
  const lines = splitLines(source);
  const plans = report.symbols
    .map((s) => planTypeScript(s, lines, style))
    .filter((p): p is Insertion => p !== null);
  const done = applyInsertions(source, plans, (t) => parsesAsTypeScript(path, t));
  expect(done.ok).toBe(true);
  return done.text;
}

describe("every style", () => {
  for (const [id, style] of Object.entries(STYLES)) {
    test(`${id}: the summary line and each parameter line hold the marker`, () => {
      const lines = style.render(FN, "");
      // One marker line for the summary, one for each parameter, one for the return value.
      // GoDoc has no parameter tag and no return tag: its stub is the summary line alone.
      const expected = id === "godoc" ? 1 : 2 + FN.params.length;
      expect(lines.filter((l) => l.includes(STUB_MARKER)).length).toBe(expected);
      expect(style.id).toBe(id);
    });
  }
});

describe("python styles are read back as their dialect", () => {
  const SRC = "def f(a, b):\n    return a\n";
  for (const style of ["google", "numpy", "rest"]) {
    test(`${style}`, async () => {
      const out = await stubPy(SRC, style);
      const report = await analysePython("a.py", out);
      const f = report.symbols[0];
      expect(f?.hasDoc).toBe(true);
      expect(f?.dialect).toBe(style);
      expect([...report.dialects]).toEqual([style]);
      expect(f?.issues.filter((i) => i.rule === "M3")).toEqual([]);
    });
  }

  test("numpy writes the Parameters and Returns sections", async () => {
    const out = await stubPy(SRC, "numpy");
    expect(out).toContain("    Parameters\n    ----------\n    a\n");
    expect(out).toContain("    Returns\n    -------\n");
  });

  test("rest writes one :param: line per parameter and a :returns: line", async () => {
    const out = await stubPy(SRC, "rest");
    expect(out).toContain(`    :param a: ${STUB_MARKER}`);
    expect(out).toContain(`    :returns: ${STUB_MARKER}`);
  });
});

describe("typescript styles are read back as their dialect", () => {
  test("tsdoc", async () => {
    const out = await stubTs("export function f(a: number) { return a; }\n", "tsdoc", "a.ts");
    const report = await analyseTypeScript("a.ts", out);
    expect([...report.dialects]).toEqual(["tsdoc"]);
  });

  test("jsdoc writes a type slot that the writer fills", async () => {
    const out = await stubTs("export function f(a) { return a; }\n", "jsdoc", "a.js");
    expect(out).toContain(` * @param {${STUB_MARKER} type} a ${STUB_MARKER}`);
    const report = await analyseTypeScript("a.js", out);
    expect([...report.dialects]).toEqual(["jsdoc"]);
    expect(report.symbols[0]?.docParams).toEqual(["a"]);
  });
});

describe("godoc, javadoc and kdoc", () => {
  const M = STUB_MARKER;
  const METHOD: DocSymbol = { ...FN, name: "Run", kind: "method" };
  const TYPE: DocSymbol = { ...FN, name: "Box", kind: "struct", params: [] };

  test("godoc is one line that starts with the name of the symbol", () => {
    expect(STYLES.godoc?.language).toBe("go");
    expect(STYLES.godoc?.render(FN, "")).toEqual([
      `// f ${M} state what this does, in one active-voice sentence.`,
    ]);
    expect(STYLES.godoc?.render(TYPE, "\t")).toEqual([
      `\t// Box ${M} state what this does, in one active-voice sentence.`,
    ]);
  });

  for (const [id, language] of [
    ["javadoc", "java"],
    ["kdoc", "kotlin"],
  ] as const) {
    test(`${id} writes @param for each parameter and @return for a value`, () => {
      const style = STYLES[id];
      expect(style?.language).toBe(language);
      const lines = style?.render(METHOD, "  ") ?? [];
      expect(lines[0]).toBe("  /**");
      expect(lines.at(-1)).toBe("   */");
      expect(lines).toContain(`   * @param a ${M} state what it is. Do not repeat the type.`);
      expect(lines).toContain(`   * @param b ${M} state what it is. Do not repeat the type.`);
      expect(lines).toContain(`   * @return ${M} state what the caller gets back.`);
      expect(lines.join("\n")).not.toContain("@returns");
    });

    test(`${id} writes no @return for a type or for a method that returns nothing`, () => {
      const style = STYLES[id];
      expect(style?.render(TYPE, "").join("\n")).not.toContain("@return");
      const none = style?.render({ ...METHOD, returnsValue: false }, "").join("\n") ?? "";
      expect(none).not.toContain("@return");
      expect(none).toContain("@param a");
    });
  }
});

describe("godoc, javadoc and kdoc are read back as their dialect", () => {
  /** Stubs the symbol `name` of `source` in `style`, applies the stub and analyses the result. */
  async function readBack(
    name: string,
    path: string,
    source: string,
    style: string,
    analyse: (path: string, source: string) => Promise<FileReport>,
    parses: (path: string, text: string) => boolean,
  ): Promise<{ out: string; report: FileReport }> {
    const first = (await analyse(path, source)).symbols.find((s) => s.name === name);
    if (!first) throw new Error(`no symbol ${name}`);
    const plan = planTypeScript(first, splitLines(source), style);
    if (!plan) throw new Error("no stub");
    const done = applyInsertions(source, [plan], (t) => parses(path, t));
    expect(done.ok).toBe(true);
    return { out: done.text, report: await analyse(path, done.text) };
  }

  test("godoc", async () => {
    const { out, report } = await readBack(
      "Run",
      "a.go",
      "package p\n\nfunc Run(n int) int {\n\treturn n\n}\n",
      "godoc",
      analyseGo,
      parsesAsGo,
    );
    expect(out).toContain(`// Run ${STUB_MARKER}`);
    expect([...report.dialects]).toEqual(["godoc"]);
  });

  test("javadoc", async () => {
    const { out, report } = await readBack(
      "run",
      "A.java",
      "public class A {\n  public int run(int n) {\n    return n;\n  }\n}\n",
      "javadoc",
      analyseJava,
      parsesAsJava,
    );
    expect(out).toContain(` * @param n ${STUB_MARKER}`);
    expect([...report.dialects]).toEqual(["javadoc"]);
    expect(report.symbols.find((s) => s.name === "run")?.docParams).toEqual(["n"]);
  });

  test("kdoc", async () => {
    const { out, report } = await readBack(
      "run",
      "a.kt",
      "fun run(n: Int): Int {\n    return n\n}\n",
      "kdoc",
      analyseKotlin,
      parsesAsKotlin,
    );
    expect(out).toContain(` * @return ${STUB_MARKER}`);
    expect([...report.dialects]).toEqual(["kdoc"]);
    expect(report.symbols[0]?.docParams).toEqual(["n"]);
  });
});
