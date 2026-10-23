/**
 * The output of `repo-tools clones` (design section 17.7): the summary text, `inventory.jsonl` and
 * `clones.json`. Every function here is pure; the command writes the files.
 */

import type { Detection } from "./detect.ts";
import type { ClonesConfig } from "./settings.ts";
import type { Unit } from "./units.ts";

/** The counts that the summary shows besides the units. */
export interface RunStats {
  /** The source files that the run read. */
  files: number;
  /** The files whose tree holds an error node. */
  parseErrors: number;
}

/** The fields of a unit that the inventory shows, in output order. */
function inventoryRecord(unit: Unit, id: number): Record<string, unknown> {
  return {
    id,
    file: unit.file,
    name: unit.name,
    container: unit.container,
    kind: unit.kind,
    exported: unit.exported,
    startLine: unit.startLine,
    endLine: unit.endLine,
    loc: unit.loc,
    params: unit.params,
    async: unit.async,
    nodes: unit.nodes,
    doc: unit.doc,
    exactHash: unit.exactHash,
    textHash: unit.textHash,
  };
}

/** `inventory.jsonl`: one JSON object on each line, one line for each unit, in unit order. */
export function inventoryJsonl(units: readonly Unit[]): string {
  return units.map((unit, id) => `${JSON.stringify(inventoryRecord(unit, id))}\n`).join("");
}

/** A JSON array with one compact item on each line. */
function listJson(items: readonly unknown[]): string {
  if (items.length === 0) return "[]";
  return `[\n${items.map((item) => `    ${JSON.stringify(item)}`).join(",\n")}\n  ]`;
}

/** `clones.json`: the settings of the run and the three result lists. */
export function clonesJson(config: ClonesConfig, detection: Detection): string {
  const { out: _out, ...params } = config;
  return [
    "{",
    `  "params": ${JSON.stringify(params)},`,
    `  "exactGroups": ${listJson(detection.exactGroups)},`,
    `  "textGroups": ${listJson(detection.textGroups)},`,
    `  "near": ${listJson(detection.near)}`,
    "}",
    "",
  ].join("\n");
}

/**
 * The bands of `jStruct` that the summary counts: a label, the low end and the high end (open).
 * The bands only group the output. They do not decide which pair is a near pair.
 */
const SUMMARY_BANDS: ReadonlyArray<readonly [string, number, number]> = [
  ["0.9 or more", 0.9, Number.POSITIVE_INFINITY],
  ["0.8 to 0.9", 0.8, 0.9],
  ["0.7 to 0.8", 0.7, 0.8],
  ["0.6 to 0.7", 0.6, 0.7],
  ["below 0.6 (containment)", 0, 0.6],
];

/** The folder key of a path for the summary: its first two folders, or `.` for the root. */
function folderOf(file: string): string {
  const parts = file.split("/").slice(0, -1);
  return parts.length === 0 ? "." : parts.slice(0, 2).join("/");
}

/** The value at fraction `p` of the sorted list `sorted`. */
function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

/** The summary text: the counts of the run, one line for each fact. */
export function summaryText(
  config: ClonesConfig,
  stats: RunStats,
  units: readonly Unit[],
  detection: Detection,
): string {
  const sizes = units.map((u) => u.nodes).sort((a, b) => a - b);
  const inGroups = detection.exactGroups.reduce((sum, group) => sum + group.length, 0);
  const bands = SUMMARY_BANDS.map(
    ([label, lo, hi]) =>
      `${label}: ${detection.near.filter((p) => p.jStruct >= lo && p.jStruct < hi).length}`,
  );
  const byFolder = new Map<string, number>();
  for (const unit of units) {
    const key = folderOf(unit.file);
    byFolder.set(key, (byFolder.get(key) ?? 0) + 1);
  }
  const folders = [...byFolder.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, count]) => `${key}=${count}`)
    .join(" ");
  const lines = [
    `files=${stats.files} parseErrors=${stats.parseErrors} units(minNodes=${config.minNodes})=${units.length}`,
    `nodes p50=${percentile(sizes, 0.5)} p90=${percentile(sizes, 0.9)} p99=${percentile(sizes, 0.99)} max=${sizes[sizes.length - 1] ?? 0}`,
    `exact groups=${detection.exactGroups.length} (units in them=${inGroups}) text-identical groups=${detection.textGroups.length}`,
    `near pairs=${detection.near.length} by jStruct: ${bands.join(", ")}`,
    `units by folder: ${folders}`,
  ];
  return `${lines.join("\n")}\n`;
}
