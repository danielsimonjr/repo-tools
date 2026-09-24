/**
 * Fix F37: the object form of the tsup `entry` option (`entry: { a: 'src/a.ts' }`) names build
 * roots, as the array form does (fix F14).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { tsupConfigEntries } from "../../src/depgraph/roots.ts";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F37: tsup object-form entry", () => {
  test("tsupConfigEntries reads object values in file order", () => {
    const root = makeTree({
      "pkg/tsup.config.ts":
        "export default [\n  { entry: ['src/one.ts'] },\n" +
        "  { entry: { worker: 'src/worker.ts', \"cli.ts\": `src/cli.ts` } },\n" +
        "  { entry: { index: 'src/index.ts' }, format: ['esm'] },\n];\n",
    });
    expect(tsupConfigEntries(root, "pkg")).toEqual([
      "pkg/src/one.ts",
      "pkg/src/worker.ts",
      "pkg/src/cli.ts",
      "pkg/src/index.ts",
    ]);
  });

  test("an object-form entry file is a build entry, not an orphan", async () => {
    const root = makeTree({
      "package.json": '{ "name": "ws", "private": true, "workspaces": ["packages/*"] }',
      "packages/core/package.json": '{ "name": "@f37/core", "version": "1.0.0" }',
      "packages/core/tsup.config.ts":
        "export default { entry: { index: 'src/index.ts', worker: 'src/worker.ts' } };\n",
      "packages/core/src/index.ts": "/** Entry. */\nexport const main = 1;\n",
      "packages/core/src/worker.ts": "/** Worker. */\nexport const worker = 2;\n",
    });
    const result = await runDepgraph(root);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const inventory = JSON.parse(result.report("file-inventory.json")) as {
      files: { file: string; disposition: string }[];
    };
    const worker = inventory.files.find((f) => f.file === "packages/core/src/worker.ts");
    expect(worker?.disposition).toBe("build-entry");
  });
});
