/**
 * Fix F15: `package-export-surfaces.json` lists the public surface of each package only. A name
 * is public when a package root (`src/index.ts`, an `exports` subpath, a `bin` target or a
 * config entry) exports it, directly or through a re-export chain. An export that only relative
 * imports inside the package use is internal and is not listed.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F15: package-export-surfaces.json holds the public surface only", () => {
  test("an internal named export is absent; re-exported names are present", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f15", "private": true, "workspaces": ["packages/*"] }',
      "packages/core/package.json": '{ "name": "@f15/core", "version": "1.0.0" }',
      "packages/core/src/index.ts":
        "/** Entry. */\nimport { run } from './b.js';\n" +
        "export { pub } from './a.js';\nexport * from './util/deep.js';\n" +
        "export const main = run;\n",
      "packages/core/src/a.ts":
        "/** A. */\nexport const pub = 1;\nexport function helper(): number {\n  return 2;\n}\n",
      "packages/core/src/b.ts":
        "/** B. */\nimport { helper } from './a.js';\nexport const run = helper();\n",
      "packages/core/src/util/deep.ts": "/** Deep. */\nexport const deep = 3;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const { surfaces } = JSON.parse(result.report("package-export-surfaces.json")) as {
      surfaces: Record<string, string[]>;
    };
    expect(surfaces["packages/core"]).toEqual(["deep", "main", "pub"]);
  });
});
