import { afterAll, describe, expect, test } from "bun:test";
import {
  buildDependencyMatrix,
  categorizeFiles,
  computePublicSurface,
  detectUnused,
  findReachableFiles,
  generateStatistics,
  splitDormant,
} from "../../src/depgraph/analysis.ts";
import { detectCyclicComponents } from "../../src/depgraph/cycles.ts";
import type { ParsedFile, WorkspacePackage } from "../../src/depgraph/types.ts";
import { toParsedFiles } from "../../src/map/adapter.ts";
import { buildGraph } from "../../src/map/graph.ts";
import { makeTree, removeTrees } from "./tree.ts";

afterAll(removeTrees);

const none = new Map<string, WorkspacePackage>();

/** The parsed records of `root`, limited to `paths`. */
async function parseAll(root: string, paths: string[]): Promise<ParsedFile[]> {
  const records = toParsedFiles(await buildGraph(root), root, { allAreas: true });
  const want = new Set(paths);
  return records.filter((r) => want.has(r.path));
}

const singleRoot = makeTree({
  "src/index.ts": "export { a } from './a.js';\nexport * from './z/b.js';\n",
  "src/a.ts": "import { b } from './z/b.js';\nexport function a() { return b(); }\n",
  "src/z/b.ts": "import type { A } from '../c.js';\nexport function b() {}\nexport type B = A;\n",
  "src/c.ts":
    "import { b } from './z/b.js';\nexport interface A { x: 1 }\nexport const unusedC = 1;\nexport function helper(): A { return { x: 1 }; }\nhelper();\nexport type Kept = number;\nconst k: Kept = 1;\n",
  "src/p.ts": "import { q } from './q.js';\nexport function p() { return q(); }\n",
  "src/q.ts": "import { p } from './p.js';\nexport function q() { return p(); }\n",
  "tests/c.test.ts": "import { helper } from '../src/c.js';\n",
});
const singleFiles = await parseAll(singleRoot, [
  "src/index.ts",
  "src/a.ts",
  "src/z/b.ts",
  "src/c.ts",
  "src/p.ts",
  "src/q.ts",
]);
const singleTests = await parseAll(singleRoot, ["tests/c.test.ts"]);

describe("single-package analysis", () => {
  const root = singleRoot;
  const files = singleFiles;
  const tests = singleTests;

  test("categorizeFiles uses entry, root and the first src subdirectory", () => {
    const modules = categorizeFiles(files, false, none);
    expect(Object.keys(modules)).toEqual(["root", "entry", "z"]);
    expect(Object.keys(modules.root ?? {})).toEqual([
      "src/a.ts",
      "src/c.ts",
      "src/p.ts",
      "src/q.ts",
    ]);
  });

  test("buildDependencyMatrix lists specifiers and importers", () => {
    const matrix = buildDependencyMatrix(files);
    expect(matrix["src/a.ts"]).toEqual({ importsFrom: ["./z/b.js"], exportsTo: ["src/index.ts"] });
    expect(matrix["src/z/b.ts"]?.exportsTo).toEqual(["src/a.ts", "src/c.ts", "src/index.ts"]);
  });

  test("detectCyclicComponents splits runtime and type-only components", () => {
    const cycles = detectCyclicComponents(files);
    expect(cycles.runtime).toEqual([
      { members: ["src/p.ts", "src/q.ts"], cycle: ["src/p.ts", "src/q.ts", "src/p.ts"] },
    ]);
    // Fix F26: the cycle starts at the smallest member in code-unit order.
    expect(cycles.typeOnly).toEqual([
      { members: ["src/c.ts", "src/z/b.ts"], cycle: ["src/c.ts", "src/z/b.ts", "src/c.ts"] },
    ]);
  });

  test("computePublicSurface follows export * and named re-exports", () => {
    const surface = computePublicSurface(files, root, none);
    expect([...surface.publicWildcardFiles]).toEqual(["src/index.ts", "src/z/b.ts"]);
    expect([...surface.publicNamed]).toEqual(["src/a.ts::a"]);
    expect(surface.extraEntryPaths.size).toBe(0);
  });

  test("detectUnused counts test imports and in-file references", () => {
    const unused = detectUnused(files, tests, root, none);
    expect(unused.unusedFiles).toEqual([]);
    expect(unused.unusedExports).toEqual([
      { file: "src/c.ts", name: "Kept", type: "type", inFileRefs: 1 },
      { file: "src/c.ts", name: "unusedC", type: "constant", inFileRefs: 0 },
    ]);
  });

  test("generateStatistics totals exports, lines and cycles", () => {
    const modules = categorizeFiles(files, false, none);
    const stats = generateStatistics(
      files,
      modules,
      detectCyclicComponents(files),
      detectUnused(files, tests, root, none),
      root,
    );
    expect(stats.totalTypeScriptFiles).toBe(6);
    expect(stats.totalModules).toBe(3);
    expect(stats.totalLinesOfCode).toBe(24);
    expect(stats.totalFunctions).toBe(5);
    expect(stats.totalTypeOnlyImports).toBe(1);
    expect(stats.runtimeCyclicComponents).toBe(1);
    expect(stats.typeOnlyCyclicComponents).toBe(1);
    expect(stats.runtimeFilesInCycles).toBe(2);
    expect(stats.typeOnlyFilesInCycles).toBe(2);
    expect(stats.unusedExportsCount).toBe(2);
  });

  test("splitDormant returns empty lists without a dormant set", () => {
    expect(splitDormant(undefined, files, tests, none)).toEqual({
      testReachable: new Set(),
      dormantAll: [],
      orphaned: [],
      testOnly: [],
    });
  });
});

