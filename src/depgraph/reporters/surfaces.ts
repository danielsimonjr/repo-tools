/**
 * package-export-surfaces.json: per package, the union of the named exports of its module
 * files.
 *
 * Names sort in code-unit order (fix F22). Port notes: every named export counts, internal ones
 * included (fix F15), and the file holds a date (fix F1).
 */
import { compareCodeUnits } from "../../sort.ts";
import type { ModuleMap } from "../types.ts";

/** The package key of a module key: `packages/<x>` for a `packages/` path, else the first part. */
export function packageKeyOf(moduleKey: string): string {
  return moduleKey.startsWith("packages/")
    ? moduleKey.split("/").slice(0, 2).join("/")
    : (moduleKey.split("/")[0] ?? "");
}

/** Package key to its sorted export names. Package keys sort by `Array#sort`. */
export function buildPackageExportSurfaces(modules: ModuleMap): Record<string, string[]> {
  const surfaceSets: Record<string, Set<string>> = {};
  for (const [mkey, filesObj] of Object.entries(modules)) {
    const pkg = packageKeyOf(mkey);
    const set = surfaceSets[pkg] ?? new Set<string>();
    surfaceSets[pkg] = set;
    for (const f of Object.values(filesObj)) for (const n of f.exports.named) set.add(n);
  }
  const surfaces: Record<string, string[]> = {};
  for (const pkg of Object.keys(surfaceSets).sort()) {
    surfaces[pkg] = [...(surfaceSets[pkg] ?? [])].sort((a, b) => compareCodeUnits(a, b));
  }
  return surfaces;
}

/** The package-export-surfaces.json text (2-space JSON, no trailing newline). */
export function generateSurfacesJson(modules: ModuleMap): string {
  return JSON.stringify({ surfaces: buildPackageExportSurfaces(modules) }, null, 2);
}
