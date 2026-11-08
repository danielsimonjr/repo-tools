/**
 * The docstring styles of `docs stub --style=`: each style writes the marker on every line that
 * needs text, and the analyser reads the stub back as the dialect of the style.
 */
import { describe, expect, test } from "bun:test";
import { type DocSymbol, STUB_MARKER } from "../../src/docs/model.ts";
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
      expect(lines.filter((l) => l.includes(STUB_MARKER)).length).toBe(2 + FN.params.length);
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
