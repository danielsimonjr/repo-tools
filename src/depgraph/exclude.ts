/**
 * The skip list of a source walk, as a value the caller passes. Nothing here is module state:
 * two walks in one process cannot change each other's skip list.
 */
import { statSync } from "node:fs";
import { join } from "node:path";
import { isLink, isWalkable, listNames } from "./dirlist.ts";

/** The default skip list of folder names (design section 3.2). */
export const DEFAULT_EXCLUDE: readonly string[] = [
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
];

/** Directory names that hold tests. Both spellings occur. */
export const TEST_DIR_NAMES = ["test", "tests"] as const;

/** True for a source file name: `.ts` or `.tsx`, not a `.d.ts` file and not a test file. */
function isSourceInput(name: string): boolean {
  return (
    (name.endsWith(".ts") || name.endsWith(".tsx")) &&
    !name.endsWith(".d.ts") &&
    !/\.(test|spec)\.tsx?$/.test(name)
  );
}

/**
 * The source files under `dir`, as absolute paths in listing order. `skip` is the folder names
 * this walk does not enter. A link is not followed.
 */
export function sourceTsFilesUnder(
  dir: string,
  skip: ReadonlySet<string> = new Set(DEFAULT_EXCLUDE),
  files: string[] = [],
): string[] {
  if (!isWalkable(dir)) return files;
  for (const entry of listNames(dir)) {
    if (skip.has(entry)) continue;
    const fullPath = join(dir, entry);
    if (isLink(fullPath)) continue;
    if (statSync(fullPath).isDirectory()) sourceTsFilesUnder(fullPath, skip, files);
    else if (isSourceInput(entry)) files.push(fullPath);
  }
  return files;
}
