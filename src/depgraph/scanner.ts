/**
 * Directory walks of the depgraph pipeline.
 *
 * Every walk lists folders through `dirlist.ts`, in code-unit order (fix F2). The graph
 * walk keeps `.d.ts` files. The census walks skip them. No walk follows a link (fix F34).
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { isLink, isLinkEntry, isWalkable, listEntries, listNames } from "./dirlist.ts";
import { relativePosix, srcDirOf } from "./paths.ts";
import type { WorkspacePackage } from "./types.ts";

/** Directory names that hold tests. Both spellings occur. */
export const TEST_DIR_NAMES = ["test", "tests"] as const;

/**
 * Directory names that are not source in a single-package repo without `src/`: dependency
 * trees, build output, docs, and the test and tool areas that the inventory counts apart.
 */
const NOT_SOURCE = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "docs",
  "tests",
  "test",
  "tools",
  "scripts",
  "scaffold",
  "examples",
]);

/**
 * Collects every `.ts` file under `dir` that is not a `.test.ts` or `.spec.ts` file. Keeps
 * `.d.ts` files. Skips `node_modules`. Returns absolute paths in listing order.
 */
export function getAllTsFiles(dir: string, files: string[] = []): string[] {
  if (!isWalkable(dir)) return files;
  for (const entry of listNames(dir)) {
    if (entry === "node_modules") continue;
    const fullPath = join(dir, entry);
    if (isLink(fullPath)) continue;
    if (statSync(fullPath).isDirectory()) {
      getAllTsFiles(fullPath, files);
    } else if (
      entry.endsWith(".ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".spec.ts")
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Collects the `.ts` source files under `dir`: no test file and no `.d.ts` file. */
export function getAllSourceTsFiles(dir: string, files: string[] = []): string[] {
  if (!isWalkable(dir)) return files;
  for (const entry of listNames(dir)) {
    if (entry === "node_modules") continue;
    const fullPath = join(dir, entry);
    if (isLink(fullPath)) continue;
    if (statSync(fullPath).isDirectory()) {
      getAllSourceTsFiles(fullPath, files);
    } else if (
      entry.endsWith(".ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".spec.ts") &&
      !entry.endsWith(".d.ts")
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Collects the `.test.ts` and `.spec.ts` files under `dir`. Skips `node_modules`. */
export function getAllTestFiles(dir: string, files: string[] = []): string[] {
  if (!isWalkable(dir)) return files;
  for (const entry of listNames(dir)) {
    if (entry === "node_modules") continue;
    const fullPath = join(dir, entry);
    if (isLink(fullPath)) continue;
    if (statSync(fullPath).isDirectory()) {
      getAllTestFiles(fullPath, files);
    } else if (entry.endsWith(".test.ts") || entry.endsWith(".spec.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Source roots of a single-package repo: `src/` when it exists. Otherwise each top-level
 * directory that holds TypeScript, except dot-directories and the names in `NOT_SOURCE`.
 * Returns absolute paths.
 */
export function resolveSourceDirs(root: string): string[] {
  const src = srcDirOf(root);
  if (existsSync(src)) return [src];
  const roots: string[] = [];
  for (const entry of listEntries(root)) {
    if (entry.name.startsWith(".") || NOT_SOURCE.has(entry.name)) continue;
    if (isLinkEntry(root, entry) || !entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    if (getAllTsFiles(dir).length > 0) roots.push(dir);
  }
  return roots;
}

/** True when a census walk skips the directory entry `name`. */
function censusSkips(name: string): boolean {
  return name === "node_modules" || name === "dist" || name.startsWith(".");
}

/**
 * The maximal repo walk: every `.ts` file except `.d.ts` under `root`. Skips `node_modules`,
 * `dist` and dot-directories. Returns root-relative POSIX paths, sorted by `Array#sort`.
 */
export function walkRepoTsFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of listEntries(dir)) {
      if (censusSkips(e.name) || isLinkEntry(dir, e)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts"))
        out.push(relativePosix(root, p));
    }
  };
  walk(root);
  return out.sort();
}

/** The root directories that the census walks after the workspace packages. */
const CENSUS_DIRS = [
  "tests",
  "test",
  "bench",
  "benchmarks",
  "tools",
  "examples",
  "docs",
  "scripts",
];

/**
 * The census file discovery: each workspace package directory (in single-package mode, each
 * source root of `resolveSourceDirs`, fix M1), the directories in `CENSUS_DIRS`, and the `.ts`
 * files at the root. Narrower than `walkRepoTsFiles` on purpose, so that the census self-check
 * finds a location that the census does not list.
 */
export function collectCensusFiles(
  root: string,
  workspaces: Map<string, WorkspacePackage>,
): string[] {
  const set = new Set<string>();
  const walk = (dir: string): void => {
    if (!isWalkable(dir)) return;
    for (const e of listEntries(dir)) {
      if (censusSkips(e.name) || isLinkEntry(dir, e)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) set.add(relativePosix(root, p));
    }
  };
  for (const [, ws] of workspaces) walk(join(root, ws.directory));
  if (workspaces.size === 0) for (const dir of resolveSourceDirs(root)) walk(dir);
  for (const d of CENSUS_DIRS) walk(join(root, d));
  for (const e of listEntries(root)) {
    if (isLinkEntry(root, e)) continue;
    if (e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) set.add(e.name);
  }
  return [...set];
}
