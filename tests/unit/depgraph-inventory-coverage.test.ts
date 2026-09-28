import { afterAll, describe, expect, test } from "bun:test";
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
import { toParsedFiles } from "../../src/map/adapter.ts";
import { classifyArea } from "../../src/map/discovery.ts";
import { buildGraph } from "../../src/map/graph.ts";
import { makeTree, removeTrees } from "./tree.ts";

afterAll(removeTrees);

const coverageRoot = makeTree({
  "src/index.ts": "export * from './mid.js';\n",
  "src/mid.ts": "export { a } from './a.js';\n",
  "src/a.ts": "export const a = 1;\n",
  "src/b.ts": "export const b = 1;\n",
  "tests/i.test.ts": "import { a } from '../src/index.js';\n",
});
const coverageRecords = toParsedFiles(await buildGraph(coverageRoot), coverageRoot, {
  allAreas: true,
});
const sources = coverageRecords.filter((r) => r.path.startsWith("src/"));
const tests = coverageRecords.filter((r) => r.path.startsWith("tests/"));

describe("area of a path", () => {
  test("classifyArea checks tools, config, tests, benchmarks, examples and docs", () => {
    expect(classifyArea("tools/tests/x.ts")).toBe("tools");
    expect(classifyArea("scripts/a.ts")).toBe("tools");
    expect(classifyArea("vitest.config.browser.ts")).toBe("config");
    expect(classifyArea("pkg/src/a.spec.ts")).toBe("tests");
    expect(classifyArea("src/view.test.tsx")).toBe("tests");
    expect(classifyArea("benchmarks/b.ts")).toBe("benchmarks");
    expect(classifyArea("examples/e.ts")).toBe("examples");
    expect(classifyArea("docs/d.ts")).toBe("docs");
    expect(classifyArea("pkg/src/a.ts")).toBe("src");
    // A folder named test/ is source unless the file name is a test.
    expect(classifyArea("pkg/test/h.ts")).toBe("src");
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

  const root = coverageRoot;

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
    expect(loadCoveragePolicy(join(root, "docs/architecture/coverage-policy.json"))).toBeNull();
  });

  test("analyzeTestCoverage covers files through a barrel", () => {
    const cov = analyzeTestCoverage(sources, tests, root);
    expect(cov.testedFiles).toEqual(["src/a.ts", "src/index.ts", "src/mid.ts"]);
    expect(cov.untestedFiles).toEqual(["src/b.ts"]);
    expect(cov.testToSourceMap.get("tests/i.test.ts")).toEqual([
      "src/index.ts",
      "src/mid.ts",
      "src/a.ts",
    ]);
    expect(cov.policy).toBeNull();
  });
});
