/**
 * Fix F29: `export { r as s } from './x.js'` exports `s` only. The re-export edge still names
 * `r`, the name that the source file exports, so `r` stays used. Each `export ... from` is one
 * edge (a named re-export does not also write an empty-imports edge).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { graphFile, makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F29: aliased re-exports", () => {
  test("an aliased re-export records the alias once and the source name on the edge", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f29", "version": "1.0.0" }',
      "src/index.ts":
        "/** Entry. */\nexport { r as s } from './x.js';\nexport type { T as U } from './x.js';\n",
      "src/x.ts": "/** X. */\nexport const r = 1;\nexport type T = number;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const index = graphFile(result.graph(), "src/index.ts");
    expect(index?.exports).toEqual(["s", "U"]);
    expect(index?.internalDependencies).toEqual([
      { file: "src/x.ts", imports: ["r"], typeOnly: false },
      { file: "src/x.ts", imports: ["T"], typeOnly: true },
    ]);
    const unused = result.report("unused-analysis.md");
    const dead = unused.split("\n## Exports unreferenced anywhere\n")[1] ?? "";
    expect(dead.split("\n## ")[0]).not.toContain("`r`");
    expect(dead.split("\n## ")[0]).not.toContain("`T`");
  });
});
