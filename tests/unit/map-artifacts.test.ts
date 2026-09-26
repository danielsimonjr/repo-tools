/**
 * The four artifacts of the map engine: dependency-graph.json, file-inventory.json,
 * duplicate-symbols.json and unused-analysis.json.
 *
 * Ported from the architecture-docs skill (`test_artifacts.py`). Two adaptations, each deliberate:
 * no artifact has a `generated` date (output rule R3), and the cycle cap is an option rather than a
 * patched module constant.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  emitDependencyGraph,
  emitDuplicateSymbols,
  emitFileInventory,
  emitUnusedAnalysis,
} from "../../src/map/artifacts.ts";
import { discover } from "../../src/map/discovery.ts";
import { buildGraph, reachableFrom } from "../../src/map/graph.ts";
import {
  type Dependency,
  type FileNode,
  newRepoGraph,
  type RepoGraph,
} from "../../src/map/schema.ts";
import { makeTempDir } from "./temp.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A new folder with the files `files`. */
function tmp(files: Record<string, string> = {}): string {
  const root = makeTempDir("map-art");
  made.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
}

/** A file node: path, area, disposition, lines, and optional exports and edges. */
function fnode(
  path: string,
  area: string,
  disposition: string,
  loc: number,
  over: Partial<FileNode> = {},
): FileNode {
  return {
    path,
    area,
    disposition,
    loc,
    exports: [],
    internal: [],
    external: [],
    nodeBuiltins: [],
    broken: [],
    aliases: [],
    ...over,
  };
}
const dep = (file: string, imports: string[] = [], typeOnly = false): Dependency => ({
  file,
  imports,
  typeOnly,
});
const graphOf = (
  nodes: FileNode[],
  roots: string[] = [],
  rootPath: string | null = null,
): RepoGraph =>
  newRepoGraph({ name: "d", files: new Map(nodes.map((n) => [n.path, n])), roots, rootPath });
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

const DEMO = () =>
  graphOf(
    [
      fnode("src/a.ts", "src", "reachable", 12, { exports: ["a"] }),
      fnode("tests/a.test.ts", "tests", "test", 5),
    ],
    ["src/a.ts"],
  );

