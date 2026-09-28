/**
 * Fix F25: a dynamic `import()` is a runtime edge unless it is in a type position. The edge
 * kinds of each fixture are locked in `map-parsing-ts.test.ts`. This file locks the cycle: a
 * runtime `import()` closes a runtime component.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F25: runtime and type-position import()", () => {
  test("await import() in a and import './a.js' in b is a runtime cycle", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f25", "version": "1.0.0" }',
      "src/index.ts": "/** Entry. */\nexport { load } from './a.js';\n",
      "src/a.ts":
        "/** A. */\nexport async function load(): Promise<unknown> {\n" +
        "  return await import('./b.js');\n}\n",
      "src/b.ts": "/** B. */\nimport './a.js';\nexport const b = 1;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const layers = JSON.parse(result.report("dependency-layers.json")) as {
      cyclicComponents: { runtime: { members: string[] }[]; typeOnly: unknown[] };
    };
    expect(layers.cyclicComponents.runtime.map((c) => c.members)).toEqual([
      ["src/a.ts", "src/b.ts"],
    ]);
    expect(layers.cyclicComponents.typeOnly).toEqual([]);
    const stats = result.graph() as unknown as { statistics: { runtimeCircularDeps: number } };
    expect(stats.statistics.runtimeCircularDeps).toBe(1);
  });
});
