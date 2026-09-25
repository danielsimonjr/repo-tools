/**
 * Fix F14: every `entry: [...]` array of a tsup config names build roots, not only the first
 * one. The tsup config (`tsup.config.*`) is read whenever it exists, also when no `build` or
 * `dev` script calls `tsup`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "./temp.ts";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

const repo = join(import.meta.dir, "../..");
const work = makeTempDir("f14");
afterAll(() => {
  removeTrees();
  rmSync(work, { recursive: true, force: true });
});

/** The disposition of each file in `file-inventory.json`. */
function dispositions(text: string): Record<string, string> {
  const inventory = JSON.parse(text) as { files: { file: string; disposition: string }[] };
  return Object.fromEntries(inventory.files.map((f) => [f.file, f.disposition]));
}

/** A two-package monorepo whose `lib` package has the tsup config `name` with `config`. */
function tree(name: string, config: string): string {
  return makeTree({
    "package.json": '{ "name": "f14", "private": true, "workspaces": ["packages/*"] }',
    "packages/lib/package.json": '{ "name": "@f14/lib", "version": "1.0.0" }',
    [`packages/lib/${name}`]: config,
    "packages/lib/src/index.ts": "/** Entry. */\nexport const main = 1;\n",
    "packages/lib/src/worker.ts": "/** Worker: the second entry array. */\nexport const w = 1;\n",
    "packages/lib/src/cli.ts": "/** CLI: the third entry array. */\nexport const c = 1;\n",
    "packages/other/package.json": '{ "name": "@f14/other", "version": "1.0.0" }',
    "packages/other/src/index.ts": "/** Other. */\nexport const other = 1;\n",
  });
}

const THREE_ARRAYS = `import { defineConfig } from 'tsup';

export default defineConfig([
  { entry: ['src/index.ts'], format: ['esm'] },
  { entry: ['src/worker.ts'], format: ['esm'] },
  { entry: ["src/cli.ts"], format: ['cjs'] },
]);
`;

describe("F14: tsup configs with several entry arrays", () => {
  for (const name of ["tsup.config.ts", "tsup.config.mjs"]) {
    test(`${name} with no tsup script: every entry array is a build root`, async () => {
      const root = tree(name, THREE_ARRAYS);
      const result = await runDepgraph(root);
      expect(result.code).toBe(0);
      const d = dispositions(result.report("file-inventory.json"));
      expect(d["packages/lib/src/worker.ts"]).toBe("build-entry");
      expect(d["packages/lib/src/cli.ts"]).toBe("build-entry");
    });
  }

  test("mono-repo fixture: worker.ts is a build entry and the census passes", async () => {
    const root = join(work, "mono-repo");
    cpSync(join(repo, "tests/fixtures/depgraph/mono-repo"), root, { recursive: true });
    const result = await runDepgraph(root);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const d = dispositions(result.report("file-inventory.json"));
    expect(d["packages/core/src/worker.ts"]).toBe("build-entry");
  });
});
