import { describe, expect, test } from "bun:test";
import { cleanExportName, extractDescription } from "../../src/depgraph/description.ts";
import {
  resolvePath,
  resolveWorkspaceSource,
  workspaceEntryPath,
} from "../../src/depgraph/resolver.ts";
import type { WorkspacePackage } from "../../src/depgraph/types.ts";
import { NODE_BUILTINS } from "../../src/map/resolvers.ts";

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
