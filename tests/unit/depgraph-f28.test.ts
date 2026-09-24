/**
 * Fix F28: a symbol name is escaped before it goes into a RegExp. A `$` in a name is an
 * identifier character, not an anchor, so an export named `$store` gets its real in-file
 * reference count.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F28: RegExp-safe symbol names", () => {
  test("an export named $store used once in its file has 1 in-file ref", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f28", "version": "1.0.0" }',
      "src/index.ts":
        "/** Entry. */\nimport { other } from './store.js';\nexport const main = other;\n",
      "src/store.ts":
        "/** Store. */\nexport const other = 1;\n" +
        "export const $store = { n: 1 };\nexport const a$b = 2;\n" +
        "const view = $store.n + a$b;\nview;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const report = result.report("unused-analysis.md");
    expect(report).toContain("`$store` (constant) — 1 in-file ref\n");
    expect(report).toContain("`a$b` (constant) — 1 in-file ref\n");
    const exports = result.graph().modules.root?.["src/store.ts"]?.exports;
    expect(exports).toEqual(["other", "$store", "a$b"]);
  });
});
