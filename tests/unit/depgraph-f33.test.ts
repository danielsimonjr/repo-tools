/**
 * Fix F33: a `node [--flag] ./dist/x.js` script seeds `src/x.ts` as a build root. The pre-port
 * pattern held a backspace byte after `js`, so it never matched, and the file was an orphan.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F33: node dist script roots", () => {
  test("a node --flag ./dist/gen.js script makes src/gen.ts a build entry", async () => {
    const root = makeTree({
      "package.json": '{ "name": "ws", "private": true, "workspaces": ["packages/*"] }',
      "packages/core/package.json": JSON.stringify({
        name: "@f33/core",
        version: "1.0.0",
        scripts: {
          gen: "node --max-old-space-size=4096 ./dist/gen.js",
          meta: "node dist/meta.json.js --out x.json",
        },
      }),
      "packages/core/src/index.ts": "/** Entry. */\nexport const main = 1;\n",
      "packages/core/src/gen.ts": "/** Generator. */\nimport { main } from './index.js';\nmain;\n",
    });
    const result = await runDepgraph(root);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const inventory = JSON.parse(result.report("file-inventory.json")) as {
      files: { file: string; disposition: string }[];
    };
    const gen = inventory.files.find((f) => f.file === "packages/core/src/gen.ts");
    expect(gen?.disposition).toBe("build-entry");
  });
});