describe("dependency-graph.json", () => {
  test("is written with the expected keys, one trailing LF, no date", () => {
    const out = emitDependencyGraph(DEMO(), tmp());
    expect(out.endsWith("dependency-graph.json")).toBe(true);
    const text = readFileSync(out, "utf8");
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).not.toContain("\r");
    const data = JSON.parse(text);
    for (const key of ["metadata", "modules", "statistics", "reachability"])
      expect(data).toHaveProperty(key);
    expect(data.statistics.totalLinesOfCode).toBe(17);
    expect(text).not.toContain("generated");
  });

  test("reachability is scoped by disposition, not a raw diff", () => {
    const g = graphOf(
      [
        fnode("src/index.ts", "src", "build-entry", 1),
        fnode("src/dead.ts", "src", "orphan", 1),
        fnode("tools/gen.ts", "tools", "tool", 1),
      ],
      ["src/index.ts"],
    );
    const data = read(emitDependencyGraph(g, tmp()));
    expect(data.reachability.orphaned).toEqual(["src/dead.ts"]);
    expect(data.statistics.orphanedFiles).toBe(1);
  });

  test("runtime vs type-only cycles: all-runtime, and one type-only leg", () => {
    const runtime = graphOf([
      fnode("src/a.ts", "src", "reachable", 1, { internal: [dep("src/b.ts", ["B"])] }),
      fnode("src/b.ts", "src", "reachable", 1, { internal: [dep("src/a.ts", ["A"])] }),
    ]);
    let data = read(emitDependencyGraph(runtime, tmp()));
    expect([data.statistics.runtimeCircularDeps, data.statistics.typeOnlyCircularDeps]).toEqual([
      1, 0,
    ]);
    const mixed = graphOf([
      fnode("src/a.ts", "src", "reachable", 1, { internal: [dep("src/b.ts", ["B"], true)] }),
      fnode("src/b.ts", "src", "reachable", 1, { internal: [dep("src/a.ts", ["A"])] }),
    ]);
    data = read(emitDependencyGraph(mixed, tmp()));
    expect([data.statistics.runtimeCircularDeps, data.statistics.typeOnlyCircularDeps]).toEqual([
      0, 1,
    ]);
  });

  test("D2: the cyclic components (SCCs) are counted beside the simple cycles", () => {
    const g = graphOf([
      fnode("src/a.ts", "src", "reachable", 1, { internal: [dep("src/b.ts")] }),
      fnode("src/b.ts", "src", "reachable", 1, { internal: [dep("src/a.ts")] }),
      fnode("src/c.ts", "src", "reachable", 1, { internal: [dep("src/d.ts")] }),
      fnode("src/d.ts", "src", "reachable", 1, { internal: [dep("src/c.ts", [], true)] }),
      fnode("src/e.ts", "src", "reachable", 1, { internal: [dep("src/e.ts")] }),
    ]);
    const s = read(emitDependencyGraph(g, tmp())).statistics;
    expect([s.runtimeCyclicComponents, s.runtimeFilesInCycles]).toEqual([2, 3]);
    expect([s.typeOnlyCyclicComponents, s.typeOnlyFilesInCycles]).toEqual([1, 2]);
  });

  test("D2: the component keys follow the repo_map keys, in a fixed order", () => {
    const keys = Object.keys(read(emitDependencyGraph(DEMO(), tmp())).statistics);
    expect(
      keys.slice(keys.indexOf("circularDepsTruncated"), keys.indexOf("circularDepsTruncated") + 5),
    ).toEqual([
      "circularDepsTruncated",
      "runtimeCyclicComponents",
      "typeOnlyCyclicComponents",
      "runtimeFilesInCycles",
      "typeOnlyFilesInCycles",
    ]);
  });

  test("D2: a capped simple-cycle count leaves the component counts exact", () => {
    const g = graphOf([
      fnode("src/a.ts", "src", "reachable", 1, { internal: [dep("src/b.ts")] }),
      fnode("src/b.ts", "src", "reachable", 1, { internal: [dep("src/a.ts"), dep("src/c.ts")] }),
      fnode("src/c.ts", "src", "reachable", 1, { internal: [dep("src/a.ts"), dep("src/d.ts")] }),
      fnode("src/d.ts", "src", "reachable", 1, { internal: [dep("src/a.ts")] }),
    ]);
    const s = read(emitDependencyGraph(g, tmp(), { cycleLimits: { maxCycles: 1 } })).statistics;
    expect(s.circularDepsTruncated).toBe(true);
    expect([s.runtimeCyclicComponents, s.runtimeFilesInCycles]).toEqual([1, 4]);
  });

  test("D2: a TypeScript repo gets depgraph's per-kind export counts", async () => {
    const root = tmp({
      "src/k.ts": [
        "export class C {}",
        "export interface I {}",
        "export type T = number;",
        "export function isThing() { return true; }",
        "export async function go() {}",
        "export const A = 1, B = 2;",
        "export let L = 3;",
        "export enum E { X }",
        "export default class D {}",
        "const local = 1;",
        "export { local as renamed };",
        'export * from "./m.js";',
        'export type * from "./t.js";',
        'export { x as y } from "./m.js";',
        'export * as ns from "./m.js";',
        "",
      ].join("\n"),
      "src/m.ts": "export const x = 1;\n",
      "src/t.ts": "export type Z = 1;\n",
    });
    const s = read(emitDependencyGraph(await buildGraph(root), join(root, "out"))).statistics;
    expect({
      totalClasses: s.totalClasses,
      totalInterfaces: s.totalInterfaces,
      totalFunctions: s.totalFunctions,
      totalTypeGuards: s.totalTypeGuards,
      totalEnums: s.totalEnums,
      totalConstants: s.totalConstants,
      totalReExports: s.totalReExports,
    }).toEqual({
      totalClasses: 1,
      totalInterfaces: 1,
      totalFunctions: 2,
      totalTypeGuards: 1,
      totalEnums: 1,
      totalConstants: 4,
      totalReExports: 4,
    });
    const keys = Object.keys(s);
    expect(keys.slice(keys.indexOf("typeOnlyFilesInCycles") + 1)).toEqual([
      "totalClasses",
      "totalInterfaces",
      "totalFunctions",
      "totalTypeGuards",
      "totalEnums",
      "totalConstants",
      "totalReExports",
    ]);
  });

  test("D2: a Python repo does not get the TypeScript export counts", async () => {
    const root = tmp({ "server.py": "class S:\n    pass\n" });
    const s = read(emitDependencyGraph(await buildGraph(root), join(root, "out"))).statistics;
    expect(s).not.toHaveProperty("totalClasses");
    expect(s).not.toHaveProperty("totalReExports");
    expect(s).toHaveProperty("runtimeCyclicComponents");
  });

  test("warnings are present and empty when clean", () => {
    const data = read(emitDependencyGraph(DEMO(), tmp()));
    expect(data.warnings).toEqual([]);
    expect(data.statistics.circularDepsTruncated).toBe(false);
  });

  test("a truncated cycle count is disclosed in the written JSON", () => {
    const edges: Record<string, string[]> = {
      "a.ts": ["b.ts"],
      "b.ts": ["a.ts", "c.ts"],
      "c.ts": ["a.ts", "d.ts"],
      "d.ts": ["a.ts"],
    };
    const g = graphOf(
      Object.entries(edges).map(([p, ts]) =>
        fnode(p, "src", "reachable", 1, { internal: ts.map((t) => dep(t)) }),
      ),
    );
    const data = read(emitDependencyGraph(g, tmp(), { cycleLimits: { maxCycles: 1 } }));
    expect(
      data.warnings.some(
        (w: string) => w.toLowerCase().includes("floor") || w.toLowerCase().includes("cap"),
      ),
    ).toBe(true);
    expect(data.statistics.circularDepsTruncated).toBe(true);
  });

  test("the unused statistics match unused-analysis.json", () => {
    const g = graphOf(
      [
        fnode("src/root.ts", "src", "build-entry", 1),
        fnode("src/a.ts", "src", "reachable", 1, { exports: ["Used", "Unused"] }),
        fnode("src/dead.ts", "src", "orphan", 1, { exports: ["Dead"] }),
        fnode("src/consumer.ts", "src", "build-entry", 1, {
          internal: [dep("src/a.ts", ["Used"])],
        }),
      ],
      ["src/root.ts", "src/consumer.ts"],
    );
    const depData = read(emitDependencyGraph(g, tmp()));
    const unused = read(emitUnusedAnalysis(g, tmp()));
    expect(depData.statistics.unusedExportsCount).toBe(unused.summary.unusedExportCount);
    expect(depData.statistics.noImporterFileCount).toBe(unused.summary.noImporterFileCount);
    expect(depData.statistics.noImporterFileCount).toBe(1);
    expect(depData.statistics.unusedExportsCount).toBe(2);
    expect(unused.summary.unclassifiedExportCount).toBe(2);
  });
});

