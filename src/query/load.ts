/**
 * The input of `repo-tools query`: `dependency-graph.json` and `package-export-surfaces.json` in
 * the report folder (design section 3.5). A report that is missing, cannot be read, is not valid
 * JSON or has an unknown shape throws an error that says to run depgraph first. An error text
 * shows the root as `<root>`.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolveUnderRoot } from "../config.ts";
import type { CyclicComponents } from "../depgraph/types.ts";

/** One dependency edge of a file. The target field depends on the kind of the edge. */
export interface GraphEdge {
  /** An internal edge: the specifier as written in the source (not resolved). */
  file?: string;
  /** A Node built-in edge: the module name. */
  module?: string;
  /** An external or workspace edge: the package name. */
  package?: string;
  imports?: string[];
  reExport?: boolean;
  typeOnly?: boolean;
}

/** The fields of one file entry of the graph that the query reads. */
export interface GraphFileEntry {
  internalDependencies?: GraphEdge[];
  nodeDependencies?: GraphEdge[];
  workspaceDependencies?: GraphEdge[];
}

/** One entry point of the graph (`src/index.ts` and each `<package>/src/index.ts`). */
export interface GraphEntryPoint {
  file: string;
  type: string;
}

/** The fields of `dependency-graph.json` that the query reads. */
export interface QueryGraph {
  entryPoints: GraphEntryPoint[];
  /** Module name to (root-relative file path to its entry). */
  modules: Record<string, Record<string, GraphFileEntry>>;
  dependencyGraph: { cyclicComponents: CyclicComponents };
}

/** The two input reports of one query run. */
export interface QueryInput {
  graph: QueryGraph;
  /** Package key to its public export names (`package-export-surfaces.json`). */
  surfaces: Record<string, string[]>;
}

/** The text that ends each report error. */
const RUN_DEPGRAPH = "run repo-tools depgraph first";

/** True for a plain JSON object (not `null`, not an array). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when `value` has the fields of `dependency-graph.json` that the query reads. */
function isQueryGraph(value: unknown): value is QueryGraph {
  if (!isObject(value) || !Array.isArray(value.entryPoints) || !isObject(value.modules)) {
    return false;
  }
  if (!Object.values(value.modules).every(isObject)) return false;
  const graph = value.dependencyGraph;
  if (!isObject(graph) || !isObject(graph.cyclicComponents)) return false;
  const { runtime, typeOnly } = graph.cyclicComponents;
  return Array.isArray(runtime) && Array.isArray(typeOnly);
}

/** True when `value` is a `package-export-surfaces.json` object. */
function isSurfaces(value: unknown): value is { surfaces: Record<string, string[]> } {
  return (
    isObject(value) &&
    isObject(value.surfaces) &&
    Object.values(value.surfaces).every((names) => Array.isArray(names))
  );
}

/**
 * Reads and parses the report `name` of the report folder `out` (relative to the root). Throws
 * when the report does not exist, cannot be read or is not valid JSON.
 */
function readReport(root: string, out: string, name: string, what: string): unknown {
  const rel = `${out.replace(/\\/g, "/").replace(/\/+$/, "")}/${name}`;
  const shown = `the ${what} <root>/${rel}`;
  const path = resolveUnderRoot(root, rel);
  if (!existsSync(path)) throw new Error(`${shown} does not exist; ${RUN_DEPGRAPH}`);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`${shown} cannot be read; ${RUN_DEPGRAPH}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${shown} is not valid JSON; ${RUN_DEPGRAPH}`);
  }
}

/**
 * Loads the two input reports from the report folder `out` (relative to `root`). Throws when a
 * report is missing, cannot be read, is not valid JSON or has an unknown shape.
 */
export function loadQueryInput(root: string, out: string): QueryInput {
  const graphName = "dependency-graph.json";
  const graph = readReport(root, out, graphName, "dependency graph");
  if (!isQueryGraph(graph)) {
    throw new Error(`the dependency graph ${graphName} has an unknown shape; ${RUN_DEPGRAPH}`);
  }
  const surfacesName = "package-export-surfaces.json";
  const surfaces = readReport(root, out, surfacesName, "export-surfaces report");
  if (!isSurfaces(surfaces)) {
    throw new Error(
      `the export-surfaces report ${surfacesName} has an unknown shape; ${RUN_DEPGRAPH}`,
    );
  }
  return { graph, surfaces: surfaces.surfaces };
}
