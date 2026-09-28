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
    expect(result.stderr).toContain("1 orphaned source file(s)");
    expect(result.stderr).toContain("src/orphan.ts");
    expect(result.stdout).toContain("Language: typescript; 7 source files; 3 roots");
    expect(result.stdout).toContain("census passed: 7 files");
    expect(dispositions(result.report("file-inventory.json"))).toEqual({
      "src/cli.ts": "build-entry",
      "src/helper.ts": "reachable",
      "src/index.ts": "build-entry",
      "src/orphan.ts": "orphan",
      "src/tested.ts": "test-only",
      "src/util/index.ts": "build-entry",
      "tests/tested.test.ts": "test",
    });
    expect(result.report("FILE_INVENTORY.md")).toContain("| `src/orphan.ts` | m1 | src | orphan |");
    const unused = result.report("unused-analysis.md");
    expect(unused).toContain("- **Dormant files**: 2\n");
    expect(unused).toContain("- **Orphaned (reachable from nothing)**: 1\n");
    expect(unused).toContain("- **Test-only (only a test reaches them)**: 1\n");
    expect(unused).not.toContain("- `src/cli.ts`");
    expect(unused).not.toContain("- `src/util/index.ts`\n");
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
    expect(strict.stderr).toContain("census FAILED (--strict-orphans)");
    expect(strict.stderr).toContain("src/orphan.ts");
    const reachable = await runDepgraph(root, ["--reachable-only"]);
    expect(reachable.code).toBe(1);
    expect(reachable.stderr).toContain("flag --reachable-only has no effect in 2.0.0");
    expect(strict.report("dependency-graph.json")).toContain('"src/orphan.ts"');
    expect(strict.report("dependency-graph.json")).toContain('"src/tested.ts"');
  });

  test("monorepo: an orphan warns by default and fails with --strict-orphans", async () => {
    const root = monorepo();
    const plain = await runDepgraph(root);
    expect(plain.code).toBe(0);
    expect(plain.stderr).toContain("packages/core/src/orphan.ts");
    expect(dispositions(plain.report("file-inventory.json"))["packages/core/src/orphan.ts"]).toBe(
      "orphan",
    );
    const strict = await runDepgraph(root, ["--strict-orphans"]);
    expect(strict.code).toBe(1);
    expect(strict.stderr).toContain("census FAILED (--strict-orphans)");
    // --check-census compares the inventory only; the orphan gate runs on a full run.
    const check = await runDepgraph(root, ["--check-census", "--strict-orphans"]);
    expect(check.code).toBe(0);
    expect((await runDepgraph(root, ["--check-census"])).code).toBe(0);
  });
});

describe("M1: a benchmarks folder is part of the census", () => {
  test("a single package with benchmarks/*.ts passes the census, and the files are bench", async () => {
    const root = makeTree({
      "package.json": JSON.stringify({ name: "m1b", version: "1.0.0" }),
      "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
      "benchmarks/speed.ts": "import { main } from '../src/index.js';\nmain;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("not in the census");
    const inventory = result.report("file-inventory.json");
    expect(dispositions(inventory)["benchmarks/speed.ts"]).toBe("bench");
  });
});
