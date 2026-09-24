import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { relativePosix } from "../../src/depgraph/paths.ts";
import {
  collectEntryPoints,
  configReferencedEntries,
  exportsSubpathEntries,
  runtimeLaunchedEntries,
  seedTsconfigEntries,
  tsupConfigEntries,
} from "../../src/depgraph/roots.ts";
import {
  collectCensusFiles,
  getAllSourceTsFiles,
  getAllTestFiles,
  getAllTsFiles,
  resolveSourceDirs,
  TEST_DIR_NAMES,
  walkRepoTsFiles,
} from "../../src/depgraph/scanner.ts";
import type { ParsedFile, WorkspacePackage } from "../../src/depgraph/types.ts";
import { detectWorkspaces, readWorkspacePatterns } from "../../src/depgraph/workspaces.ts";
import { sortCodeUnits } from "../../src/sort.ts";
import { makeTree, removeTrees } from "./tree.ts";

afterAll(removeTrees);

const rel = (root: string, paths: string[]): string[] =>
  sortCodeUnits(paths.map((p) => relativePosix(root, p)));

/** A parsed-file record with only a path. */
function parsed(path: string): ParsedFile {
  return {
    path,
    name: path,
    externalDependencies: [],
    nodeDependencies: [],
    internalDependencies: [],
    workspaceDependencies: [],
    packageName: null,
    exports: {
      named: [],
      default: null,
      types: [],
      interfaces: [],
      enums: [],
      classes: [],
      functions: [],
      constants: [],
      reExported: [],
    },
    description: null,
  };
}

describe("scanner", () => {
  const root = makeTree({
    "src/a.ts": "",
    "src/a.test.ts": "",
    "src/b.spec.ts": "",
    "src/g.d.ts": "",
    "src/x.tsx": "",
    "src/node_modules/n.ts": "",
    "tests/t.test.ts": "",
    "dist/d.ts": "",
    ".hidden/h.ts": "",
    "vitest.config.ts": "",
    "new/n.ts": "",
  });

  test("getAllTsFiles keeps .d.ts and skips tests, .tsx and node_modules", () => {
    expect(rel(root, getAllTsFiles(join(root, "src")))).toEqual(["src/a.ts", "src/g.d.ts"]);
    expect(getAllTsFiles(join(root, "absent"))).toEqual([]);
  });

  test("getAllSourceTsFiles also skips .d.ts", () => {
    expect(rel(root, getAllSourceTsFiles(join(root, "src")))).toEqual(["src/a.ts"]);
  });

  test("getAllTestFiles finds .test.ts and .spec.ts", () => {
    expect(rel(root, getAllTestFiles(join(root, "src")))).toEqual([
      "src/a.test.ts",
      "src/b.spec.ts",
    ]);
    expect(TEST_DIR_NAMES).toEqual(["test", "tests"]);
  });

  test("resolveSourceDirs prefers src/ and else lists top-level TypeScript dirs", () => {
    expect(rel(root, resolveSourceDirs(root))).toEqual(["src"]);
    const other = makeTree({ "pipeline/p.ts": "", "docs/d.ts": "", "tools/t.ts": "" });
    expect(rel(other, resolveSourceDirs(other))).toEqual(["pipeline"]);
  });

  test("walkRepoTsFiles skips dist, dot-dirs, node_modules and .d.ts", () => {
    expect(walkRepoTsFiles(root)).toEqual([
      "new/n.ts",
      "src/a.test.ts",
      "src/a.ts",
      "src/b.spec.ts",
      "tests/t.test.ts",
      "vitest.config.ts",
    ]);
  });

  test("collectCensusFiles walks packages, fixed dirs and root files only", () => {
    const ws = new Map<string, WorkspacePackage>([
      ["p", { name: "p", directory: "src", srcDir: "src/src", extraEntries: [] }],
    ]);
    expect(sortCodeUnits(collectCensusFiles(root, ws))).toEqual([
      "src/a.test.ts",
      "src/a.ts",
      "src/b.spec.ts",
      "tests/t.test.ts",
      "vitest.config.ts",
    ]);
  });
});

