import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  analyzeTestCoverage,
  buildCategoryBreakdown,
  buildReExportMap,
  type CoveragePolicy,
  classifyAgainstPolicy,
  loadCoveragePolicy,
  traceReExports,
} from "../../src/depgraph/coverage.ts";
import {
  buildFileInventory,
  censusFailure,
  censusOrphanWarning,
  censusPassLine,
  checkCensusNoRegen,
  classifyArea,
  countLoc,
  packageOf,
} from "../../src/depgraph/inventory.ts";
import { parseFile } from "../../src/depgraph/parser.ts";
import type { WorkspacePackage } from "../../src/depgraph/types.ts";
import { makeTree, removeTrees } from "./tree.ts";

afterAll(removeTrees);

const core: WorkspacePackage = {
  name: "@scope/core",
  directory: "packages/core",
  srcDir: "packages/core/src",
  extraEntries: [],
};
const ws = new Map([[core.name, core]]);

describe("inventory", () => {
  test("classifyArea checks tools, config, tests, bench, examples and docs in order", () => {
    expect(classifyArea("tools/tests/x.ts")).toBe("tools");
    expect(classifyArea("scripts/a.ts")).toBe("tools");
    expect(classifyArea("vitest.config.browser.ts")).toBe("config");
    expect(classifyArea("pkg/test/h.ts")).toBe("tests");
    expect(classifyArea("pkg/src/a.spec.ts")).toBe("tests");
    expect(classifyArea("pkg/bench/b.ts")).toBe("bench");
    expect(classifyArea("examples/e.ts")).toBe("examples");
    expect(classifyArea("docs/d.ts")).toBe("docs");
    expect(classifyArea("pkg/src/a.ts")).toBe("src");
  });

  test("packageOf finds the workspace package or (root)", () => {
    expect(packageOf("packages/core/src/a.ts", ws)).toBe("@scope/core");
    expect(packageOf("tools/a.ts", ws)).toBe("(root)");
  });

  const root = makeTree({
    "packages/core/src/index.ts": "a\nb\n",
    "packages/core/src/used.ts": "",
    "packages/core/src/tested.ts": "",
    "packages/core/src/lost.ts": "",
    "packages/core/tests/t.test.ts": "",
    "tools/gen.ts": "",
    "vitest.config.ts": "",
    "examples/e.ts": "",
  });

  test("countLoc counts LF plus one and gives 0 for a missing file", () => {
    expect(countLoc(root, "packages/core/src/index.ts")).toBe(3);
    expect(countLoc(root, "absent.ts")).toBe(0);
  });

  const inventory = buildFileInventory(
    root,
    ws,
    new Set(["packages/core/src/index.ts"]),
    new Set(["packages/core/src/index.ts", "packages/core/src/used.ts"]),
    new Set(["packages/core/src/tested.ts"]),
  );

  test("buildFileInventory gives each file a disposition and counts them", () => {
    expect(inventory).not.toHaveProperty("generated");
    expect(inventory.files.map((r) => [r.file, r.disposition])).toEqual([
      ["examples/e.ts", "example"],
      ["packages/core/src/index.ts", "build-entry"],
      ["packages/core/src/lost.ts", "orphan"],
      ["packages/core/src/tested.ts", "test-only"],
      ["packages/core/src/used.ts", "reachable"],
      ["packages/core/tests/t.test.ts", "test"],
      ["tools/gen.ts", "tool"],
      ["vitest.config.ts", "config"],
    ]);
    expect(inventory.byDisposition).toEqual({
      reachable: 1,
      "build-entry": 1,
      "test-only": 1,
      orphan: 1,
      test: 1,
      tool: 1,
      config: 1,
      example: 1,
      bench: 0,
    });
    expect(inventory.byPackage).toEqual({ "(root)": 3, "@scope/core": 5 });
  });

  test("censusFailure reports orphans, unlisted files and stale entries", () => {
    const text = censusFailure(root, inventory, true) ?? "";
    expect(text).toContain("1 ORPHAN file(s)");
    expect(text).toContain("! packages/core/src/lost.ts");
    // Fix M1: without --strict-orphans an orphan is a warning, not a failure.
    expect(censusFailure(root, inventory)).toBeNull();
    expect(censusOrphanWarning(inventory)).toContain("! packages/core/src/lost.ts");
    expect(censusPassLine(inventory)).toContain("1 orphan.");
    const clean = {
      ...inventory,
      files: inventory.files.filter((r) => r.disposition !== "orphan"),
    };
    const gap = censusFailure(root, clean) ?? "";
    expect(gap).toContain("+ packages/core/src/lost.ts");
    const stale = {
      ...clean,
      files: [...inventory.files, { ...inventory.files[0], file: "gone.ts" }],
    };
    expect(censusFailure(root, stale as typeof inventory)).toContain("- gone.ts");
  });

  test("censusFailure passes a census that equals the walk and holds no orphan", () => {
    const passing = {
      ...inventory,
      files: inventory.files.map((r) => ({ ...r, disposition: "reachable" as const })),
    };
    expect(censusFailure(root, passing, true)).toBeNull();
    expect(censusOrphanWarning(passing)).toBeNull();
    expect(censusPassLine(passing)).toContain("8 files == maximal repo walk");
  });

  test("checkCensusNoRegen reads the committed inventory", () => {
    const out = join(root, "docs", "architecture");
    expect(checkCensusNoRegen(root, out)).toContain("not found");
    expect(checkCensusNoRegen(root, out)?.endsWith("\n")).toBe(true);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "file-inventory.json"), JSON.stringify(inventory));
    expect(checkCensusNoRegen(root, out, true)).toContain("ORPHAN");
    expect(checkCensusNoRegen(root, out)).toBeNull();
  });
});

