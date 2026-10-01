/**
 * Fix F12: a single-package repo without `src/` is scanned. Each top-level folder that holds
 * TypeScript is a source root, except the folders that are not source (`dist`, `tests`, ...).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { graphFile, makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F12: non-src layouts", () => {
  test("sources in pipeline/ and lib/ with no src/ give a non-zero file count", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f12", "version": "1.0.0" }',
      "pipeline/run.ts":
        "/** Run. */\nimport { step } from './step.js';\nexport const run = step;\n",
      "pipeline/step.ts": "/** Step. */\nexport const step = 1;\n",
      "lib/util.ts": "/** Util. */\nexport const util = 2;\n",
      "dist/out.ts": "/** Build output: not source. */\nexport const out = 3;\n",
      "tests/run.test.ts": "import { run } from '../pipeline/run.js';\nrun;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Language: typescript; 4 source files");
    const summary = JSON.parse(result.report("dependency-graph.json")) as {
      metadata: { totalFiles: number };
    };
    // The census is every source file, including the test. `dist/` stays skipped.
    expect(summary.metadata.totalFiles).toBe(4);
    const graph = result.graph();
    expect(graphFile(graph, "pipeline/run.ts")?.exports).toEqual(["run"]);
    expect(graphFile(graph, "lib/util.ts")?.exports).toEqual(["util"]);
    expect(graphFile(graph, "dist/out.ts")).toBeUndefined();
    expect(graphFile(graph, "tests/run.test.ts")).toBeDefined();
  });

  test("the module map of dependency-layers.json holds the top-level source folders", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f12-modules", "version": "1.0.0" }',
      "pipeline/run.ts":
        "/** Run. */\nimport { step } from './step.js';\nexport const run = step;\n",
      "pipeline/step.ts": "/** Step. */\nexport const step = 1;\n",
      "pipeline/deep/more.ts": "/** More. */\nexport const more = 1;\n",
      "lib/util.ts": "/** Util. */\nexport const util = 2;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const layers = JSON.parse(result.report("dependency-layers.json")) as {
      modules: Record<string, Record<string, unknown>>;
    };
    // `<dir>/x.ts` is in module `<dir>`. `<dir>/<sub>/x.ts` is in module `<dir>/<sub>`.
    expect(Object.keys(layers.modules).sort()).toEqual(["lib", "pipeline", "pipeline/deep"]);
    expect(Object.keys(layers.modules.pipeline ?? {}).sort()).toEqual([
      "pipeline/run.ts",
      "pipeline/step.ts",
    ]);
    expect(Object.keys(layers.modules["pipeline/deep"] ?? {})).toEqual(["pipeline/deep/more.ts"]);
    expect(Object.keys(layers.modules.lib ?? {})).toEqual(["lib/util.ts"]);
  });
});
