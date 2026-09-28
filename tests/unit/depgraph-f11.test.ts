/**
 * Fix F11: a dynamic `import()` is a dependency edge. Fix F25 asserts the kind of the edge
 * (runtime or type-only); this test asserts only that the edge exists.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { graphFile, makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F11: dynamic import() is a dependency", () => {
  test("await import('./x.js') gives an edge to x", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f11", "version": "1.0.0" }',
      "src/index.ts":
        "/** Entry. */\nexport async function load(): Promise<number> {\n" +
        "  const mod = await import('./x.js');\n  return mod.x;\n}\n",
      "src/x.ts": "/** X. */\nexport const x = 1;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const edges = graphFile(result.graph(), "src/index.ts")?.internalDependencies ?? [];
    expect(edges.map((e) => e.file)).toEqual(["src/x.ts"]);
    expect(edges[0]?.imports).toEqual(["*"]);
    const unused = JSON.parse(result.report("unused-analysis.json")) as {
      noImporterFiles: string[];
      unreferencedAnywhere: Record<string, string[]>;
    };
    expect(unused.noImporterFiles).not.toContain("src/x.ts");
    expect(unused.unreferencedAnywhere["src/x.ts"]).toBeUndefined();
  });
});
