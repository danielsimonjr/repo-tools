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

/** The default skip list of folder names (design section 3.2, `--exclude`). */
export const DEFAULT_EXCLUDE: readonly string[] = [
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
];

/**
 * The folder names that every walk of the current run skips. The pipeline sets them from
 * `--exclude` and `--also-exclude` (D10a) and restores the default after the run.
 */
export const walkScope = { skip: new Set<string>(DEFAULT_EXCLUDE) };

/** Sets the skip list of the walks. With no argument, restores the default list. */
export function setWalkSkip(names: readonly string[] = DEFAULT_EXCLUDE): void {
  walkScope.skip = new Set(names);
}

/** True for a TypeScript input file name: `.ts` or `.tsx` (design section 3.2). */
export function isTsInput(name: string): boolean {
  return name.endsWith(".ts") || name.endsWith(".tsx");
}

/** True for a test file name: `.test.ts`, `.spec.ts`, `.test.tsx` or `.spec.tsx`. */
export function isTestInput(name: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(name);
}

/** True for a census file name: a TypeScript input that is not a `.d.ts` file. */
function isCensusInput(name: string): boolean {
  return isTsInput(name) && !name.endsWith(".d.ts");
}

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
 * Collects every `.ts` and `.tsx` file under `dir` that is not a test file. Keeps `.d.ts`
 * files. Skips the folders of the skip list. Returns absolute paths in listing order.
 */
export function getAllTsFiles(dir: string, files: string[] = []): string[] {
  if (!isWalkable(dir)) return files;
  for (const entry of listNames(dir)) {
    if (walkScope.skip.has(entry)) continue;
    const fullPath = join(dir, entry);
    if (isLink(fullPath)) continue;
    if (statSync(fullPath).isDirectory()) {
      getAllTsFiles(fullPath, files);
    } else if (isTsInput(entry) && !isTestInput(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Collects the `.ts` and `.tsx` source files under `dir`: no test file and no `.d.ts` file. */
export function getAllSourceTsFiles(dir: string, files: string[] = []): string[] {
  if (!isWalkable(dir)) return files;
  for (const entry of listNames(dir)) {
    if (walkScope.skip.has(entry)) continue;
    const fullPath = join(dir, entry);
    if (isLink(fullPath)) continue;
    if (statSync(fullPath).isDirectory()) {
      getAllSourceTsFiles(fullPath, files);
    } else if (isCensusInput(entry) && !isTestInput(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Collects the test files (`.test.ts(x)`, `.spec.ts(x)`) under `dir`. Skips the skip list. */
export function getAllTestFiles(dir: string, files: string[] = []): string[] {
  if (!isWalkable(dir)) return files;
  for (const entry of listNames(dir)) {
    if (walkScope.skip.has(entry)) continue;
    const fullPath = join(dir, entry);
    if (isLink(fullPath)) continue;
    if (statSync(fullPath).isDirectory()) {
      getAllTestFiles(fullPath, files);
    } else if (isTestInput(entry)) {
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
    if (walkScope.skip.has(entry.name)) continue;
    if (isLinkEntry(root, entry) || !entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    if (getAllTsFiles(dir).length > 0) roots.push(dir);
  }
  return roots;
}

/**
 * True for a root-relative POSIX folder that the census leaves out: a folder that a negated
 * workspace pattern excludes (fix F41).
 */
export type Excluded = (relDir: string) => boolean;

/** True when a census walk skips the directory entry `name`: the skip list and dot-folders. */
function censusSkips(name: string): boolean {
  return walkScope.skip.has(name) || name.startsWith(".");
}

/**
 * The maximal repo walk: every `.ts` and `.tsx` file except `.d.ts` under `root`. Skips the skip list and
 * dot-directories. Returns root-relative POSIX paths, sorted by `Array#sort`.
 */
export function walkRepoTsFiles(root: string, excluded: Excluded = () => false): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of listEntries(dir)) {
      if (censusSkips(e.name) || isLinkEntry(dir, e)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory() && excluded(relativePosix(root, p))) continue;
      if (e.isDirectory()) walk(p);
      else if (isCensusInput(e.name)) out.push(relativePosix(root, p));
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
 * source root in `sourceDirs`, by default those of `resolveSourceDirs`, fix M1), the directories in `CENSUS_DIRS`, and the `.ts`
 * and `.tsx` files at the root. Narrower than `walkRepoTsFiles` on purpose, so that the census self-check
 * finds a location that the census does not list.
 */
export function collectCensusFiles(
  root: string,
  workspaces: Map<string, WorkspacePackage>,
  excluded: Excluded = () => false,
  sourceDirs: readonly string[] = resolveSourceDirs(root),
): string[] {
  const set = new Set<string>();
  const walk = (dir: string): void => {
    if (!isWalkable(dir) || excluded(relativePosix(root, dir))) return;
    for (const e of listEntries(dir)) {
      if (censusSkips(e.name) || isLinkEntry(dir, e)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory() && excluded(relativePosix(root, p))) continue;
      if (e.isDirectory()) walk(p);
      else if (isCensusInput(e.name)) set.add(relativePosix(root, p));
    }
  };
  for (const [, ws] of workspaces) walk(join(root, ws.directory));
  if (workspaces.size === 0) for (const dir of sourceDirs) walk(dir);
  for (const d of CENSUS_DIRS) walk(join(root, d));
  for (const e of listEntries(root)) {
    if (isLinkEntry(root, e)) continue;
    if (e.isFile() && isCensusInput(e.name)) set.add(e.name);
  }
  return [...set];
}
