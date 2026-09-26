/**
 * Read-only queries over a written `dependency-graph.json`. The module reads the graph JSON and
 * nothing else: it imports no reader, resolver, grammar or graph module, so it needs no
 * per-language variant. Ported from the architecture-docs skill (`repo_map/query.py`).
 *
 * Each query takes the document that `loadGraph` returns, or a hand-built document of the same
 * shape. A query that cannot answer throws; "no match" is an empty list. The two must never look
 * the same.
 */
import { readFileSync } from "node:fs";
import { compareCodeUnits } from "../sort.ts";
import { type CycleLimits, type CycleResult, simpleCycles } from "./cycles.ts";
import { SCHEMA_VERSION } from "./schema.ts";

const SUPPORTED_SCHEMA_MAJOR = Number(SCHEMA_VERSION.split(".")[0]);

interface DependencyEntry {
  file?: string;
  imports?: string[];
}
interface ModuleEntry {
  internalDependencies?: DependencyEntry[];
}
/** A graph document: `modules` maps each area to its files. */
export interface GraphDocument {
  metadata?: { schemaVersion?: unknown };
  modules?: Record<string, Record<string, ModuleEntry>>;
  [key: string]: unknown;
}

/** A loaded graph and the warnings that loading it gave. */
export interface LoadedGraph {
  data: GraphDocument;
  warnings: string[];
}

/**
 * Reads a graph JSON and checks that the queries can answer against it. A file with no `modules`
 * key throws. A different major schema version throws. A missing schema version gives a warning.
 */
export function loadGraph(graphPath: string): LoadedGraph {
  const data = JSON.parse(readFileSync(graphPath, "utf8")) as GraphDocument;
  if (data === null || typeof data !== "object" || !("modules" in data)) {
    throw new Error(
      `${graphPath}: no 'modules' key found -- this is not a map dependency-graph.json, or it is ` +
        "from an incompatible schema. Cannot answer any query against it.",
    );
  }
  const warnings: string[] = [];
  const version = data.metadata?.schemaVersion;
  if (version === undefined || version === null) {
    warnings.push(
      `${graphPath}: metadata.schemaVersion is missing -- proceeding as if it matches this ` +
        `module's schema (${SCHEMA_VERSION}), but an older or newer artifact whose shape has ` +
        "actually changed may produce a silently wrong answer.",
    );
  } else if (Number(String(version).split(".")[0]) !== SUPPORTED_SCHEMA_MAJOR) {
    throw new Error(
      `${graphPath}: schemaVersion '${String(version)}' is not compatible with this module's ` +
        `supported major version ${SUPPORTED_SCHEMA_MAJOR} (SCHEMA_VERSION='${SCHEMA_VERSION}'). ` +
        "Refusing to query a schema this module was not written against rather than risk a " +
        "silently wrong answer.",
    );
  }
  return { data, warnings };
}

/** Every [path, entry] across every area. Throws when `modules` is missing. */
function entries(data: GraphDocument): [string, ModuleEntry][] {
  if (!data.modules) {
    throw new Error(
      "graph data has no 'modules' key -- cannot answer; pass data returned by loadGraph(), or " +
        "a document with the same shape",
    );
  }
  return Object.values(data.modules).flatMap((area) => Object.entries(area));
}

const sorted = (items: string[]): string[] => items.sort(compareCodeUnits);

/**
 * The files that directly import `file`, across every area, sorted. Throws when `file` is not a
 * path of this graph: an unknown path must not look like a known file with no importers.
 */
export function dependents(data: GraphDocument, file: string): string[] {
  const all = entries(data);
  if (!all.some(([path]) => path === file)) {
    throw new Error(
      `'${file}' is not a file in this graph -- cannot answer 'dependents' for an unknown path. ` +
        "Check the path is repo-relative POSIX and this is the graph for the right repo/checkout. " +
        "(A file that IS known but genuinely has no importers returns [] normally, not an error.)",
    );
  }
  return sorted(
    all
      .filter(([, entry]) => (entry.internalDependencies ?? []).some((d) => d.file === file))
      .map(([path]) => path),
  );
}

/**
 * The files whose internal imports name `symbol`, across every area, sorted. No closed set of
 * symbols exists to check against, so an empty result is a real "no match".
 */
export function symbolUsers(data: GraphDocument, symbol: string): string[] {
  return sorted(
    entries(data)
      .filter(([, entry]) =>
        (entry.internalDependencies ?? []).some((d) => (d.imports ?? []).includes(symbol)),
      )
      .map(([path]) => path),
  );
}

/** The simple cycles, with a warning when a cap stopped the enumeration. */
export interface QueryCycleResult extends CycleResult {
  warning?: string;
}

/** Every simple cycle of the internal dependencies across every area, independent of key order. */
export function cycles(data: GraphDocument, limits: CycleLimits = {}): QueryCycleResult {
  const all = entries(data);
  const known = new Set(all.map(([path]) => path));
  const edges = new Map<string, string[]>();
  for (const [path, entry] of all) {
    const targets = (entry.internalDependencies ?? [])
      .map((d) => d.file)
      .filter((f): f is string => f !== undefined && known.has(f));
    edges.set(path, [...new Set(targets)]);
  }
  const result: QueryCycleResult = simpleCycles(edges, limits);
  if (result.truncated) {
    result.warning =
      `cycles: simple-cycle enumeration hit its safety cap (found ${result.cycles.length} ` +
      `cycles / ${result.steps} backtracking steps) and stopped early -- the returned list is a ` +
      "FLOOR (at least this many simple cycles exist), not an exact total.";
  }
  return result;
}
