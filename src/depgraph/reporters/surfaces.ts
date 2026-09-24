/**
 * package-export-surfaces.json: per package, the union of the public export names of its module
 * files.
 *
 * Fix F15: only the public surface counts. A name is public when its file is public in full (a
 * package root, or a file that a chain of `export *` from a root reaches), or when a named
 * re-export from a public file names it. An export that only relative imports inside the package
 * use is internal, and the report does not list it.
 *
 * Names sort in code-unit order (fix F22).
 */
import { compareCodeUnits } from "../../sort.ts";
import type { ModuleMap, PublicSurface } from "../types.ts";

/** The package key of a module key: `packages/<x>` for a `packages/` path, else the first part. */
export function packageKeyOf(moduleKey: string): string {
  return moduleKey.startsWith("packages/")
    ? moduleKey.split("/").slice(0, 2).join("/")
    : (moduleKey.split("/")[0] ?? "");
}

/** The parts of the public surface that decide if one export name is public. */
export type SurfaceFilter = Pick<PublicSurface, "publicWildcardFiles" | "publicNamed">;

/**
 * Package key to its sorted public export names (fix F15). A package with no public name keeps
 * its key with an empty list. Package keys sort by `Array#sort`.
 */
export function buildPackageExportSurfaces(
  modules: ModuleMap,
  surface: SurfaceFilter,
): Record<string, string[]> {
  const surfaceSets: Record<string, Set<string>> = {};
  for (const [mkey, filesObj] of Object.entries(modules)) {
    const pkg = packageKeyOf(mkey);
    const set = surfaceSets[pkg] ?? new Set<string>();
    surfaceSets[pkg] = set;
    for (const f of Object.values(filesObj)) {
      const wholeFile = surface.publicWildcardFiles.has(f.path);
      for (const n of f.exports.named) {
        if (wholeFile || surface.publicNamed.has(`${f.path}::${n}`)) set.add(n);
      }
    }
  }
  const surfaces: Record<string, string[]> = {};
  for (const pkg of Object.keys(surfaceSets).sort()) {
    surfaces[pkg] = [...(surfaceSets[pkg] ?? [])].sort((a, b) => compareCodeUnits(a, b));
  }
  return surfaces;
}

/** The package-export-surfaces.json text (2-space JSON, no trailing newline). */
export function generateSurfacesJson(modules: ModuleMap, surface: SurfaceFilter): string {
  return JSON.stringify({ surfaces: buildPackageExportSurfaces(modules, surface) }, null, 2);
}