const monoRoot = makeTree({
  "package.json": '{"private":true,"workspaces":["packages/*"]}\n',
  "packages/core/package.json": '{"name":"@scope/core"}\n',
  "packages/app/package.json": '{"name":"@scope/app"}\n',
  "packages/core/src/index.ts": "export { f } from './f.js';\n",
  "packages/core/src/f.ts": "export function f() {}\n",
  "packages/core/src/sub.ts": "export const s = 1;\n",
  "packages/core/src/deep/d.ts": "export const d = 1;\n",
  "packages/core/src/t.ts": "export const t = 1;\n",
  "packages/app/src/main.ts":
    "import { f } from '@scope/core';\nimport { s } from '@scope/core/sub';\n",
  "packages/core/tests/t.test.ts": "import { t } from '../src/t.js';\n",
});
const core: WorkspacePackage = {
  name: "@scope/core",
  directory: "packages/core",
  srcDir: "packages/core/src",
  extraEntries: ["packages/core/src/sub.ts"],
};
const ws = new Map([[core.name, core]]);
const monoFiles = await parseAll(monoRoot, [
  "packages/core/src/index.ts",
  "packages/core/src/f.ts",
  "packages/core/src/sub.ts",
  "packages/core/src/deep/d.ts",
  "packages/core/src/t.ts",
  "packages/app/src/main.ts",
]);
const monoTests = await parseAll(monoRoot, ["packages/core/tests/t.test.ts"]);

describe("monorepo analysis", () => {
  const files = monoFiles;
  const tests = monoTests;

  test("categorizeFiles keys by package directory and subdirectory", () => {
    expect(Object.keys(categorizeFiles(files, true, ws))).toEqual([
      "unknown",
      "packages/core/deep",
      "packages/core",
    ]);
  });

  test("findReachableFiles follows workspace and subpath imports", () => {
    const reachable = findReachableFiles(["packages/app/src/main.ts"], files, ws);
    expect([...reachable].sort()).toEqual([
      "packages/app/src/main.ts",
      "packages/core/src/f.ts",
      "packages/core/src/index.ts",
      "packages/core/src/sub.ts",
    ]);
  });

  test("splitDormant separates orphaned and test-only files", () => {
    const reachable = findReachableFiles(["packages/app/src/main.ts"], files, ws);
    const dormant = new Set(files.map((f) => f.path).filter((p) => !reachable.has(p)));
    const split = splitDormant(dormant, files, tests, ws);
    expect(split.orphaned).toEqual(["packages/core/src/deep/d.ts"]);
    expect(split.testOnly).toEqual(["packages/core/src/t.ts"]);
  });
});
