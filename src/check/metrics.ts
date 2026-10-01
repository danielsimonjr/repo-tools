/**
 * The metrics of `repo-tools check` (design section 15): the claim names that a document can
 * hold, with their values from a fresh graph of the repository.
 *
 * The values come from the same emitters that `repo-tools map` writes its reports with, into a
 * scratch folder that the run removes. So a metric can never disagree with the report of the same
 * run. The namespace is the `metadata` and `statistics` of `dependency-graph.json`, the
 * `totalFiles` of `file-inventory.json`, and the `summary` of `duplicate-symbols.json` and
 * `unused-analysis.json`, merged in that order. A value that is not a string, a number or a
 * boolean (a table of tags, for example) is not a metric.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emitDependencyGraph,
  emitDuplicateSymbols,
  emitFileInventory,
  emitUnusedAnalysis,
} from "../map/artifacts.ts";
import { graphOf } from "../map/command.ts";
import type { Measured, MetricValue } from "./verify.ts";

/** The options of `collectMetrics`. */
export interface MetricsOptions {
  /** The duplicate allowlist file. Default: `<root>/docs/architecture/duplicate-allowlist.json`. */
  allowlistPath?: string;
  /** The folder that holds the scratch folder. Default: the temp folder of the system. */
  scratchBase?: string;
}

/** A parsed JSON report. */
type Report = Record<string, unknown>;

const readReport = (path: string): Report => JSON.parse(readFileSync(path, "utf8")) as Report;

/** The object at `key` of `report`; throws when it is not an object. */
function section(report: Report, key: string): Report {
  const value = report[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`the report has no '${key}' object`);
  }
  return value as Report;
}

/** Adds each scalar entry of `source` to `into`. */
function addScalars(into: Map<string, MetricValue>, source: Report): void {
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      into.set(name, value);
    }
  }
}

/**
 * Builds the graph of `root` and returns its metrics and its warnings. The warnings are read
 * after all four emitters ran, because an emitter can add one (a package-derivation note). Throws
 * the error of `repo-tools map` when the repository has no source file or a language that the
 * engine cannot read.
 */
export async function collectMetrics(
  root: string,
  options: MetricsOptions = {},
): Promise<Measured> {
  const graph = await graphOf(root);
  const scratch = mkdtempSync(join(options.scratchBase ?? tmpdir(), "repo-tools-check-"));
  try {
    const dep = readReport(emitDependencyGraph(graph, scratch));
    const inventory = readReport(emitFileInventory(graph, scratch));
    const duplicates = readReport(
      emitDuplicateSymbols(
        graph,
        scratch,
        options.allowlistPath === undefined ? {} : { allowlistPath: options.allowlistPath },
      ),
    );
    const unused = readReport(emitUnusedAnalysis(graph, scratch));
    const metrics = new Map<string, MetricValue>();
    addScalars(metrics, section(dep, "metadata"));
    addScalars(metrics, section(dep, "statistics"));
    addScalars(metrics, { totalFiles: inventory.totalFiles });
    addScalars(metrics, section(duplicates, "summary"));
    addScalars(metrics, section(unused, "summary"));
    return { metrics, warnings: [...graph.warnings] };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
