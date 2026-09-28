import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import {
  buildDependencyMatrix,
  categorizeFiles,
  computePublicSurface,
  detectUnused,
  generateStatistics,
} from "../../src/depgraph/analysis.ts";
import { parseDepgraphArgs } from "../../src/depgraph/args.ts";
import { analyzeTestCoverage } from "../../src/depgraph/coverage.ts";
import { detectCyclicComponents } from "../../src/depgraph/cycles.ts";
import { loadExtensions } from "../../src/depgraph/extensions.ts";
import { bannerFor, VERIFICATION_MARKER, withBanner } from "../../src/depgraph/reporters/banner.ts";
import {
  generateTestCoverageJson,
  generateTestCoverageMarkdown,
} from "../../src/depgraph/reporters/coverage.ts";
import {
  dependencyGraphJsonText,
  generateCompactSummary,
  generateJSON,
} from "../../src/depgraph/reporters/json.ts";
import {
  generateMarkdown,
  generateMermaidDiagram,
  generatePackageDependencySection,
  insertPackageSection,
} from "../../src/depgraph/reporters/markdown.ts";
import {
  buildPackageExportSurfaces,
  generateSurfacesJson,
  packageKeyOf,
} from "../../src/depgraph/reporters/surfaces.ts";
import { generateYaml } from "../../src/depgraph/reporters/yaml.ts";
import type { WorkspacePackage } from "../../src/depgraph/types.ts";
import type { Io } from "../../src/io-types.ts";
import { toParsedFiles } from "../../src/map/adapter.ts";
import { MAP_HELP, runMap } from "../../src/map/command.ts";
import { buildGraph } from "../../src/map/graph.ts";
import { makeTree, removeTrees } from "./tree.ts";

afterAll(removeTrees);

const none = new Map<string, WorkspacePackage>();
const pkg = { name: "demo", version: "1.2.3" };

const root = makeTree({
  "package.json": JSON.stringify(pkg),
  "src/index.ts": "/**\n * Entry.\n */\nexport { a } from './a.js';\n",
  "src/a.ts":
    "import { b } from './b.js';\nexport class A {}\nexport function a() { return b(); }\n",
  "src/b.ts":
    "import { a } from './a.js';\nexport function b() { return a; }\nexport const spare = 1;\n",
  "src/lib/c.ts": "export interface C { x: number }\n",
  "tests/a.test.ts": "import { a } from '../src/a.js';\n",
});
const records = toParsedFiles(await buildGraph(root), root, { allAreas: true });
const files = records.filter((r) => r.path.startsWith("src/"));
const tests = records.filter((r) => r.path.startsWith("tests/"));
const modules = categorizeFiles(files, false, none);
const cycles = detectCyclicComponents(files);
const unused = detectUnused(files, tests, root, none);
const stats = generateStatistics(files, modules, cycles, unused, root);
const matrix = buildDependencyMatrix(files);

/** Captures the output of `run`. */
async function capture(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const io: Io = {
    stdout: (s) => {
      out += s;
    },
    stderr: (s) => {
      err += s;
    },
  };
  const code = await runMap(argv, io);
  return { code, out, err };
}

describe("banner", () => {
  test("withBanner puts the marker and the banner first", () => {
    expect(withBanner("# X\n").startsWith(`${VERIFICATION_MARKER}\n<!-- GENERATED FILE`)).toBe(
      true,
    );
    expect(withBanner("# X\n")).toBe(`${bannerFor({})}# X\n`);
    expect(bannerFor({}).endsWith("-->\n\n")).toBe(true);
  });
});

describe("markdown reporter", () => {
  test("generateMermaidDiagram draws subgraphs and edges", () => {
    const text = generateMermaidDiagram(modules, files);
    expect(text).toContain("    subgraph Root\n        N0[a]\n        N1[b]\n    end");
    expect(text).toContain("    subgraph Entry\n        N2[index]\n    end");
    expect(text).toContain("    N0 --> N1");
    expect(text).toContain("    N2 --> N0");
    expect(text.endsWith("```")).toBe(true);
  });

  test("generateMarkdown holds the sections, the cycle and the statistics", () => {
    const md = generateMarkdown(files, modules, stats, cycles, matrix, pkg);
    expect(md.startsWith("# demo - Dependency Graph\n\n**Version**: 1.2.3\n")).toBe(true);
    expect(md).toContain("### `src/index.ts` - Entry.");
    expect(md).toContain("- src/a.ts -> src/b.ts -> src/a.ts");
    expect(md).toContain("| Total TypeScript Files | 4 |");
    expect(md.endsWith("*Version*: 1.2.3\n")).toBe(true);
  });

  test("generatePackageDependencySection and insertPackageSection place the package table", () => {
    const ws = new Map<string, WorkspacePackage>([
      ["@s/a", { name: "@s/a", directory: "pa", srcDir: "pa/src", extraEntries: [] }],
    ]);
    const section = generatePackageDependencySection(files, ws);
    expect(section).toContain("| `@s/a` (`pa/`) | (none) | 0 | 0 |");
    expect(section).toContain("    P0[pa]");
    const md = "# T\n\n## Overview\n\nx\n\n---\n\n## Next\n";
    expect(insertPackageSection(md, "SECTION\n")).toBe(
      "# T\n\n## Overview\n\nx\n\n---\n\nSECTION\n\n## Next\n",
    );
    expect(insertPackageSection("no overview", "S")).toBe("no overview");
  });
});

