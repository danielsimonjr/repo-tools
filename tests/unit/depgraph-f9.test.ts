/**
 * Fix F9: each `package.json` `exports` subpath is a reachability root. Its target file, and the
 * files that the target imports, are reachable even when no file imports the target. The graph
 * still holds a file that nothing reaches; its disposition is `orphan`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { graphFile, makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F9: exports subpaths are reachability roots", () => {
  test("the target of an exports subpath and its imports are reachable", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f9", "private": true, "workspaces": ["packages/*"] }',
      "packages/lib/package.json": JSON.stringify({
        name: "@f9/lib",
        version: "1.0.0",
        exports: { ".": "./dist/index.js", "./extra": "./dist/extra.js" },
      }),
      "packages/lib/src/index.ts": "/** Entry. */\nexport const main = 1;\n",
      "packages/lib/src/extra.ts":
        "/** Extra. */\nimport { deep } from './deep.js';\nexport const extra = deep;\n",
      "packages/lib/src/deep.ts": "/** Deep. */\nexport const deep = 2;\n",
      "packages/lib/src/lost.ts": "/** Nothing reaches this file. */\nexport const lost = 3;\n",
      "packages/app/package.json": '{ "name": "@f9/app", "version": "1.0.0" }',
      "packages/app/src/index.ts": "/** App. */\nexport const app = 1;\n",
    });
    const result = await runDepgraph(root);
    const graph = result.graph();
    expect(graphFile(graph, "packages/lib/src/extra.ts")).toBeDefined();
    expect(graphFile(graph, "packages/lib/src/deep.ts")).toBeDefined();
    expect(graphFile(graph, "packages/lib/src/lost.ts")).toBeDefined();
    const inventory = JSON.parse(result.report("file-inventory.json")) as {
      files: { file: string; disposition: string }[];
    };
    const disposition = (path: string) => inventory.files.find((f) => f.file === path)?.disposition;
    expect(disposition("packages/lib/src/extra.ts")).toBe("build-entry");
    expect(disposition("packages/lib/src/deep.ts")).toBe("reachable");
    expect(disposition("packages/lib/src/lost.ts")).toBe("orphan");
  });
});
