/**
 * Fix F35: package.json type guards. A `null` or non-object package.json and a non-string
 * `scripts` value give a warning on standard error and a defined outcome: no TypeError, and no
 * workspace package is dropped without a message.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F35: package.json type guards", () => {
  test("a null root package.json warns and uses the defaults", async () => {
    const root = makeTree({
      "package.json": "null",
      "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("Warning: package.json is not a JSON object, using defaults\n");
    const graph = result.graph() as unknown as { metadata: { name: string; version: string } };
    expect(graph.metadata).toMatchObject({ name: "unknown", version: "0.0.0" });
  });

  test("a non-string script keeps its workspace package and warns", async () => {
    const root = makeTree({
      "package.json": '{ "name": "ws", "private": true, "workspaces": ["packages/*"] }',
      "packages/core/package.json": JSON.stringify({
        name: "@f35/core",
        version: "1.0.0",
        scripts: { a: 1, gen: "node ./dist/gen.js" },
      }),
      "packages/core/src/index.ts": "/** Entry. */\nexport const main = 1;\n",
      "packages/core/src/gen.ts": "/** Gen. */\nimport { main } from './index.js';\nmain;\n",
      "packages/util/package.json": '{ "name": "@f35/util", "scripts": "build" }',
      "packages/util/src/index.ts": "/** Util. */\nexport const util = 1;\n",
    });
    const result = await runDepgraph(root);
    expect(result.stderr).toBe(
      "Warning: packages/core/package.json: scripts.a is not a string; it is ignored\n" +
        "Warning: packages/util/package.json: scripts is not an object; it is ignored\n",
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Monorepo detected: 2 workspace packages\n");
    const inventory = JSON.parse(result.report("file-inventory.json")) as {
      files: { file: string; disposition: string }[];
    };
    const gen = inventory.files.find((f) => f.file === "packages/core/src/gen.ts");
    expect(gen?.disposition).toBe("build-entry");
  });

  test("a workspace package.json that is not an object is skipped with a warning", async () => {
    const root = makeTree({
      "package.json": '{ "name": "ws", "private": true, "workspaces": ["packages/*", 7] }',
      "packages/core/package.json": '{ "name": "@f35/core", "version": "1.0.0" }',
      "packages/core/src/index.ts": "/** Entry. */\nexport const main = 1;\n",
      "packages/list/package.json": "[1, 2]",
    });
    const result = await runDepgraph(root);
    expect(result.stderr).toBe(
      "Warning: package.json: workspace pattern 7 is not a string; it is ignored\n" +
        "Warning: packages/list/package.json is not a JSON object; the package is skipped\n",
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Monorepo detected: 1 workspace packages\n  - @f35/core");
  });
});