describe("json and yaml reporters", () => {
  const json = generateJSON(files, modules, stats, cycles, pkg) as Record<string, unknown>;

  test("generateJSON keeps the report key order and drops empty lists", () => {
    expect(Object.keys(json)).toEqual([
      "metadata",
      "entryPoints",
      "modules",
      "dependencyGraph",
      "statistics",
    ]);
    const text = dependencyGraphJsonText(json);
    expect(text).not.toContain("lastUpdated");
    expect(text).not.toContain('"enums"');
    expect(text.endsWith("}")).toBe(true);
  });

  test("generateCompactSummary is minified with short keys", () => {
    const text = generateCompactSummary(files, modules, stats, cycles, pkg);
    const obj = JSON.parse(text);
    expect(obj.m).toEqual({ n: "demo", v: "1.2.3", f: 4, e: stats.totalExports, re: 1 });
    expect(obj.c.rtp).toEqual(["a→b→a"]);
    expect(text).not.toContain("\n");
  });

  test("generateYaml round-trips to the same object", () => {
    expect(load(generateYaml(json))).toEqual(JSON.parse(JSON.stringify(json)));
  });
});

describe("coverage and surface reporters", () => {
  test("generateTestCoverageMarkdown groups untested files and the JSON sorts them", () => {
    const cov = analyzeTestCoverage(files, tests, root);
    const md = generateTestCoverageMarkdown(cov);
    expect(md).toContain("| Coverage (raw, direct-import) | **25.0%** |");
    expect(md).toContain("### lib/");
    const obj = generateTestCoverageJson(cov) as { metadata: Record<string, unknown> };
    expect(obj.metadata).not.toHaveProperty("generatedAt");
    expect(cov.untestedFiles).toEqual(["src/b.ts", "src/index.ts", "src/lib/c.ts"]);
  });

  test("the surface reporters group names by package key", () => {
    expect(packageKeyOf("packages/core/sub")).toBe("packages/core");
    expect(packageKeyOf("core/sub")).toBe("core");
    const surface = computePublicSurface(files, root, none);
    const surfaces = buildPackageExportSurfaces(modules, surface);
    expect(surfaces.lib).toEqual([]);
    // Fix F15: `src/index.ts` re-exports `a` only; `A`, `b` and `spare` are internal.
    expect(surfaces.root).toEqual(["a"]);
    expect(surfaces.entry).toEqual(["a"]);
    expect(JSON.parse(generateSurfacesJson(modules, surface))).not.toHaveProperty("generated");
  });
});

describe("pipeline entry", () => {
  test("parseDepgraphArgs reads the flags", () => {
    expect(parseDepgraphArgs(["--root=x", "-a", "-t", "--check-census"], "cwd")).toEqual({
      root: "x",
      settings: {},
      includeTests: true,
      all: true,
      reachableOnly: false,
      strictOrphans: false,
      strictCensus: false,
      checkCensus: true,
      checkDuplicates: false,
      noRegen: false,
      writeDuplicateBaseline: false,
      noExtensions: false,
      help: false,
      ignoredFlags: [],
    });
    // Fix M1: the two single-package model flags.
    const m1 = parseDepgraphArgs(["--reachable-only", "--strict-orphans"], "cwd");
    expect([m1.reachableOnly, m1.strictOrphans]).toEqual([true, true]);
    expect(parseDepgraphArgs([root], "cwd").root).toBe(root);
    // A positional root is taken as given; the run checks that it is a directory.
    expect(parseDepgraphArgs(["no-such-path"], "cwd").root).toBe("no-such-path");
  });

  test("--help prints the help and exits 0", async () => {
    const r = await capture(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(MAP_HELP);
  });

  test("the --write-duplicate-baseline help says it reads the last run's report", () => {
    // The baseline copies the report of the last depgraph run. The help must say so, so a
    // stale report never gives a surprise baseline.
    const flat = MAP_HELP.replace(/\s+/g, " ");
    expect(flat).toContain(
      "--write-duplicate-baseline Write the duplicate baseline from the duplicate-symbols.json of the last run.",
    );
  });

  test("--check-census fails without a committed inventory", async () => {
    const r = await capture([`--root=${root}`, "--check-census"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("does not exist");
  });

  test("run writes the reports and prints root-relative paths", async () => {
    const r = await capture([`--root=${root}`]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Written: docs/architecture/DEPENDENCY_GRAPH.md");
    expect(r.out).not.toContain(root);
    const md = readFileSync(join(root, "docs/architecture/DEPENDENCY_GRAPH.md"), "utf8");
    expect(md.startsWith(VERIFICATION_MARKER)).toBe(true);
    // Fix M1: a single-package run writes the inventory too.
    expect(existsSync(join(root, "docs/architecture/file-inventory.json"))).toBe(true);
  });

  test("loadExtensions loads nothing when the config names no extension", async () => {
    expect(await loadExtensions(root, [])).toEqual([]);
  });
});
