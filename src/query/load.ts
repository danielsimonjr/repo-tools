/**
 * The input of `repo-tools query` (design decision D8): the core `dependency-graph.json` of
 * `repo-tools map` and, for `is-public`, `package-export-surfaces.json`, both in the report
 * folder. A report that is missing, cannot be read, is not valid JSON or has an unknown shape
 * throws an error that says to run map first. A graph of another major schema version (a 1.x
 * graph) is refused. An error text shows the root as `<root>`.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolveUnderRoot } from "../config.ts";
import { type GraphDocument, loadGraph } from "../map/query.ts";

/** One internal edge of the core graph: its resolved target and the names it imports. */
export interface GraphEdge {
  file?: string;
  imports?: string[];
  typeOnly?: boolean;
}

/** The fields of one file entry of the core graph that the query reads. */
export interface GraphFileEntry {
  internalDependencies?: GraphEdge[];
  /** The Node built-ins (or the Python standard library modules) that the file imports. */
  nodeDependencies?: string[];
}

/** The core graph: `modules` maps each area to its files. */
export interface QueryGraph {
  metadata?: { language?: unknown; schemaVersion?: unknown };
  modules: Record<string, Record<string, GraphFileEntry>>;
}

/** The input of one query run. */
export interface QueryInput {
  graph: QueryGraph;
  /** The language of the graph (`typescript`, `python`, `csharp` or `rust`). */
  language: string;
  /** The report folder, relative to the root, for the reports that load on demand. */
  root: string;
  out: string;
  /** Warnings of the load (for example a missing schema version). */
  warnings: string[];
}

/** The text that ends each report error. */
const RUN_MAP = "run repo-tools map first";

/** The root-relative path of the report `name` in the folder `out`. */
function reportRel(out: string, name: string): string {
  return `${out.replace(/\\/g, "/").replace(/\/+$/, "")}/${name}`;
}

/**
 * Loads the core graph from the report folder `out` (relative to `root`). Throws when it is
 * missing, cannot be read, is not valid JSON, has no `modules`, or has another major schema
 * version.
 */
export function loadQueryInput(root: string, out: string): QueryInput {
  const rel = reportRel(out, "dependency-graph.json");
  const shown = `the dependency graph <root>/${rel}`;
  const path = resolveUnderRoot(root, rel);
  if (!existsSync(path)) throw new Error(`${shown} does not exist; ${RUN_MAP}`);
  let loaded: { data: GraphDocument; warnings: string[] };
  try {
    loaded = loadGraph(path);
  } catch (err) {
    // A read error (a folder in place of the file, no permission) carries an errno code.
    if (typeof (err as { code?: unknown }).code === "string") {
      throw new Error(`${shown} cannot be read; ${RUN_MAP}`);
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not compatible")) {
      throw new Error(`${shown} is not a 2.x graph (a 1.x report?); ${RUN_MAP}`);
    }
    if (message.includes("'modules'")) throw new Error(`${shown} has an unknown shape; ${RUN_MAP}`);
    throw new Error(`${shown} is not valid JSON; ${RUN_MAP}`);
  }
  const graph = loaded.data as QueryGraph;
  const language = typeof graph.metadata?.language === "string" ? graph.metadata.language : "";
  return {
    graph,
    language,
    root,
    out,
    warnings: loaded.warnings.map((w) => w.replace(path, `<root>/${rel}`)),
  };
}

/** True when `value` is a `package-export-surfaces.json` object. */
function isSurfaces(value: unknown): value is { surfaces: Record<string, string[]> } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const surfaces = (value as { surfaces?: unknown }).surfaces;
  return (
    typeof surfaces === "object" &&
    surfaces !== null &&
    !Array.isArray(surfaces) &&
    Object.values(surfaces).every((names) => Array.isArray(names))
  );
}

/**
 * Loads `package-export-surfaces.json` of the report folder. Throws when it is missing (a C#
 * repository has none), cannot be read, is not valid JSON or has an unknown shape.
 */
export function loadSurfaces(input: QueryInput): Record<string, string[]> {
  const rel = reportRel(input.out, "package-export-surfaces.json");
  const shown = `the export-surfaces report <root>/${rel}`;
  const path = resolveUnderRoot(input.root, rel);
  if (!existsSync(path)) {
    const why = input.language === "csharp" ? " (map writes none for C#)" : `; ${RUN_MAP}`;
    throw new Error(`${shown} does not exist${why}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${shown} is not valid JSON; ${RUN_MAP}`);
  }
  if (!isSurfaces(parsed)) throw new Error(`${shown} has an unknown shape; ${RUN_MAP}`);
  return parsed.surfaces;
}
