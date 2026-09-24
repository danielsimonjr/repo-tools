/**
 * Fix F16: the default output folder is `docs/architecture`, in lower case. Some copies wrote
 * `docs/Architecture`. On a case-sensitive file system two spellings give two folders; on a
 * case-insensitive one the first spelling that a run creates stays.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F16: lowercase default output folder", () => {
  for (const [mode, files] of [
    [
      "single-package",
      {
        "package.json": '{ "name": "f16", "version": "1.0.0" }',
        "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
        "tests/index.test.ts": "import { main } from '../src/index.js';\nmain;\n",
      },
    ],
    [
      "monorepo",
      {
        "package.json": '{ "name": "f16", "private": true, "workspaces": ["packages/*"] }',
        "packages/lib/package.json": '{ "name": "@f16/lib", "version": "1.0.0" }',
        "packages/lib/src/index.ts": "/** Entry. */\nexport const main = 1;\n",
      },
    ],
  ] as const) {
    test(`${mode}: the run creates exactly one folder, docs/architecture`, async () => {
      const root = makeTree(files);
      const result = await runDepgraph(root);
      expect(result.code).toBe(0);
      // One entry only (a second spelling is a second folder on a case-sensitive file system),
      // and its name is exactly `architecture` (on a case-insensitive file system too).
      expect(readdirSync(join(root, "docs"))).toEqual(["architecture"]);
      expect(result.stdout).toContain("Created output directory: docs/architecture\n");
    });
  }
});
