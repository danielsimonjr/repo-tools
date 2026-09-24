/**
 * Fix F18: a `.d.ts` file is an ambient declaration, not code that a test can run, so it is not
 * in the denominator of the test coverage. It stays in the dependency graph.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { graphFile, makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F18: .d.ts files are not in the coverage denominator", () => {
  test("the coverage counts index.ts only, and the graph keeps the .d.ts file", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f18", "version": "1.0.0" }',
      "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
      "src/globals.d.ts": "declare const BUILD_ID: string;\n",
      "tests/index.test.ts": "import { main } from '../src/index.js';\nmain;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const cov = JSON.parse(result.report("test-coverage.json")) as {
      metadata: { totalSourceFiles: number; coveragePercent: string };
      untestedFiles: string[];
    };
    expect(cov.metadata.totalSourceFiles).toBe(1);
    expect(cov.metadata.coveragePercent).toBe("100.0");
    expect(cov.untestedFiles).toEqual([]);
    expect(result.report("TEST_COVERAGE.md")).not.toContain("globals.d.ts");
    expect(result.stdout).toContain("1/1 source files have tests (100.0%)");
    // The graph keeps the declaration file.
    expect(graphFile(result.graph(), "src/globals.d.ts")).toBeDefined();
  });
});
