/**
 * Fix F32: removing the `.ts` extension removes the suffix only, never the first `.ts` text in
 * a path. A directory name is a module name as it is: `src/lib.ts/x.ts` is in module `lib.ts`,
 * and `src/a.ts.d/y.ts` in module `a.ts.d`. The cycle label of `src/a.tsx.ts` is `a.tsx`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F32: strip the .ts suffix only", () => {
  test("module names and cycle labels keep an inner .ts", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f32", "version": "1.0.0" }',
      "src/index.ts":
        "/** Entry. */\nexport { x } from './lib.ts/x.js';\nexport { y } from './a.ts.d/y.js';\n" +
        "export { a } from './a.tsx.js';\n",
      "src/lib.ts/x.ts": "/** X. */\nexport const x = 1;\n",
      "src/a.ts.d/y.ts": "/** Y. */\nexport const y = 2;\n",
      "src/a.tsx.ts": "/** A. */\nimport { b } from './b.js';\nexport const a = b;\n",
      "src/b.ts": "/** B. */\nimport { a } from './a.tsx.js';\nexport const b = 1;\na;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    expect(Object.keys(result.graph().modules).sort()).toEqual([
      "a.ts.d",
      "entry",
      "lib.ts",
      "root",
    ]);
    const compact = JSON.parse(result.report("dependency-summary.compact.json")) as {
      c: { rtp: string[] };
    };
    expect(compact.c.rtp).toEqual(["a.tsx→b→a.tsx"]);
  });
});