describe("coverage", () => {
  const policy: CoveragePolicy = {
    categories: {
      gen: { label: "Generated", rationale: "Made by a tool. More.", pathPrefixes: ["src/gen/"] },
      one: { label: "One", rationale: "Named.", exactPaths: ["src/gen/x.ts"] },
    },
  };

  test("classifyAgainstPolicy prefers exact paths over prefixes", () => {
    expect(classifyAgainstPolicy("src/gen/x.ts", policy)).toBe("one");
    expect(classifyAgainstPolicy("src/gen/y.ts", policy)).toBe("gen");
    expect(classifyAgainstPolicy("src/a.ts", policy)).toBeNull();
    expect(classifyAgainstPolicy("src/a.ts", null)).toBeNull();
  });

  test("buildCategoryBreakdown excludes policy files from the active set", () => {
    const b = buildCategoryBreakdown(
      ["src/a.ts", "src/b.ts", "src/gen/y.ts"],
      ["src/a.ts"],
      ["src/b.ts", "src/gen/y.ts"],
      policy,
    );
    expect(b.byCategory).toEqual({ gen: 1, one: 0, active_untested: 1 });
    expect(b.activeFiles).toBe(2);
    expect(b.testedActive).toBe(1);
    expect(b.effectivePercent).toBe("50.0");
    expect(b.classifiedUntested).toEqual([
      { file: "src/b.ts", category: null },
      { file: "src/gen/y.ts", category: "gen" },
    ]);
  });

  const root = makeTree({
    "src/index.ts": "export * from './mid.js';\n",
    "src/mid.ts": "export { a } from './a.js';\n",
    "src/a.ts": "export const a = 1;\n",
    "src/b.ts": "export const b = 1;\n",
    "tests/i.test.ts": "import { a } from '../src/index.js';\n",
  });
  const parse = (p: string) => parseFile({ root, workspaces: new Map() }, join(root, p));
  const sources = ["src/index.ts", "src/mid.ts", "src/a.ts", "src/b.ts"].map(parse);
  const tests = [parse("tests/i.test.ts")];

  test("buildReExportMap expands barrel chains and traceReExports reads it", () => {
    const map = buildReExportMap(sources);
    expect([...(map.get("src/index.ts") ?? [])]).toEqual(["src/mid.ts", "src/a.ts"]);
    expect([...traceReExports("src/index.ts", map)]).toEqual([
      "src/index.ts",
      "src/mid.ts",
      "src/a.ts",
    ]);
  });

  test("loadCoveragePolicy returns null without a policy file", () => {
    expect(loadCoveragePolicy(root)).toBeNull();
  });

  test("analyzeTestCoverage covers files through a barrel", () => {
    const cov = analyzeTestCoverage(sources, tests, root);
    expect(cov.testedFiles).toEqual(["src/index.ts", "src/mid.ts", "src/a.ts"]);
    expect(cov.untestedFiles).toEqual(["src/b.ts"]);
    expect(cov.testToSourceMap.get("tests/i.test.ts")).toEqual([
      "src/index.ts",
      "src/mid.ts",
      "src/a.ts",
    ]);
    expect(cov.policy).toBeNull();
  });
});
