/**
 * The file inventory (census): every `.ts` file of the census walk with its area and its
 * disposition, and the census self-check against the maximal repo walk.
 *
 * The rows sort in code-unit order (fix F22). Fix M1: the inventory and the self-check run in
 * both modes, and an orphan fails the self-check only with `--strict-orphans`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compareCodeUnits } from "../sort.ts";
import { collectCensusFiles, walkRepoTsFiles } from "./scanner.ts";
import type { WorkspacePackage } from "./types.ts";
import { negatedWorkspaceFolders } from "./workspaces.ts";

/** What a census file is. */
export type FileDisposition =
  | "reachable"
  | "build-entry"
  | "test-only"
  | "orphan"
  | "test"
  | "tool"
  | "config"
  | "example"
  | "bench";

/** Where a census file is, by its path only. */
export type FileArea = "src" | "tests" | "bench" | "tools" | "config" | "examples" | "docs";

/** One census row. */
export interface FileInventoryRow {
  file: string;
  package: string;
  area: FileArea;
  disposition: FileDisposition;
  loc: number;
}

/** The census and its counts. */
export interface FileInventory {
  totalFiles: number;
  byDisposition: Record<string, number>;
  byArea: Record<string, number>;
  byPackage: Record<string, number>;
  files: FileInventoryRow[];
  /** The links that the walks did not follow, root-relative, in code-unit order (fix F34). */
  skippedLinks: string[];
}

/**
 * The area of a root-relative path. The order of the checks matters: `tools/` and `scripts/`
 * first, then `*.config.ts`, then tests, bench, examples and docs. Any other path is `src`.
 */
