/**
 * Fix F31: the entry-point check matches the path segments `src/index.ts`, not a string
 * suffix. `src/mysrc/index.ts` ends with the text `src/index.ts` but is not an entry.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { isSrcIndex } from "../../src/depgraph/paths.ts";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F31: entry check by path segment", () => {
  test("isSrcIndex matches whole segments only", () => {
    expect(isSrcIndex("src/index.ts")).toBe(true);
    expect(isSrcIndex("packages/core/src/index.ts")).toBe(true);
    expect(isSrcIndex("mysrc/index.ts")).toBe(false);
    expect(isSrcIndex("src/mysrc/index.ts")).toBe(false);
    expect(isSrcIndex("packages/mysrc/index.ts")).toBe(false);
  });

  test("src/mysrc/index.ts is not an entry point", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f31", "version": "1.0.0" }',
      "src/index.ts": "/** Entry. */\nexport { m } from './mysrc/index.js';\n",
      "src/mysrc/index.ts": "/** Inner. */\nexport const m = 1;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const graph = result.graph() as unknown as { entryPoints: { file: string }[] };
    expect(graph.entryPoints.map((e) => e.file)).toEqual(["src/index.ts"]);
  });
});
