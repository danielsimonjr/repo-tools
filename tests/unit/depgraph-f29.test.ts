/**
 * Fix F29: `export { r as s } from './x.js'` exports `s` only. The re-export edge still names
 * `r`, the name that the source file exports, so `r` stays used.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { graphFile, makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F29: aliased re-exports", () => {
  test("an aliased re-export records the alias once", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f29", "version": "1.0.0" }',
      "src/index.ts":
        "/** Entry. */\nexport { r as s } from './x.js';\nexport type { T as U } from './x.js';\n",
      "src/x.ts": "/** X. */\nexport const r = 1;\nexport type T = number;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const graph = result.graph() as unknown as {
      statistics: { totalExports: number };
    } & Parameters<typeof graphFile>[0];
    const index = graphFile(graph, "src/index.ts") as unknown as {
      exports: string[];
      reExported: string[];
      internalDependencies: { file: string; imports: string[] }[];
    };
    expect(index.exports).toEqual(["s", "U"]);
    expect(index.reExported).toEqual(["s", "U"]);
    expect(index.internalDependencies.flatMap((d) => d.imports)).toEqual(["r", "T"]);
    // src/x.ts exports r (1 named export); src/index.ts exports s and U.
    expect(graph.statistics.totalExports).toBe(3);
    expect(result.report("unused-analysis.md")).toContain("- **Potentially unused exports**: 0\n");
  });
});
