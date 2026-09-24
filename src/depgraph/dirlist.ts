/**
 * Directory listing for every depgraph walk. All walks read folders through this module, so one
 * place decides the order, and a test can replace the reader.
 */
import { type Dirent, readdirSync } from "node:fs";
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
