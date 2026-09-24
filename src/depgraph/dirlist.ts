/**
 * Directory listing for every depgraph walk. All walks read folders through this module, so one
 * place decides the order, and a test can replace the reader.
 *
 * Fix F34: no walk follows a link (a symbolic link or a junction). A link can point to another
 * repository, to a missing path or to its own parent. Each link that a walk meets is recorded in
 * `linkLog`, and the run lists it.
 */
import { type Dirent, existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { compareCodeUnits, sortCodeUnits } from "../sort.ts";

/** The raw folder readers. A test may replace them, for example with a reversed order. */
export const readdirHook = {
  names: (dir: string): string[] => readdirSync(dir),
  entries: (dir: string): Dirent[] => readdirSync(dir, { withFileTypes: true }),
};

/** Returns the entry names of `dir` in code-unit order (fix F2). */
export function listNames(dir: string): string[] {
  return sortCodeUnits(readdirHook.names(dir));
}

/** Returns the entries of `dir` with their types, in code-unit order of their names (fix F2). */
export function listEntries(dir: string): Dirent[] {
  return [...readdirHook.entries(dir)].sort((a, b) => compareCodeUnits(a.name, b.name));
}

/** The absolute paths of the links that the walks of one run did not follow (fix F34). */
export const linkLog = { skipped: new Set<string>() };

/** True when `path` is a link (a symbolic link or a junction). Records the link in `linkLog`. */
export function isLink(path: string): boolean {
  let link: boolean;
  try {
    link = lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
  if (link) linkLog.skipped.add(path);
  return link;
}

/** True when the entry `entry` of `dir` is a link. Records the link in `linkLog`. */
export function isLinkEntry(dir: string, entry: Dirent): boolean {
  if (!entry.isSymbolicLink()) return false;
  linkLog.skipped.add(join(dir, entry.name));
  return true;
}

/** True when a walk can start at `dir`: it exists and it is not a link (a link is recorded). */
export function isWalkable(dir: string): boolean {
  return existsSync(dir) && !isLink(dir);
}