export function classifyArea(rel: string): FileArea {
  if (/(^|\/)(tools|scripts)\//.test(rel)) return "tools";
  if (/\.config(\.[\w-]+)?\.[cm]?ts$/.test(rel)) return "config";
  if (/\.(test|spec)\.ts$/.test(rel) || /(^|\/)tests?\//.test(rel)) return "tests";
  if (/(^|\/)bench(marks)?\//.test(rel)) return "bench";
  if (/^examples\//.test(rel)) return "examples";
  if (/^docs\//.test(rel)) return "docs";
  return "src";
}

/** The workspace package name of a root-relative path, or `(root)`. */
export function packageOf(rel: string, workspaces: Map<string, WorkspacePackage>): string {
  for (const [name, ws] of workspaces) {
    if (rel.startsWith(`${ws.directory}/`)) return name;
  }
  return "(root)";
}

/** The line count of a root-relative file (LF count plus one), or 0 when it is unreadable. */
export function countLoc(root: string, relPath: string): number {
  try {
    return readFileSync(join(root, relPath), "utf-8").split("\n").length;
  } catch {
    return 0;
  }
}

/**
 * Builds the census. A `src` file is `build-entry` (in `roots`), else `reachable`, else
 * `test-only` (in `testReachable`), else `orphan`. Other areas map to `test`, `tool`, `config`
 * or `example`.
 */
export function buildFileInventory(
  root: string,
  workspaces: Map<string, WorkspacePackage>,
  roots: Set<string>,
  reachable: Set<string>,
  testReachable: Set<string>,
): FileInventory {
  const rows: FileInventoryRow[] = [];
  for (const rel of collectCensusFiles(root, workspaces, negatedWorkspaceFolders(root))) {
    const area = classifyArea(rel);
    let disposition: FileDisposition;
    if (area === "src") {
      disposition = roots.has(rel)
        ? "build-entry"
        : reachable.has(rel)
          ? "reachable"
          : testReachable.has(rel)
            ? "test-only"
            : "orphan";
    } else if (area === "tests") {
      disposition = "test";
    } else if (area === "tools") {
      disposition = "tool";
    } else if (area === "config") {
      disposition = "config";
    } else if (area === "bench") {
      disposition = "bench";
    } else {
      disposition = "example";
    }
    rows.push({
      file: rel,
      package: packageOf(rel, workspaces),
      area,
      disposition,
      loc: countLoc(root, rel),
    });
  }
  rows.sort((a, b) => compareCodeUnits(a.file, b.file));

  const byDisposition: Record<string, number> = {
    reachable: 0,
    "build-entry": 0,
    "test-only": 0,
    orphan: 0,
    test: 0,
    tool: 0,
    config: 0,
    example: 0,
    bench: 0,
  };
  const byArea: Record<string, number> = {};
  const byPackage: Record<string, number> = {};
  for (const r of rows) {
    byDisposition[r.disposition] = (byDisposition[r.disposition] ?? 0) + 1;
    byArea[r.area] = (byArea[r.area] ?? 0) + 1;
    byPackage[r.package] = (byPackage[r.package] ?? 0) + 1;
  }
  return {
    totalFiles: rows.length,
    byDisposition,
    byArea,
    byPackage,
    files: rows,
    skippedLinks: [],
  };
}

/** The orphan files of a census, sorted. */
function orphansOf(inventory: FileInventory): string[] {
  return inventory.files
    .filter((f) => f.disposition === "orphan")
    .map((f) => f.file)
    .sort();
}

/** The orphan block of the self-check text. */
function orphanText(orphans: string[]): string {
  let msg = `  ${orphans.length} ORPHAN file(s) — a src file reachable from no root and no test. Each is a\n`;
  msg += "  build/worker/subpath root the tool did not detect (wire it / seed it — see\n";
  msg += "  the tsup.config / exports / bin root handling), or dead\n";
  msg += "  code to delete:\n";
  msg += `${orphans.map((f) => `    ! ${f}`).join("\n")}\n`;
  return msg;
}

/**
 * The census self-check. Returns null when the census equals the maximal repo walk and, with
 * `strictOrphans`, holds no orphan. Otherwise returns the failure text: files on disk but not
 * in the census, census entries not on disk, and (with `strictOrphans`) orphans.
 */
export function censusFailure(
  root: string,
  inventory: FileInventory,
  strictOrphans = false,
): string | null {
  const onDisk = new Set(walkRepoTsFiles(root, negatedWorkspaceFolders(root)));
  const census = new Set(inventory.files.map((f) => f.file));
  const missingFromCensus = [...onDisk].filter((f) => !census.has(f)).sort();
  const missingFromDisk = [...census].filter((f) => !onDisk.has(f)).sort();
  const orphans = strictOrphans ? orphansOf(inventory) : [];
  if (missingFromCensus.length === 0 && missingFromDisk.length === 0 && orphans.length === 0) {
    return null;
  }
  let msg = "FILE CENSUS SELF-CHECK FAILED.\n";
  if (missingFromCensus.length > 0) {
    msg += `  ${missingFromCensus.length} file(s) on disk but ABSENT from the census (scoping/discovery gap — teach the census to enumerate this location):\n`;
    msg += `${missingFromCensus.map((f) => `    + ${f}`).join("\n")}\n`;
  }
  if (missingFromDisk.length > 0) {
    msg += `  ${missingFromDisk.length} file(s) in the census but MISSING on disk (stale entry — regenerate with \`repo-tools depgraph\`):\n`;
    msg += `${missingFromDisk.map((f) => `    - ${f}`).join("\n")}\n`;
  }
  if (orphans.length > 0) msg += orphanText(orphans);
  return msg;
}

/**
 * The orphan warning of a self-check without `--strict-orphans` (fix M1), or null when the
 * census holds no orphan.
 */
export function censusOrphanWarning(inventory: FileInventory): string | null {
  const orphans = orphansOf(inventory);
  return orphans.length > 0 ? `Warning: file census:\n${orphanText(orphans)}` : null;
}

/** The pass line of the census self-check, with the orphan count. */
export function censusPassLine(inventory: FileInventory): string {
  const n = orphansOf(inventory).length;
  return `File census self-check passed: ${inventory.totalFiles} files == maximal repo walk (independent), ${n} orphan${n === 1 ? "" : "s"}.`;
}

/**
 * `--check-census`: checks the committed `file-inventory.json` in `outputDir` against a fresh
 * maximal walk, without a graph scan. Returns null on a pass, else the failure text.
 */
export function checkCensusNoRegen(
  root: string,
  outputDir: string,
  strictOrphans = false,
): string | null {
  const invPath = join(outputDir, "file-inventory.json");
  if (!existsSync(invPath)) {
    return "file-census check: file-inventory.json not found — run `repo-tools depgraph` first to generate it.\n";
  }
  const inventory = JSON.parse(readFileSync(invPath, "utf-8")) as FileInventory;
  return censusFailure(root, inventory, strictOrphans);
}
