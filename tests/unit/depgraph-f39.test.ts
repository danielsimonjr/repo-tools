/**
 * Fix F39: the comment stripper of `src/mask.ts` recognizes regular-expression literals. A quote
 * in a regex does not open a string, and a `/` in a regex does not start a comment. The in-file
 * reference count of an unused export (fix F24) reads the result.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { blankCommentsAndStrings, stripComments } from "../../src/mask.ts";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F39: regular-expression literals in the masker", () => {
  test("a quote in a regex does not open a string", () => {
    const src = 'const r = /"/g; // gone\nx();';
    expect(stripComments(src)).toBe('const r = /"/g; \nx();');
    expect(blankCommentsAndStrings(src)).toBe("const r = / /g;        \nx();");
  });

  test("an escaped slash, a class and a backtick in a regex do not start a comment or a template", () => {
    const src = "const u = /a\\//; const c = /[/`]/; b(); // gone\nx();";
    expect(stripComments(src)).toBe("const u = /a\\//; const c = /[/`]/; b(); \nx();");
  });

  test("a regex after an operator, a keyword and an arrow", () => {
    expect(stripComments("f(/'/, x); // gone")).toBe("f(/'/, x); ");
    expect(stripComments("return /'/.test(s); // gone")).toBe("return /'/.test(s); ");
    expect(stripComments("const t = (s) => /'/.test(s); // gone")).toBe(
      "const t = (s) => /'/.test(s); ",
    );
  });

  test("a division is not a regex", () => {
    expect(stripComments("const x = a / b; // gone")).toBe("const x = a / b; ");
    expect(stripComments("const y = (a) / 2 / c['k'] / 4; // gone")).toBe(
      "const y = (a) / 2 / c['k'] / 4; ",
    );
    expect(stripComments("const z = n / 2; const s = '/'; // gone")).toBe(
      "const z = n / 2; const s = '/'; ",
    );
  });

  test("the in-file reference count reads code after a regex correctly", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f39", "version": "1.0.0" }',
      "src/index.ts":
        "/** Entry. */\nimport { used } from './lib.js';\nexport const main = used;\n",
      "src/lib.ts":
        "/** Lib. */\nexport const used = 1;\n" +
        "export function quoted(): number {\n  return 1;\n}\n" +
        "export function slashed(): number {\n  return 2;\n}\n" +
        'const q = /"/g; const a = quoted(); // quoted\n' +
        "const s = /a\\//; const b = slashed();\n" +
        "export const all = [q, a, s, b];\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const report = result.report("unused-analysis.md");
    expect(report).toContain("`quoted` (function) — 1 in-file ref\n");
    expect(report).toContain("`slashed` (function) — 1 in-file ref\n");
  });
});
