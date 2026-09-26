/**
 * package-export-surfaces.json on the map engine's graph (design decision D5): per package, the
 * public export names.
 *
 * TypeScript uses depgraph's public-surface rules (fix F15) through the adapter: a root and each
 * file that a chain of `export *` from a root reaches is public in full, and a named re-export
 * from a public file makes that one name public.
 */
import { join } from "node:path";
import { categorizeFiles, computePublicSurface } from "../depgraph/analysis.ts";
import { generateSurfacesJson } from "../depgraph/reporters/surfaces.ts";
import { rootPackageEntries } from "../depgraph/roots.ts";
import { detectWorkspaces } from "../depgraph/workspaces.ts";
import { writeReport } from "../io.ts";
import { toParsedFiles } from "./adapter.ts";
import type { RepoGraph } from "./schema.ts";

/** Writes package-export-surfaces.json into `outDir` and returns its path. */
export function emitExportSurfaces(graph: RepoGraph, root: string, outDir: string): string {
  const records = toParsedFiles(graph, root);
  const workspaces = detectWorkspaces(root);
  const isMonorepo = workspaces.size > 0;
  const surface = computePublicSurface(
    records,
    root,
    workspaces,
    isMonorepo ? [] : rootPackageEntries(root),
  );
  const path = join(outDir, "package-export-surfaces.json");
  writeReport(
    path,
    generateSurfacesJson(categorizeFiles(records, isMonorepo, workspaces), surface),
  );
  return path;
}
