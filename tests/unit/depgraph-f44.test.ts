/**
 * Fix F44: a `.d.ts` file is never a "potentially unused file". A declaration file declares
 * ambient types; no file imports it, so the import test does not apply.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F44: .d.ts files are not unused files", () => {
  test("an ambient .d.ts file is not listed; an orphan .ts file still is", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f44", "version": "1.0.0" }',
      "src/index.ts": "/** Entry. */\nexport const main = BUILD_ID;\n",
      "src/ambient.d.ts": "declare const BUILD_ID: string;\n",
      "src/orphan.ts": "/** Orphan. */\nexport const orphan = 1;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("  - 1 potentially unused files\n");
    expect(result.stdout).toContain("Potentially unused files:\n  - src/orphan.ts\n");
    expect(result.stdout).not.toContain("src/ambient.d.ts");
    expect(result.report("unused-analysis.md")).not.toContain("ambient.d.ts");
  });
});
