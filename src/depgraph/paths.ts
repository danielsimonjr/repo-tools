/**
 * Root, source, test and output paths. Every path that leaves this module for a report is POSIX
 * and relative to the root.
 */
import { join, relative } from "node:path";

/** The output directory, relative to the root. Lowercase, as git tracks it. */
export const OUTPUT_SUBDIR = "docs/architecture";

/** Replaces each backslash with a forward slash. */
export function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

/** Returns `path` relative to `root`, with forward slashes. */
export function relativePosix(root: string, path: string): string {
  return toPosix(relative(root, path));
}

/** Returns the absolute `src` directory of `root`. */
export function srcDirOf(root: string): string {
  return join(root, "src");
}

/** Returns the absolute output directory of `root`. */
export function outputDirOf(root: string): string {
  return join(root, "docs", "architecture");
}
