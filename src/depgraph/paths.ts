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

/**
 * True when the root-relative POSIX `path` is a `src/index.ts` entry: the path is
 * `src/index.ts`, or it ends in the segments `/src/index.ts` (fix F31). `mysrc/index.ts` and
 * `src/mysrc/index.ts` are not entries.
 */
export function isSrcIndex(path: string): boolean {
  return path === "src/index.ts" || path.endsWith("/src/index.ts");
}

/** Returns `path` relative to `root`, with forward slashes. */
export function relativePosix(root: string, path: string): string {
  return toPosix(relative(root, path));
}

/**
 * Returns `text` with each occurrence of `root`, in its native and its POSIX form, replaced by
 * `<root>` (design criterion 4: no absolute path on standard error).
 */
export function maskRoot(text: string, root: string): string {
  return text.split(root).join("<root>").split(toPosix(root)).join("<root>");
}

/** Returns the absolute `src` directory of `root`. */
export function srcDirOf(root: string): string {
  return join(root, "src");
}

/** Returns the absolute output directory of `root`. */
export function outputDirOf(root: string): string {
  return join(root, "docs", "architecture");
}
