/**
 * Fix F19: test coverage traces barrel re-exports. A test that imports a barrel covers each file
 * that the barrel re-exports, through `export *` and `export { } from`, and through a chain of
 * barrels.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F19: coverage traces barrel re-exports", () => {
  test("a test that imports a barrel covers the re-exported files", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f19", "version": "1.0.0" }',
      "src/index.ts":
        "/** Barrel. */\nexport * from './a.js';\nexport { b } from './b.js';\n" +
        "export * from './sub/index.js';\n",
      "src/a.ts": "/** A. */\nexport const a = 1;\n",
      "src/b.ts": "/** B. */\nexport const b = 2;\n",
      "src/sub/index.ts": "/** Sub-barrel. */\nexport { c } from './c.js';\n",
      "src/sub/c.ts": "/** C. */\nexport const c = 3;\n",
      "src/lone.ts": "/** No barrel re-exports this file: the control. */\nexport const d = 4;\n",
      "tests/index.test.ts": "import { a, b, c } from '../src/index.js';\na; b; c;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const cov = JSON.parse(result.report("test-coverage.json")) as {
      testedFiles: string[];
      untestedFiles: string[];
    };
    expect(cov.testedFiles).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/index.ts",
      "src/sub/c.ts",
      "src/sub/index.ts",
    ]);
    expect(cov.untestedFiles).toEqual(["src/lone.ts"]);
  });
});
