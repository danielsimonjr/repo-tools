import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  cleanExportName,
  extractDescription,
  generateFallbackDescription,
  NODE_BUILTINS,
  parseFile,
} from "../../src/depgraph/parser.ts";
import {
  resolvePath,
  resolveWorkspaceSource,
  workspaceEntryPath,
} from "../../src/depgraph/resolver.ts";
import type { WorkspacePackage } from "../../src/depgraph/types.ts";
import { makeTree, removeTrees } from "./tree.ts";

afterAll(removeTrees);

const core: WorkspacePackage = {
  name: "@scope/core",
  directory: "packages/core",
  srcDir: "packages/core/src",
  extraEntries: [],
};
const workspaces = new Map([[core.name, core]]);

describe("resolver", () => {
  test("resolvePath maps .js to .ts and adds .ts when absent", () => {
    expect(resolvePath("src/a.ts", "./b.js")).toBe("src/b.ts");
    expect(resolvePath("src/z/a.ts", "../c")).toBe("src/c.ts");
    expect(resolvePath("src/a.ts", "./d.ts")).toBe("src/d.ts");
  });

  test("workspaceEntryPath gives the index or the subpath file", () => {
    expect(workspaceEntryPath(workspaces, "@scope/core")).toBe("packages/core/src/index.ts");
    expect(workspaceEntryPath(workspaces, "@scope/core", "internal")).toBe(
      "packages/core/src/internal.ts",
    );
    expect(workspaceEntryPath(workspaces, "other")).toBeUndefined();
  });

  test("resolveWorkspaceSource reads exact names and subpaths", () => {
    expect(resolveWorkspaceSource(workspaces, "@scope/core")).toEqual({ ws: core });
    expect(resolveWorkspaceSource(workspaces, "@scope/core/internal")).toEqual({
      ws: core,
      subpath: "internal",
    });
    expect(resolveWorkspaceSource(workspaces, "./x")).toBeUndefined();
    expect(resolveWorkspaceSource(workspaces, "lodash")).toBeUndefined();
  });
});

describe("parser helpers", () => {
  test("extractDescription reads the first JSDoc text line", () => {
    expect(extractDescription("/**\n * ===\n * @scope/pkg - The pkg.\n */")).toBe("The pkg.");
    expect(extractDescription("/**\n * First line.\n * Second.\n */")).toBe("First line.");
    expect(extractDescription("// A line comment\nx")).toBe("A line comment");
    expect(extractDescription("// -----\nx")).toBeNull();
    expect(extractDescription("const x = 1;")).toBeNull();
  });

  test("cleanExportName removes comments, spaces and a type keyword", () => {
    expect(cleanExportName(" type Foo ")).toBe("Foo");
    expect(cleanExportName("a /* c */")).toBe("a");
    expect(cleanExportName("b // c")).toBe("b");
  });

  test("NODE_BUILTINS holds the common modules", () => {
    expect(NODE_BUILTINS).toContain("fs");
    expect(NODE_BUILTINS).toContain("worker_threads");
  });
});

describe("parseFile", () => {
  const root = makeTree({
    "packages/core/src/a.ts": [
      "/** The a module. */",
      "import fs from 'node:fs';",
      "import { join } from 'path';",
      "import type { T } from './t.js';",
      "import { type U, v } from './u.js';",
      "import * as ns from 'lodash';",
      "import { x } from '@scope/core/internal';",
      "import './side.js';",
      "const m = await import('./dyn.js');",
      "// import { gone } from './gone.js';",
      "export { v as w };",
      "export const K = 1;",
      "export async function f() {}",
      "export class C {}",
      "export interface I {}",
      "export type Y = number;",
      "export enum E { A }",
      "export default function main() {}",
      "export * from './all.js';",
      "export { r as s } from './r.js';",
      "export type { Q } from './q.js';",
      "export type * from './types.js';",
      "export * from '@scope/core';",
    ].join("\n"),
  });

  const file = parseFile({ root, workspaces }, join(root, "packages/core/src/a.ts"));

  test("records path, name, package and description (a one-line JSDoc is not read)", () => {
    expect(file.path).toBe("packages/core/src/a.ts");
    expect(file.name).toBe("a");
    expect(file.packageName).toBe("@scope/core");
    expect(file.description).toBe("import { gone } from './gone.js';");
  });

  test("classes node, external, workspace and internal imports", () => {
    expect(file.nodeDependencies).toEqual([
      { module: "fs", imports: ["fs"] },
      { module: "path", imports: ["join"] },
    ]);
    expect(file.externalDependencies).toEqual([{ package: "lodash", imports: ["* as ns"] }]);
    expect(file.workspaceDependencies).toEqual([
      { package: "@scope/core", directory: "packages/core", imports: ["x"], subpath: "internal" },
      { package: "@scope/core", directory: "packages/core", imports: ["*"] },
    ]);
  });

  test("records internal edges in the pre-port order and kinds", () => {
    expect(file.internalDependencies).toEqual([
      { file: "./t.js", imports: ["T"], typeOnly: true },
      { file: "./u.js", imports: ["U", "v"], typeOnly: false },
      { file: "./side.js", imports: [], typeOnly: false },
      { file: "./dyn.js", imports: [], typeOnly: true },
      { file: "./all.js", imports: [], reExport: true },
      { file: "./r.js", imports: [], reExport: true },
      { file: "./q.js", imports: [], reExport: true },
      { file: "./types.js", imports: [], reExport: true },
      { file: "./all.js", imports: ["*"], reExport: true },
      { file: "./r.js", imports: ["r"], reExport: true },
      { file: "./q.js", imports: ["Q"], reExport: true, typeOnly: true },
      { file: "./types.js", imports: ["*"], reExport: true, typeOnly: true },
    ]);
  });

  test("records exports by kind", () => {
    expect(file.exports).toEqual({
      named: ["w", "s", "K", "f", "C", "E", "r", "Q"],
      default: "main",
      types: ["I", "Y"],
      interfaces: ["I"],
      enums: ["E"],
      classes: ["C"],
      functions: ["f"],
      constants: ["K"],
      reExported: ["* from ./all.js", "* from @scope/core", "r", "Q", "type * from ./types.js"],
    });
  });

  test("generateFallbackDescription describes index, type-only and plain files", () => {
    expect(generateFallbackDescription({ ...file, path: "packages/core/src/index.ts" })).toBe(
      "Package entry point for @scope/core (re-exports 5 symbols)",
    );
    const types = { ...file.exports, named: [], default: null, reExported: [] };
    expect(generateFallbackDescription({ ...file, exports: types })).toBe(
      "Type definitions (1 interfaces, 1 type aliases)",
    );
    expect(generateFallbackDescription(file)).toBe("a module");
  });
});