describe("roots", () => {
  const root = makeTree({
    "pkg/src/index.ts": "",
    "pkg/src/internal.ts": "",
    "pkg/src/cli.ts": "",
    "pkg/src/tool.ts": "",
    "pkg/src/run.ts": "",
    "pkg/src/bind/b.ts": "",
    "pkg/src/one.ts": "",
    "pkg/src/two.ts": "",
    "pkg/tsconfig.bind.json": JSON.stringify({ include: ["src/bind/**"], files: ["src/run.ts"] }),
    "pkg/tsup.config.ts": "export default [{ entry: ['src/one.ts'] }, { entry: ['src/two.ts'] }];",
    "vitest.config.ts": "alias: new URL('./pkg/src/tool.ts', import.meta.url)",
    "pkg/src/host.ts": "new Worker(new URL('./run.js', import.meta.url));",
  });

  test("tsupConfigEntries reads the first entry array only", () => {
    expect(tsupConfigEntries(root, "pkg")).toEqual(["pkg/src/one.ts"]);
    expect(tsupConfigEntries(root, "absent")).toEqual([]);
  });

  test("seedTsconfigEntries adds files and expands glob includes", () => {
    const seen: string[] = [];
    seedTsconfigEntries(root, "pkg", "tsconfig.bind.json", (p) => seen.push(p.replace(/\\/g, "/")));
    expect(seen).toEqual(["pkg/src/run.ts", "pkg/src/bind/b.ts"]);
  });

  test("a `node dist/x.js` script seeds no root (pre-port behaviour; fix F33 changes this)", () => {
    const entries = exportsSubpathEntries(root, "pkg", {
      scripts: { gen: "node --max-old-space-size=4096 ./dist/tool.js" },
    });
    expect(entries).not.toContain("pkg/src/tool.ts");
  });

  test("exportsSubpathEntries maps subpaths, bins, scripts and config tsup", () => {
    const entries = exportsSubpathEntries(root, "pkg", {
      exports: { ".": "./dist/index.js", "./internal": "./dist/internal.js", "./gone": "x" },
      bin: { a: "./dist/src/cli.js" },
      scripts: { build: "tsup", test: "node dist/tool.js", bind: "tsc -p tsconfig.bind.json" },
    });
    // `node dist/tool.js` seeds nothing: the pre-port pattern cannot match (see roots.ts, F33).
    expect(entries).toEqual([
      "pkg/src/internal.ts",
      "pkg/src/cli.ts",
      "pkg/src/run.ts",
      "pkg/src/bind/b.ts",
      "pkg/src/one.ts",
    ]);
  });

  test("configReferencedEntries reads new URL source references in root configs", () => {
    expect(configReferencedEntries(root)).toEqual(["pkg/src/tool.ts"]);
    expect(configReferencedEntries(join(root, "absent"))).toEqual([]);
  });

  test("runtimeLaunchedEntries finds a parsed sibling launched by new URL", () => {
    const files = [parsed("pkg/src/host.ts"), parsed("pkg/src/run.ts")];
    expect(runtimeLaunchedEntries(root, files)).toEqual(["pkg/src/run.ts"]);
  });

  test("collectEntryPoints joins index, extras, config and launched entries once", () => {
    const ws = new Map<string, WorkspacePackage>([
      [
        "p",
        {
          name: "p",
          directory: "pkg",
          srcDir: "pkg/src",
          extraEntries: ["pkg/src/index.ts", "pkg/src/cli.ts"],
        },
      ],
    ]);
    const files = ["index", "cli", "tool", "host", "run"].map((n) => parsed(`pkg/src/${n}.ts`));
    expect(collectEntryPoints(root, ws, files)).toEqual([
      "pkg/src/index.ts",
      "pkg/src/cli.ts",
      "pkg/src/tool.ts",
      "pkg/src/run.ts",
    ]);
  });
});

describe("workspaces", () => {
  test("readWorkspacePatterns reads npm, yarn and pnpm forms and drops negations", () => {
    expect(
      readWorkspacePatterns(makeTree({ "package.json": '{"workspaces":["a","!b"]}' })),
    ).toEqual(["a"]);
    expect(
      readWorkspacePatterns(makeTree({ "package.json": '{"workspaces":{"packages":["p/*"]}}' })),
    ).toEqual(["p/*"]);
    expect(
      readWorkspacePatterns(
        makeTree({ "pnpm-workspace.yaml": "packages:\n  - 'x/*'\n  - '!y'\n" }),
      ),
    ).toEqual(["x/*"]);
  });

  test("readWorkspacePatterns detects two undeclared packages by structure", () => {
    const root = makeTree({
      "package.json": "{}",
      "one/package.json": "{}",
      "one/src/a.ts": "",
      "two/package.json": "{}",
      "two/src/a.ts": "",
      "tools/package.json": "{}",
      "tools/src/a.ts": "",
    });
    expect(sortCodeUnits(readWorkspacePatterns(root))).toEqual(["one", "two"]);
    expect(
      readWorkspacePatterns(makeTree({ "one/package.json": "{}", "one/src/a.ts": "" })),
    ).toEqual([]);
  });

  test("detectWorkspaces reads glob and direct patterns", () => {
    const root = makeTree({
      "package.json": '{"workspaces":["packages/*","solo"]}',
      "packages/a/package.json": '{"name":"@scope/a","exports":{"./x":"./dist/x.js"}}',
      "packages/a/src/x.ts": "",
      "packages/b/package.json": "not json",
      "solo/package.json": '{"name":"solo"}',
    });
    const ws = detectWorkspaces(root);
    expect([...ws.keys()].sort()).toEqual(["@scope/a", "solo"]);
    expect(ws.get("@scope/a")).toEqual({
      name: "@scope/a",
      directory: "packages/a",
      srcDir: "packages/a/src",
      extraEntries: ["packages/a/src/x.ts"],
    });
    expect(detectWorkspaces(makeTree({ "a.ts": "" })).size).toBe(0);
  });
});
