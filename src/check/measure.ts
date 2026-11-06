/**
 * The metrics of the four reports of `repo-tools map` that hold them. `repo-tools check` reads the
 * reports that it writes in a scratch folder; `repo-tools map` reads the reports that it wrote.
 */
import { readFileSync } from "node:fs";
import type { Measured, MetricValue } from "./verify.ts";

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

/** The paths of the four reports that hold the metrics. */
export interface MetricReports {
  dependencyGraph: string;
  fileInventory: string;
  duplicateSymbols: string;
  unusedAnalysis: string;
}

/**
 * The metrics of the four reports at `paths`, and the warnings of the graph build. `check` reads
 * the reports that it writes in a scratch folder. `map` reads the reports that it wrote.
 */
export function measureReports(paths: MetricReports, warnings: readonly string[]): Measured {
  const dep = readReport(paths.dependencyGraph);
  const metrics = new Map<string, MetricValue>();
  addScalars(metrics, section(dep, "metadata"));
  addScalars(metrics, section(dep, "statistics"));
  addScalars(metrics, { totalFiles: readReport(paths.fileInventory).totalFiles });
  addScalars(metrics, section(readReport(paths.duplicateSymbols), "summary"));
  addScalars(metrics, section(readReport(paths.unusedAnalysis), "summary"));
  return { metrics, warnings: [...warnings] };
}
