/**
 * Fix F8: an import in a test file counts as usage in the unused detection. An export or a file
 * that only a test uses is not reported as unused.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F8: test imports count as usage", () => {
  test("an export and a file used only by a test are not unused", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f8", "version": "1.0.0" }',
      "src/index.ts":
        "/** Entry. */\nimport { live } from './lib.js';\nexport const main = live;\n",
      "src/lib.ts":
        "/** Lib. */\nexport const live = 1;\nexport function usedByTest(): number { return 2; }\n" +
        "export function neverUsed(): number { return 3; }\n",
      "src/helper.ts": "/** Helper. */\nexport function helper(): number { return 4; }\n",
      "tests/lib.test.ts":
        "import { usedByTest } from '../src/lib.js';\nimport { helper } from '../src/helper.js';\n" +
        "usedByTest();\nhelper();\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const unused = result.report("unused-analysis.md");
    expect(unused).toContain("neverUsed");
    expect(unused).not.toContain("usedByTest");
    // Fix M1: the dormancy sections list src/helper.ts as test-only, so the check reads the
    // unused-file list only.
    const unusedFiles = unused.split("\n## Potentially Unused Files\n")[1] ?? "";
    expect(unusedFiles.split("\n## ")[0]).not.toContain("`src/helper.ts`");
  });
});
