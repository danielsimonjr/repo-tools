/**
 * The subsystem reports of the map engine (design decisions D3 and D5), for every language:
 * DEPENDENCY_GRAPH.md and dependency-summary.compact.json render the subsystem view and the core
 * statistics, and dependency-graph.yaml mirrors the core dependency-graph.json.
 *
 * The statistics come from the core file only, so a report cannot disagree with it. The core
 * statistics count every area (repo_map's scope); the subsystem view holds the `src` files.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAP_REGENERATE_COMMAND } from "../config.ts";
import { buildDependencyMatrix } from "../depgraph/analysis.ts";
import { type BannerOptions, withBanner } from "../depgraph/reporters/banner.ts";
import { generateCompactSummary } from "../depgraph/reporters/json.ts";
import {
  generateMarkdown,
  type SummaryLabels,
  summaryRowsOf,
} from "../depgraph/reporters/markdown.ts";
import { generateYaml } from "../depgraph/reporters/yaml.ts";
import type { Statistics } from "../depgraph/types.ts";
import { writeReport } from "../io.ts";
import { projectIdentity, type SubsystemView, subsystemView } from "./layers.ts";
import type { RepoGraph } from "./schema.ts";

export { MAP_REGENERATE_COMMAND };

type CoreStatistics = Record<string, number | boolean | undefined>;

/**
 * The core statistics in depgraph's shape, for the reporters that read it. `totalTypeScriptFiles`
 * is the file count of every language, and `totalModules` is the number of subsystems. The kind
 * counts are absent for a language that has none.
 */
function statisticsFromCore(core: CoreStatistics, subsystems: number): Statistics {
  const num = (key: string): number => core[key] as number;
  const opt = (key: string): number | undefined => core[key] as number | undefined;
  return {
    totalTypeScriptFiles: num("totalSourceFiles"),
    totalModules: subsystems,
    totalLinesOfCode: num("totalLinesOfCode"),
    totalExports: num("totalExports"),
    totalClasses: opt("totalClasses"),
    totalInterfaces: opt("totalInterfaces"),
    totalFunctions: opt("totalFunctions"),
    totalTypeGuards: opt("totalTypeGuards"),
    totalEnums: opt("totalEnums"),
    totalConstants: opt("totalConstants"),
    totalReExports: opt("totalReExports"),
    totalTypeOnlyImports: num("totalTypeOnlyImports"),
    runtimeCyclicComponents: num("runtimeCyclicComponents"),
    typeOnlyCyclicComponents: num("typeOnlyCyclicComponents"),
    runtimeFilesInCycles: num("runtimeFilesInCycles"),
    typeOnlyFilesInCycles: num("typeOnlyFilesInCycles"),
    // Neither report reads these two; they hold the core's nearest counts.
    unusedFilesCount: num("noImporterFileCount"),
    unusedExportsCount: num("unusedExportsCount"),
  };
}

/** The labels of the 2.0.0 Markdown: language-neutral names. */
const SUMMARY_LABELS: SummaryLabels = { files: "Total Source Files", modules: "Subsystems" };

/** The options of `emitSubsystemReports`. */
export interface SubsystemReportOptions {
  view?: SubsystemView;
  banner?: BannerOptions;
}

/**
 * Writes DEPENDENCY_GRAPH.md, dependency-graph.yaml and dependency-summary.compact.json into
 * `outDir`, and returns their paths. `corePath` is the dependency-graph.json that this run wrote.
 */
export function emitSubsystemReports(
  graph: RepoGraph,
  root: string,
  outDir: string,
  corePath: string,
  options: SubsystemReportOptions = {},
): string[] {
  const view = options.view ?? subsystemView(graph, root);
  const core = JSON.parse(readFileSync(corePath, "utf8")) as { statistics: CoreStatistics };
  const stats = statisticsFromCore(core.statistics, Object.keys(view.modules).length);
  const identity = projectIdentity(root, graph);
  const banner = { command: MAP_REGENERATE_COMMAND, ...options.banner };

  const markdown = generateMarkdown(
    view.records,
    view.modules,
    stats,
    view.cycles,
    buildDependencyMatrix(view.records),
    identity,
    summaryRowsOf(stats, SUMMARY_LABELS),
  );
  const written: [string, string][] = [
    ["DEPENDENCY_GRAPH.md", withBanner(markdown, banner)],
    ["dependency-graph.yaml", generateYaml(core)],
    [
      "dependency-summary.compact.json",
      generateCompactSummary(view.records, view.modules, stats, view.cycles, identity),
    ],
  ];
  return written.map(([name, text]) => {
    const path = join(outDir, name);
    writeReport(path, text);
    return path;
  });
}
