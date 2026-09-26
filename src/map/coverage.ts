/**
 * Test coverage on the map engine's graph (design decision D5), for every language:
 * TEST_COVERAGE.md and test-coverage.json. depgraph's analyzer runs on the `src` files against the
 * `tests` files of the graph, through the adapter. A test covers each file it imports, the files a
 * barrel re-exports, and the bare side-effect imports behind them.
 *
 * The coverage policy is an input, so it never comes from the output folder (D9). The TypeScript
 * report keeps depgraph's "Expected test" hint; for another language that hint would name a file
 * that cannot exist, so the report lists the untested files only.
 */
import { join } from "node:path";
import { analyzeTestCoverage } from "../depgraph/coverage.ts";
import { type BannerOptions, withBanner } from "../depgraph/reporters/banner.ts";
import {
  generateTestCoverageJson,
  generateTestCoverageMarkdown,
} from "../depgraph/reporters/coverage.ts";
import { writeReport } from "../io.ts";
import { toParsedFiles } from "./adapter.ts";
import { MAP_REGENERATE_COMMAND } from "./reports.ts";
import type { RepoGraph } from "./schema.ts";

/**
 * True when `path` is a test file by the convention of `language`. A fixture or a helper in a
 * tests folder is no test: it is data or code that a test reads.
 * - TypeScript and JavaScript: a `*.test.*` or `*.spec.*` file in any area, as in depgraph 1.x.
 * - Python: pytest's `test_*.py` or `*_test.py`.
 * - C# and Rust: a file in the `tests` area, because neither has a test-file name rule.
 */
export function isTestFile(path: string, language: string, area: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (language === "typescript") return /\.(test|spec)\.[cm]?[jt]sx?$/.test(name);
  if (language === "python") return /^test_.*\.py$/.test(name) || /_test\.py$/.test(name);
  return area === "tests";
}

/** The options of `emitTestCoverage`. */
export interface TestCoverageOptions {
  /** The coverage policy. Default: `<root>/docs/architecture/coverage-policy.json` (D9). */
  policyPath?: string;
  banner?: BannerOptions;
}

/** Writes TEST_COVERAGE.md and test-coverage.json into `outDir`; returns their paths. */
export function emitTestCoverage(
  graph: RepoGraph,
  root: string,
  outDir: string,
  options: TestCoverageOptions = {},
): [string, string] {
  const sources = toParsedFiles(graph, root);
  const tests = toParsedFiles(graph, root, { allAreas: true, loadEdges: true }).filter((r) =>
    isTestFile(r.path, graph.language, graph.files.get(r.path)?.area ?? ""),
  );
  const coverage = analyzeTestCoverage(
    sources,
    tests,
    root,
    options.policyPath ?? join(root, "docs", "architecture", "coverage-policy.json"),
  );
  const mdPath = join(outDir, "TEST_COVERAGE.md");
  const jsonPath = join(outDir, "test-coverage.json");
  // The Markdown first: the JSON reporter sorts the file lists in place.
  const markdown = generateTestCoverageMarkdown(coverage, {
    expectedTestHint: graph.language === "typescript",
  });
  writeReport(mdPath, withBanner(markdown, { command: MAP_REGENERATE_COMMAND, ...options.banner }));
  writeReport(jsonPath, JSON.stringify(generateTestCoverageJson(coverage), null, 2));
  return [mdPath, jsonPath];
}
