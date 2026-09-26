/**
 * package-export-surfaces.json on the map engine's graph (design decision D5): per package, the
 * public export names.
 *
 * - TypeScript: depgraph's public-surface rules (fix F15) through the adapter. A root and each
 *   file that a chain of `export *` from a root reaches is public in full, and a named re-export
 *   from a public file makes that one name public.
 * - Python: each package (a folder with `__init__.py`) lists the names of its `__all__`, else the
 *   public names that its `__init__.py` defines.
 * - Rust: each library crate root (`lib.rs`) lists its `pub` items and the names of its plain
 *   `pub use` statements.
 * - C#: no rule gives a public surface, so the run writes no file (a "no" is explicit, D5).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { categorizeFiles, computePublicSurface } from "../depgraph/analysis.ts";
import {
  buildApiSurfaceReport,
  createTsResolver,
  extractExportDetails,
  resolveSurface,
} from "../depgraph/api-surface.ts";
import { generateSurfacesJson } from "../depgraph/reporters/surfaces.ts";
import { rootPackageEntries } from "../depgraph/roots.ts";
import { detectWorkspaces } from "../depgraph/workspaces.ts";
import { writeReport } from "../io.ts";
import { sortCodeUnits } from "../sort.ts";
import { toParsedFiles } from "./adapter.ts";
import type { RepoGraph } from "./schema.ts";

/**
 * Writes the `--api-surface` report to `outPath` (design decision D5). TypeScript uses depgraph's
 * per-export facts engine (it reads the source text from the entry file on, and lists every
 * `.ts`/`.tsx` source file of the graph). Python and Rust list the surface names of the entry
 * file, with a note: the facts of the TypeScript report (signatures, JSDoc tags) are not read for
 * them. C# throws with `NO_SURFACE_REASON`. Returns the number of surface symbols.
 */
export function emitApiSurface(
  graph: RepoGraph,
  root: string,
  outPath: string,
  entry: string,
  stabilityTags: readonly string[],
): number {
  if (graph.language === "typescript") {
    const load = (p: string): string | null => {
      try {
        return readFileSync(join(root, p), "utf8");
      } catch {
        return null;
      }
    };
    const opts = { stabilityTags };
    const surface = resolveSurface(
      entry,
      load,
      createTsResolver((p) => load(p) !== null),
      opts,
    );
    const files = [...graph.files.values()]
      .filter((n) => n.area === "src" && /\.tsx?$/.test(n.path))
      .map((n) => ({ path: n.path, exports: extractExportDetails(load(n.path) ?? "", opts) }));
    writeReport(
      outPath,
      JSON.stringify(buildApiSurfaceReport(surface, files, stabilityTags), null, 2),
    );
    return surface.symbols.length;
  }
  if (graph.language !== "python" && graph.language !== "rust") {
    throw new Error(
      NO_SURFACE_REASON[graph.language]?.replace("package-export-surfaces.json", "--api-surface") ??
        `--api-surface has no rule for ${graph.language}`,
    );
  }
  const node = graph.files.get(entry);
  if (!node)
    throw new Error(`the --api-entry file <root>/${entry} is not a source file of the census`);
  const kinds = node.exportKinds ?? {};
  const names = sortCodeUnits([
    ...new Set([...node.exports, ...(graph.language === "rust" ? (node.publicUses ?? []) : [])]),
  ]);
  const symbols = names.map((name) => ({ name, kind: kinds[name] ?? null, declaredIn: entry }));
  writeReport(
    outPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        language: graph.language,
        entry,
        summary: { symbols: symbols.length },
        symbols,
        note: graph.language === "python" ? PYTHON_NOTE : RUST_NOTE,
      },
      null,
      2,
    ),
  );
  return symbols.length;
}

/** Why a language gets no surface file: the text the run reports. */
export const NO_SURFACE_REASON: Readonly<Record<string, string>> = {
  csharp:
    "package-export-surfaces.json is not written for C#: a public type is public to every " +
    "assembly that references the project, and no file lists the API of a package.",
};

const PYTHON_NOTE =
  "Each key is a Python package (a folder with __init__.py). The names are the __all__ of its " +
  "__init__.py; without __all__, they are the public names that __init__.py defines. A name " +
  "that __init__.py only imports is not listed unless __all__ names it.";

const RUST_NOTE =
  "Each key is a library crate root (lib.rs). The names are its pub items and the names of its " +
  "plain pub use statements; a glob gives <path>::*. The items of a pub mod are not listed; the " +
  "mod name is. A binary root (main.rs, bin/) has no public API and is not listed.";

/** The folder part of a root-relative path. */
const dirOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")));

/** A surfaces object with its keys and names in code-unit order. */
function sortedSurfaces(map: Map<string, Iterable<string>>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of sortCodeUnits([...map.keys()])) {
    out[key] = sortCodeUnits([...new Set(map.get(key) ?? [])]);
  }
  return out;
}

/**
 * Writes package-export-surfaces.json into `outDir` and returns its path, or returns null for a
 * language with no surface rule (see `NO_SURFACE_REASON`).
 */
export function emitExportSurfaces(graph: RepoGraph, root: string, outDir: string): string | null {
  const path = join(outDir, "package-export-surfaces.json");
  if (graph.language === "typescript") {
    const records = toParsedFiles(graph, root);
    const workspaces = detectWorkspaces(root);
    const isMonorepo = workspaces.size > 0;
    const surface = computePublicSurface(
      records,
      root,
      workspaces,
      isMonorepo ? [] : rootPackageEntries(root),
    );
    writeReport(
      path,
      generateSurfacesJson(categorizeFiles(records, isMonorepo, workspaces), surface),
    );
    return path;
  }
  const map = new Map<string, string[]>();
  let note: string;
  if (graph.language === "python") {
    note = PYTHON_NOTE;
    for (const node of graph.files.values()) {
      if (node.area !== "src") continue;
      if (node.path !== "__init__.py" && !node.path.endsWith("/__init__.py")) continue;
      map.set(dirOf(node.path) || ".", node.exports);
    }
  } else if (graph.language === "rust") {
    note = RUST_NOTE;
    for (const rootFile of graph.roots) {
      if (rootFile !== "lib.rs" && !rootFile.endsWith("/lib.rs")) continue;
      const node = graph.files.get(rootFile);
      if (node) map.set(rootFile, [...node.exports, ...(node.publicUses ?? [])]);
    }
  } else {
    return null;
  }
  writeReport(path, JSON.stringify({ surfaces: sortedSurfaces(map), note }, null, 2));
  return path;
}
