import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import {
  buildDependencyMatrix,
  categorizeFiles,
  detectCircularDependencies,
  detectUnused,
  generateStatistics,
} from "../../src/depgraph/analysis.ts";
import { analyzeTestCoverage } from "../../src/depgraph/coverage.ts";
import { loadExtensions } from "../../src/depgraph/extensions.ts";
import { DEPGRAPH_HELP, parseDepgraphArgs, run } from "../../src/depgraph/index.ts";
import { buildFileInventory } from "../../src/depgraph/inventory.ts";
import { parseFile } from "../../src/depgraph/parser.ts";
import {
  GENERATED_REPORT_BANNER,
  VERIFICATION_MARKER,
  withBanner,
} from "../../src/depgraph/reporters/banner.ts";
import {
  generateTestCoverageJson,
  generateTestCoverageMarkdown,
} from "../../src/depgraph/reporters/coverage.ts";
import {
  FILE_DISPOSITION_LEGEND,
  generateFileInventoryJson,
  generateFileInventoryMarkdown,
} from "../../src/depgraph/reporters/inventory.ts";
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
import { generateUnusedReport } from "../../src/depgraph/reporters/unused.ts";
import { generateYaml } from "../../src/depgraph/reporters/yaml.ts";
import type { WorkspacePackage } from "../../src/depgraph/types.ts";
import type { Io } from "../../src/io-types.ts";
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
const files = ["src/index.ts", "src/a.ts", "src/b.ts", "src/lib/c.ts"].map((p) =>
  parseFile({ root, workspaces: none }, join(root, p)),
);
const tests = [parseFile({ root, workspaces: none }, join(root, "tests/a.test.ts"))];
const modules = categorizeFiles(files, false, none);
const cycles = detectCircularDependencies(files);
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
  const code = await run(argv, io);
  return { code, out, err };
}

describe("banner", () => {
  test("withBanner puts the marker and the banner first", () => {
    expect(withBanner("# X\n").startsWith(`${VERIFICATION_MARKER}\n<!-- GENERATED FILE`)).toBe(
      true,
    );
    expect(withBanner("# X\n")).toBe(`${GENERATED_REPORT_BANNER}# X\n`);
    expect(GENERATED_REPORT_BANNER.endsWith("-->\n\n")).toBe(true);
  });
});

describe("markdown reporter", () => {
  test("generateMermaidDiagram draws subgraphs and edges", () => {
    const text = generateMermaidDiagram(modules, files);
    expect(text).toContain("    subgraph Entry\n        N0[index]\n    end");
    expect(text).toContain("    N1 --> N2");
    expect(text.endsWith("```")).toBe(true);
  });

  test("generateMarkdown holds the sections, the cycle and the statistics", () => {
    const md = generateMarkdown(files, modules, stats, cycles, matrix, pkg, "DAY");
    expect(
      md.startsWith("# demo - Dependency Graph\n\n**Version**: 1.2.3 | **Last Updated**: DAY"),
    ).toBe(true);
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
  const json = generateJSON(files, modules, stats, cycles, pkg, "DAY") as Record<string, unknown>;

  test("generateJSON keeps the report key order and drops empty lists", () => {
    expect(Object.keys(json)).toEqual([
      "metadata",
      "entryPoints",
      "modules",
      "dependencyGraph",
      "statistics",
    ]);
    const text = dependencyGraphJsonText(json);
    expect(text).toContain('"lastUpdated": "DAY"');
    expect(text).not.toContain('"enums"');
    expect(text.endsWith("}")).toBe(true);
  });

  test("generateCompactSummary is minified with short keys", () => {
    const text = generateCompactSummary(files, modules, stats, cycles, pkg, "DAY");
    const obj = JSON.parse(text);
    expect(obj.m).toEqual({ n: "demo", v: "1.2.3", d: "DAY", f: 4, e: stats.totalExports, re: 1 });
    expect(obj.c.rtp).toEqual(["a→b→a"]);
    expect(text).not.toContain("\n");
  });

  test("generateYaml round-trips to the same object", () => {
    expect(yaml.load(generateYaml(json))).toEqual(JSON.parse(JSON.stringify(json)));
  });
});

describe("unused, coverage, inventory and surface reporters", () => {
  test("generateUnusedReport lists unused files and exports", () => {
    const split = { testReachable: new Set<string>(), dormantAll: [], orphaned: [], testOnly: [] };
    const md = generateUnusedReport(unused, split, none, "DAY");
    expect(md).toContain("**Generated**: DAY");
    expect(md).toContain("- `src/lib/c.ts`");
    expect(md).toContain("- `spare` (constant)");
  });

  test("generateTestCoverageMarkdown groups untested files and the JSON sorts them", () => {
    const cov = analyzeTestCoverage(files, tests, root);
    const md = generateTestCoverageMarkdown(cov, "DAY");
    expect(md).toContain("| Coverage (raw, direct-import) | **25.0%** |");
    expect(md).toContain("### lib/");
    const obj = generateTestCoverageJson(cov, "NOW") as { metadata: { generatedAt: string } };
    expect(obj.metadata.generatedAt).toBe("NOW");
    expect(cov.untestedFiles).toEqual(["src/b.ts", "src/index.ts", "src/lib/c.ts"]);
  });

  test("the inventory reporters render every row", () => {
    const inv = buildFileInventory(root, none, new Set(), new Set(), new Set(), "DAY");
    const md = generateFileInventoryMarkdown(inv);
    expect(FILE_DISPOSITION_LEGEND.map(([d]) => d)).toContain("orphan");
    expect(md).toContain("| `tests/a.test.ts` | (root) | tests | test |");
    expect(JSON.parse(generateFileInventoryJson(inv))).toEqual(inv);
  });

  test("the surface reporters group names by package key", () => {
    expect(packageKeyOf("packages/core/sub")).toBe("packages/core");
    expect(packageKeyOf("core/sub")).toBe("core");
    const surfaces = buildPackageExportSurfaces(modules);
    expect(surfaces.lib).toEqual([]);
    expect(surfaces.root).toEqual(["A", "a", "b", "spare"].sort((x, y) => x.localeCompare(y)));
    expect(JSON.parse(generateSurfacesJson(modules, "DAY")).generated).toBe("DAY");
  });
});

describe("pipeline entry", () => {
  test("parseDepgraphArgs reads the flags and ignores unknown ones", () => {
    expect(parseDepgraphArgs(["--root=x", "-a", "-t", "--check-census", "--zz"], "cwd")).toEqual({
      root: "x",
      includeTests: true,
      all: true,
      checkCensus: true,
      help: false,
    });
    expect(parseDepgraphArgs([root], "cwd").root).toBe(root);
    expect(parseDepgraphArgs(["no-such-path"], "cwd").root).toBe("cwd");
  });

  test("--help prints the help and exits 0", async () => {
    const r = await capture(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(DEPGRAPH_HELP);
  });

  test("run writes the reports and prints root-relative paths", async () => {
    const r = await capture([`--root=${root}`]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Written: docs/architecture/DEPENDENCY_GRAPH.md");
    expect(r.out).not.toContain(root);
    const md = readFileSync(join(root, "docs/architecture/DEPENDENCY_GRAPH.md"), "utf8");
    expect(md.startsWith(VERIFICATION_MARKER)).toBe(true);
    expect(existsSync(join(root, "docs/architecture/file-inventory.json"))).toBe(false);
  });

  test("--check-census fails without a committed inventory", async () => {
    const r = await capture([`--root=${root}`, "--check-census"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("not found");
  });

  test("loadExtensions loads nothing in the port", () => {
    expect(loadExtensions()).toEqual([]);
  });
});
