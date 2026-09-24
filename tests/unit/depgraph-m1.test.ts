/**
 * Fix M1: the single-package model. The inventory, the census self-check and the dormancy split
 * run in both modes. In single-package mode the root `package.json` `exports` subpaths and `bin`
 * targets are build roots. An orphan fails the run with `--strict-orphans` and gives a warning
 * without it. `--reachable-only` removes an unreachable file from the graph.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

/** The disposition of each file in `file-inventory.json`. */
function dispositions(text: string): Record<string, string> {
  const inventory = JSON.parse(text) as { files: { file: string; disposition: string }[] };
  return Object.fromEntries(inventory.files.map((f) => [f.file, f.disposition]));
}

/** A single package with an `exports` folder subpath, a `bin` target and a planted orphan. */
function singlePackage(): string {
  return makeTree({
    "package.json": JSON.stringify({
      name: "m1",
      version: "1.0.0",
      exports: { ".": "./dist/index.js", "./util": "./dist/util/index.js" },
      bin: { m1: "./dist/cli.js" },
    }),
    "src/index.ts":
      "/** Entry. */\nimport { helper } from './helper.js';\nexport const main = helper;\n",
    "src/helper.ts": "/** Helper. */\nexport const helper = 1;\n",
    "src/cli.ts": "/** CLI. */\nimport { main } from './index.js';\nmain;\n",
    "src/util/index.ts":
      "/** Util. */\nexport function clamp(v: number): number {\n  return v;\n}\n",
    "src/tested.ts": "/** Tested only. */\nexport const tested = 1;\n",
    "src/orphan.ts": "/** Orphan. */\nexport const orphan = 1;\n",
    "tests/tested.test.ts": "import { tested } from '../src/tested.js';\ntested;\n",
  });
}

/** A monorepo with one package and a planted orphan. */
function monorepo(): string {
  return makeTree({
    "package.json": '{ "name": "ws", "private": true, "workspaces": ["packages/*"] }',
    "packages/core/package.json": '{ "name": "@m1/core", "version": "1.0.0" }',
    "packages/core/src/index.ts": "/** Entry. */\nexport const main = 1;\n",
    "packages/core/src/orphan.ts": "/** Orphan. */\nexport const orphan = 1;\n",
  });
}

describe("M1: single-package inventory, census and dormancy", () => {
  test("single package: roots, inventory, dormancy and an orphan warning", async () => {
    const root = singlePackage();
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("Warning: file census:\n  1 ORPHAN file(s)");
    expect(result.stderr).toContain("    ! src/orphan.ts\n");
    expect(result.stdout).toContain("Entry points: 3\nReachable files: 4\nDormant files: 2\n");
    expect(result.stdout).toContain(
      "File census self-check passed: 7 files == maximal repo walk (independent), 1 orphan.",
    );
    expect(dispositions(result.report("file-inventory.json"))).toEqual({
      "src/cli.ts": "build-entry",
      "src/helper.ts": "reachable",
      "src/index.ts": "build-entry",
      "src/orphan.ts": "orphan",
      "src/tested.ts": "test-only",
      "src/util/index.ts": "build-entry",
      "tests/tested.test.ts": "test",
    });
    expect(result.report("FILE_INVENTORY.md")).toContain(
      "| `src/orphan.ts` | (root) | src | orphan |",
    );
    const unused = result.report("unused-analysis.md");
    expect(unused).toContain(
      "- **Dormant files** (runtime code on disk, unreachable from any entry/build root): 2\n",
    );
    // src/tested.ts is imported by a test, so it is not unused (F8).
    expect(unused).toContain("- **Potentially unused files**: 1\n");
    expect(unused).not.toContain("- `src/cli.ts`");
    expect(unused).not.toContain("- `src/util/index.ts`");
    const surfaces = JSON.parse(result.report("package-export-surfaces.json")) as {
      surfaces: Record<string, string[]>;
    };
    expect(surfaces.surfaces.util).toEqual(["clamp"]);
    // The default graph holds every file: dormancy is reported, not hidden.
    expect(result.report("dependency-graph.json")).toContain('"src/orphan.ts"');
  });

  test("single package: --strict-orphans fails; --reachable-only removes the orphan", async () => {
    const root = singlePackage();
    const strict = await runDepgraph(root, ["--strict-orphans"]);
    expect(strict.code).toBe(1);
    expect(strict.stderr).toContain("FILE CENSUS SELF-CHECK FAILED.\n  1 ORPHAN file(s)");
    const reachable = await runDepgraph(root, ["--reachable-only"]);
    expect(reachable.code).toBe(0);
    expect(reachable.stdout).toContain("Analyzing 4 reachable files (--reachable-only)");
    expect(reachable.report("dependency-graph.json")).not.toContain('"src/orphan.ts"');
    expect(reachable.report("dependency-graph.json")).not.toContain('"src/tested.ts"');
  });

  test("monorepo: an orphan warns by default and fails with --strict-orphans", async () => {
    const root = monorepo();
    const plain = await runDepgraph(root);
    expect(plain.code).toBe(0);
    expect(plain.stderr).toContain("    ! packages/core/src/orphan.ts\n");
    expect(dispositions(plain.report("file-inventory.json"))["packages/core/src/orphan.ts"]).toBe(
      "orphan",
    );
    const strict = await runDepgraph(root, ["--strict-orphans"]);
    expect(strict.code).toBe(1);
    expect(strict.stderr).toContain("FILE CENSUS SELF-CHECK FAILED.");
    const check = await runDepgraph(root, ["--check-census", "--strict-orphans"]);
    expect(check.code).toBe(1);
    expect((await runDepgraph(root, ["--check-census"])).code).toBe(0);
  });
});