describe("file-inventory.json", () => {
  const WINDOWS = process.platform === "win32";
  /** A link at `link` to the folder `target`: a junction on Windows, else a symbolic link. */
  const folderLink = (link: string, target: string): void => {
    if (WINDOWS) {
      const made = Bun.spawnSync(["cmd", "/c", "mklink", "/J", link, target]).exitCode === 0;
      if (!made) throw new Error(`mklink /J failed for ${link}`);
    } else {
      symlinkSync(target, link, "dir");
    }
  };

  test("D4: byPackage and skippedLinks join repo_map's keys, in order", async () => {
    const root = tmp({
      "package.json": '{"name": "demo", "main": "src/a.ts"}\n',
      "src/a.ts": "export const a = 1;\n",
      "tests/a.test.ts": 'import { a } from "../src/a.js";\n',
    });
    const data = read(emitFileInventory(await buildGraph(root), join(root, "out")));
    expect(Object.keys(data)).toEqual([
      "totalFiles",
      "byDisposition",
      "byArea",
      "byPackage",
      "files",
      "skippedLinks",
      "warnings",
    ]);
    const counted: Record<string, number> = {};
    for (const f of data.files) counted[f.package] = (counted[f.package] ?? 0) + 1;
    expect(data.byPackage).toEqual(counted);
    expect(data.byPackage).toEqual({ "(root)": 1, demo: 1 });
    expect(data.skippedLinks).toEqual([]);
  });

  test("D4: a folder link that discovery does not follow is listed in skippedLinks", async () => {
    const base = tmp();
    const root = join(base, "repo");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
    mkdirSync(join(base, "other"), { recursive: true });
    writeFileSync(join(base, "other", "x.ts"), "export const x = 1;\n");
    folderLink(join(root, "src", "vendor"), join(base, "other"));
    const data = read(emitFileInventory(await buildGraph(root), join(base, "out")));
    expect(data.skippedLinks).toEqual(["src/vendor"]);
    expect(data.files.map((f: { file: string }) => f.file)).toEqual(["src/a.ts"]);
  });

  /** True when this host can make a folder symbolic link (Windows needs a privilege for it). */
  const CAN_SYMLINK = (() => {
    const dir = tmp();
    try {
      mkdirSync(join(dir, "t"));
      symlinkSync(join(dir, "t"), join(dir, "l"), "dir");
      return true;
    } catch {
      return false;
    }
  })();

  test.skipIf(!CAN_SYMLINK)("D4: a tracked folder link in a git repo is listed", async () => {
    const base = tmp();
    const root = join(base, "repo");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
    mkdirSync(join(base, "other"), { recursive: true });
    writeFileSync(join(base, "other", "x.ts"), "export const x = 1;\n");
    symlinkSync(join(base, "other"), join(root, "src", "vendor"), "dir");
    const git = (...args: string[]): void => {
      const r = Bun.spawnSync(["git", "-C", root, "-c", "core.symlinks=true", ...args]);
      if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`);
    };
    git("init", "-q");
    git("add", "-A");
    const data = read(emitFileInventory(await buildGraph(root), join(base, "out")));
    expect(data.skippedLinks).toEqual(["src/vendor"]);
    expect(data.files.map((f: { file: string }) => f.file)).toEqual(["src/a.ts"]);
  });

  test("has the CDG shape, and no generated date", () => {
    const data = read(emitFileInventory(DEMO(), tmp()));
    for (const key of ["totalFiles", "byDisposition", "byArea", "files"])
      expect(data).toHaveProperty(key);
    expect(data).not.toHaveProperty("generated");
    expect(data.totalFiles).toBe(2);
    expect(data.byDisposition.reachable).toBe(1);
    expect(data.byDisposition.test).toBe(1);
    expect(new Set(Object.keys(data.files[0]))).toEqual(
      new Set(["file", "package", "area", "disposition", "loc"]),
    );
  });

  test("byDisposition pre-seeds all nine keys at zero", () => {
    const data = read(emitFileInventory(DEMO(), tmp()));
    expect(new Set(Object.keys(data.byDisposition))).toEqual(
      new Set([
        "reachable",
        "build-entry",
        "test-only",
        "orphan",
        "test",
        "tool",
        "config",
        "bench",
        "example",
      ]),
    );
    expect(data.byDisposition.orphan).toBe(0);
  });

  test("the default path derives the package from build_graph's root", async () => {
    const root = tmp({
      "package.json": JSON.stringify({ name: "@scope/demo" }),
      "src/a.ts": "export const A = 1;\n",
    });
    const data = read(emitFileInventory(await buildGraph(root), join(root, "out")));
    expect(data.files.find((f: { file: string }) => f.file === "src/a.ts").package).toBe(
      "@scope/demo",
    );
  });

  test("no rootPath: (root) for every file, and a warning", () => {
    const g = DEMO();
    const data = read(emitFileInventory(g, tmp()));
    expect(new Set(data.files.map((f: { package: string }) => f.package))).toEqual(
      new Set(["(root)"]),
    );
    expect(g.warnings.some((w) => w.includes("root_path"))).toBe(true);
  });

  test("a single package.json names the src files; a test file stays (root)", () => {
    const root = tmp({ "package.json": JSON.stringify({ name: "@scope/demo" }) });
    const g = graphOf(
      [
        fnode("src/a.ts", "src", "reachable", 12, { exports: ["a"] }),
        fnode("tests/a.test.ts", "tests", "test", 5),
      ],
      ["src/a.ts"],
      root,
    );
    const byFile = Object.fromEntries(
      read(emitFileInventory(g, root)).files.map((f: { file: string; package: string }) => [
        f.file,
        f.package,
      ]),
    );
    expect(byFile).toEqual({ "src/a.ts": "@scope/demo", "tests/a.test.ts": "(root)" });
  });

  test("monorepo workspaces, array and Yarn object form", () => {
    for (const workspaces of [
      ["packages/*"],
      { packages: ["packages/*"], nohoist: ["**/react-native"] },
    ]) {
      const root = tmp({
        "package.json": JSON.stringify({ name: "root", workspaces }),
        "packages/widget/package.json": JSON.stringify({ name: "@scope/widget" }),
      });
      const g = graphOf(
        [
          fnode("packages/widget/src/index.ts", "src", "reachable", 3),
          fnode("README.md", "docs", "example", 1),
        ],
        [],
        root,
      );
      const byFile = Object.fromEntries(
        read(emitFileInventory(g, root)).files.map((f: { file: string; package: string }) => [
          f.file,
          f.package,
        ]),
      );
      expect(byFile["packages/widget/src/index.ts"]).toBe("@scope/widget");
      expect(byFile["README.md"]).toBe("(root)");
      expect(
        g.warnings.some((w) => w.includes("unexpected") || w.includes("without a 'packages'")),
      ).toBe(false);
    }
  });

  test("a missing or nameless package.json warns, in memory and in the JSON", () => {
    const g = DEMO();
    g.rootPath = tmp();
    const data = read(emitFileInventory(g, g.rootPath));
    expect(g.warnings.some((w) => w.includes("package.json"))).toBe(true);
    expect(data.warnings.some((w: string) => w.includes("package.json"))).toBe(true);
    const nameless = DEMO();
    nameless.rootPath = tmp({ "package.json": JSON.stringify({ version: "1.0.0" }) });
    const d2 = read(emitFileInventory(nameless, nameless.rootPath));
    expect(new Set(d2.files.map((f: { package: string }) => f.package))).toEqual(
      new Set(["(root)"]),
    );
    expect(nameless.warnings.some((w) => w.includes("name") && w.includes("workspaces"))).toBe(
      true,
    );
  });

  test("warnings are an explicit empty list when clean", () => {
    const root = tmp({ "package.json": JSON.stringify({ name: "@scope/demo" }) });
    const g = graphOf(
      [fnode("src/a.ts", "src", "reachable", 12, { exports: ["a"] })],
      ["src/a.ts"],
      root,
    );
    expect(read(emitFileInventory(g, root)).warnings).toEqual([]);
  });

  test("a workspace candidate without package.json warns and falls to (root)", () => {
    const root = tmp({
      "package.json": JSON.stringify({ name: "root", workspaces: ["pkgs/*"] }),
      "pkgs/good/package.json": JSON.stringify({ name: "@scope/good" }),
    });
    mkdirSync(join(root, "pkgs", "bad"), { recursive: true });
    const g = graphOf(
      [
        fnode("pkgs/good/src/g.ts", "src", "reachable", 1),
        fnode("pkgs/bad/src/b.ts", "src", "reachable", 1),
      ],
      [],
      root,
    );
    const byFile = Object.fromEntries(
      read(emitFileInventory(g, root)).files.map((f: { file: string; package: string }) => [
        f.file,
        f.package,
      ]),
    );
    expect(byFile).toEqual({ "pkgs/bad/src/b.ts": "(root)", "pkgs/good/src/g.ts": "@scope/good" });
    expect(g.warnings.some((w) => w.includes("pkgs/bad"))).toBe(true);
    // Output rule R4: no warning holds the absolute root.
    expect(g.warnings.join(" ")).not.toContain(root);
  });

  test("discovery skips the generated test-results folder", () => {
    const root = tmp({
      "tests/test-results/per-file-reporter.js": "module.exports = {};\n",
      "tests/real.test.ts": "export {};\n",
    });
    const found = new Set(discover(root).map((f) => f.path));
    expect(found.has("tests/test-results/per-file-reporter.js")).toBe(false);
    expect(found.has("tests/real.test.ts")).toBe(true);
  });
});

describe("duplicate-symbols.json", () => {
  const DUP_TS = {
    "package.json": '{"name": "demo", "main": "src/index.ts"}\n',
    "src/index.ts": 'export { foo } from "./a.js";\n',
    "src/a.ts": "export function foo() { return 1; }\n",
    "src/b.ts": "export function foo() { return 2; }\n",
  };

  test("D4: a TypeScript repo gets repo_map's keys and depgraph's classified lists", async () => {
    const root = tmp(DUP_TS);
    const data = read(emitDuplicateSymbols(await buildGraph(root), join(root, "out")));
    expect(Object.keys(data)).toEqual([
      "note",
      "classificationNote",
      "summary",
      "duplicates",
      "runtime",
      "types",
    ]);
    expect(Object.keys(data.summary)).toEqual([
      "duplicateCount",
      "totalSymbols",
      "runtimeDuplicates",
      "typeDuplicates",
      "runtimeByTag",
      "typeByTag",
    ]);
    expect(data.duplicates.foo).toEqual(["src/a.ts", "src/b.ts"]);
    expect(data.summary.runtimeDuplicates).toBe(1);
    expect(data.runtime.map((e: { name: string; tag: string }) => [e.name, e.tag])).toEqual([
      ["foo", "TRUE_DUPLICATE"],
    ]);
    expect(data.note).toContain("`runtime` and `types`");
  });

  test("D4: a declaration file is no definer in the classified lists", async () => {
    const root = tmp({
      "package.json": '{"name": "demo", "main": "src/a.ts"}\n',
      "src/a.ts": "export class Foo {\n  x = 1;\n}\n",
      "src/types/a.d.ts": "export class Foo {\n  x: number;\n}\n",
    });
    const data = read(emitDuplicateSymbols(await buildGraph(root), join(root, "out")));
    expect(data.duplicates.Foo).toEqual(["src/a.ts", "src/types/a.d.ts"]);
    expect(data.runtime).toEqual([]);
  });

  test("D4, D9: the allowlist is read from docs/architecture, never from the output folder", async () => {
    const allow = JSON.stringify({
      entries: [{ names: ["foo"], filesGlob: ["src/**"], reason: "accepted" }],
    });
    const inDocs = tmp({ ...DUP_TS, "docs/architecture/duplicate-allowlist.json": allow });
    let data = read(emitDuplicateSymbols(await buildGraph(inDocs), join(inDocs, "out")));
    expect(data.runtime[0].tag).toBe("ALLOWLISTED");

    const inOut = tmp({ ...DUP_TS, "out/duplicate-allowlist.json": allow });
    data = read(emitDuplicateSymbols(await buildGraph(inOut), join(inOut, "out")));
    expect(data.runtime[0].tag).toBe("TRUE_DUPLICATE");
  });

  test("D5: a Python repo says the classification covers TypeScript only", async () => {
    const root = tmp({
      "pkg/__init__.py": "",
      "pkg/a.py": "def foo():\n    return 1\n",
      "pkg/b.py": "def foo():\n    return 2\n",
    });
    const data = read(emitDuplicateSymbols(await buildGraph(root), join(root, "out")));
    expect(Object.keys(data)).toEqual(["note", "classificationNote", "summary", "duplicates"]);
    expect(data.classificationNote).toContain("TypeScript only");
    expect(Object.keys(data.summary)).toEqual(["duplicateCount", "totalSymbols"]);
    expect(data.duplicates.foo).toEqual(["pkg/a.py", "pkg/b.py"]);
  });

  test("groups a name across files, and ignores non-src areas", () => {
    let data = read(
      emitDuplicateSymbols(
        graphOf([
          fnode("src/a.ts", "src", "reachable", 1, { exports: ["Dup", "OnlyA"] }),
          fnode("src/b.ts", "src", "reachable", 1, { exports: ["Dup"] }),
        ]),
        tmp(),
      ),
    );
    expect(data.summary.duplicateCount).toBe(1);
    expect(data.duplicates.Dup).toEqual(["src/a.ts", "src/b.ts"]);
    expect(data.duplicates).not.toHaveProperty("OnlyA");
    data = read(
      emitDuplicateSymbols(
        graphOf([
          fnode("tests/a.test.ts", "tests", "test", 1, { exports: ["setup"] }),
          fnode("tests/b.test.ts", "tests", "test", 1, { exports: ["setup"] }),
        ]),
        tmp(),
      ),
    );
    expect(data.duplicates).toEqual({});
    expect(data.summary.totalSymbols).toBe(0);
  });

  test("a named re-export is not a second own definition", async () => {
    const root = tmp({
      "src/a.ts": "export const Widget = 1;\n",
      "src/index.ts": "export { Widget } from './a';\n",
      "src/consumer.ts": "import { Widget } from './a';\nexport const useIt = Widget;\n",
    });
    const g = await buildGraph(root);
    expect(read(emitDuplicateSymbols(g, join(root, "dup"))).duplicates).not.toHaveProperty(
      "Widget",
    );
    const unused = read(emitUnusedAnalysis(g, join(root, "unused")));
    for (const bucket of ["unreferencedAnywhere", "referencedInModule", "unclassifiedExports"])
      expect(unused[bucket]).not.toHaveProperty("src/index.ts");
  });

  test("the aliased re-export gap stays pinned, as in the source (known wrong)", async () => {
    const root = tmp({
      "src/a.ts": "export const X = 1;\n",
      "src/b.ts": "export const Y = 2;\n",
      "src/index.ts": "export { X as Y } from './a';\n",
    });
    expect(
      read(emitDuplicateSymbols(await buildGraph(root), join(root, "dup"))).duplicates.Y,
    ).toEqual(["src/b.ts", "src/index.ts"]);
  });
});

describe("unused-analysis.json", () => {
  const anyBucket = (data: Record<string, Record<string, unknown>>, path: string) =>
    ["unreferencedAnywhere", "referencedInModule", "unclassifiedExports"].some(
      (b) => path in (data[b] ?? {}),
    );

  test("an unimported export with no source to read is unclassified", () => {
    const g = graphOf([
      fnode("src/a.ts", "src", "reachable", 1, { exports: ["Used", "Unused"] }),
      fnode("src/b.ts", "src", "reachable", 1, { internal: [dep("src/a.ts", ["Used"])] }),
    ]);
    const data = read(emitUnusedAnalysis(g, tmp()));
    expect(data.unclassifiedExports["src/a.ts"]).toEqual(["Unused"]);
    expect(data.unreferencedAnywhere).toEqual({});
    expect(data.referencedInModule).toEqual({});
    expect([
      data.summary.unusedExportCount,
      data.summary.unclassifiedExportCount,
      data.summary.unreferencedAnywhereCount,
    ]).toEqual([1, 1, 0]);
  });

  test("a same name in two files does not cross-contaminate", () => {
    const g = graphOf([
      fnode("src/a.ts", "src", "reachable", 1, { exports: ["Dup"] }),
      fnode("src/b.ts", "src", "reachable", 1, { exports: ["Dup"] }),
      fnode("src/c.ts", "src", "reachable", 1, { internal: [dep("src/a.ts", ["Dup"])] }),
    ]);
    const data = read(emitUnusedAnalysis(g, tmp()));
    expect(anyBucket(data, "src/a.ts")).toBe(false);
    expect(data.unclassifiedExports["src/b.ts"]).toEqual(["Dup"]);
  });

  test("the caveats name dynamic import and warn against deleting a no-importer file", () => {
    const data = read(emitUnusedAnalysis(graphOf([]), tmp()));
    expect(
      data.caveats.some(
        (c: string) => c.includes("import(") || c.toLowerCase().includes("dynamic"),
      ),
    ).toBe(true);
    expect(
      data.caveats.some(
        (c: string) =>
          c.includes("noImporterFiles") && (c.includes("smoketest") || c.includes("config")),
      ),
    ).toBe(true);
  });

  test("noImporterFiles is in-degree, not BFS reachability, and excludes roots", () => {
    const g = graphOf(
      [
        fnode("src/root.ts", "src", "build-entry", 1),
        fnode("src/a.ts", "src", "orphan", 1, {
          internal: [dep("src/b.ts", ["B"])],
          exports: ["A"],
        }),
        fnode("src/b.ts", "src", "orphan", 1, {
          internal: [dep("src/a.ts", ["A"])],
          exports: ["B"],
        }),
        fnode("src/dead.ts", "src", "orphan", 1, { exports: ["Dead"] }),
      ],
      ["src/root.ts"],
    );
    const bfs = reachableFrom(g, g.roots);
    expect(new Set([...g.files.keys()].filter((p) => !bfs.has(p)))).toEqual(
      new Set(["src/a.ts", "src/b.ts", "src/dead.ts"]),
    );
    const data = read(emitUnusedAnalysis(g, tmp()));
    expect(data.noImporterFiles).toEqual(["src/dead.ts"]);
    expect(data.summary.noImporterFileCount).toBe(1);
    expect(
      read(
        emitUnusedAnalysis(
          graphOf([fnode("src/root.ts", "src", "build-entry", 1)], ["src/root.ts"]),
          tmp(),
        ),
      ).noImporterFiles,
    ).toEqual([]);
  });

  test("a barrel-re-exported export is not unused", async () => {
    const root = tmp({
      "src/a.ts": "export const X = 1;\nexport const Y = 2;\n",
      "src/index.ts": "export * from './a';\n",
      "src/consumer.ts": "import { X } from './index';\nexport const useIt = X;\n",
    });
    expect(
      anyBucket(read(emitUnusedAnalysis(await buildGraph(root), join(root, "out"))), "src/a.ts"),
    ).toBe(false);
  });

  test("referenced in its own module vs referenced nowhere", async () => {
    let root = tmp({
      "src/a.ts":
        "export interface Helper { value: number }\nexport function useHelper(h: Helper): number { return h.value; }\n",
      "src/consumer.ts": "import { useHelper } from './a';\nexport const x = useHelper;\n",
    });
    let data = read(emitUnusedAnalysis(await buildGraph(root), join(root, "out")));
    expect(data.referencedInModule["src/a.ts"]).toEqual(["Helper"]);
    expect(data.unreferencedAnywhere).not.toHaveProperty("src/a.ts");
    root = tmp({
      "src/a.ts": "export const Dead = 1;\n",
      "src/consumer.ts": "export const x = 1;\n",
    });
    data = read(emitUnusedAnalysis(await buildGraph(root), join(root, "out")));
    expect(data.unreferencedAnywhere["src/a.ts"]).toEqual(["Dead"]);
    const note = data.unreferencedAnywhereNotes["src/a.ts"].Dead as string;
    expect(note).not.toContain("Verified");
    expect(note).toContain("found none");
    expect(note).toContain("literal string specifier");
  });

  test("a note names a verified dynamic-import referrer", async () => {
    const root = tmp({
      "src/a.ts": "export function helper() { return 1; }\n",
      "src/b.ts":
        "export async function useIt() {\n  const { helper } = await import('./a');\n  return helper();\n}\n",
    });
    const data = read(emitUnusedAnalysis(await buildGraph(root), join(root, "out")));
    expect(data.unreferencedAnywhere["src/a.ts"]).toEqual(["helper"]);
    const note = data.unreferencedAnywhereNotes["src/a.ts"].helper as string;
    expect(note).toContain("Verified");
    expect(note).toContain("src/b.ts");
  });

  test("a template-literal dynamic import is out of the scan's scope, and the note says so", async () => {
    const root = tmp({
      "src/cmds/foo.ts": "export function runFoo() { return 1; }\n",
      "src/dispatcher.ts":
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is TypeScript source with a template literal.
        "export async function dispatch(name: string) {\n  const mod = await import(`./cmds/${name}.js`);\n  return mod;\n}\n",
    });
    const data = read(emitUnusedAnalysis(await buildGraph(root), join(root, "out")));
    expect(data.unreferencedAnywhere["src/cmds/foo.ts"]).toEqual(["runFoo"]);
    const note = data.unreferencedAnywhereNotes["src/cmds/foo.ts"].runFoo as string;
    expect(note).not.toContain("Verified");
    expect(note).toContain("literal string specifier");
  });
});
