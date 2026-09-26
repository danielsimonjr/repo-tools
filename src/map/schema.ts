/**
 * The graph schema of the map engine: the contract that every reader feeds and every report reads.
 * Ported from `repo_map/schema.py` of the architecture-docs skill (design note D1: the core graph
 * keeps repo_map's shape and the meaning of each metric, for every language).
 */

/** The version of the graph schema. Change it on any breaking field change. */
export const SCHEMA_VERSION = "2.0.0";

/** One internal dependency: the target file, the names imported, and whether it is type-only. */
export interface Dependency {
  file: string;
  imports: string[];
  typeOnly: boolean;
  /** True for an `export ... from` edge (not written to the graph JSON). */
  reExport?: boolean;
  /** The specifier as the source writes it (not written to the graph JSON). */
  specifier?: string;
}

/** One source file of the graph. */
export interface FileNode {
  path: string;
  area: string;
  disposition: string;
  loc: number;
  exports: string[];
  internal: Dependency[];
  external: string[];
  /** Runtime built-ins: Node built-ins, or the Python standard library. */
  nodeBuiltins: string[];
  /** Relative specifiers that resolve to no file: broken imports. */
  broken: string[];
  /** Alias specifiers (`@/x`, `~/x`) that the engine cannot expand yet. */
  aliases: string[];
  /** The kind of each export, from the reader (not written to the graph JSON). */
  exportKinds?: Record<string, string>;
  /** What the file re-exports, from the reader (not written to the graph JSON). */
  reExports?: string[];
  /** The local name of a named default export, from the reader (not written to the graph JSON). */
  defaultExportLocal?: string | null;
  /**
   * Each import of a package or a built-in, in source order, with the names it binds (not written
   * to the graph JSON).
   */
  packageImports?: { specifier: string; names: string[]; builtin: boolean }[];
}

/** The graph of one repository. */
export interface RepoGraph {
  name: string;
  /** The files, in census order. */
  files: Map<string, FileNode>;
  roots: string[];
  /** What the build could not determine: an honest "unknown", never a guess. */
  warnings: string[];
  /** The root folder of the build; null for a graph built by hand. */
  rootPath: string | null;
  language: string;
  /** The links that discovery did not follow, root-relative and sorted (design decision D4). */
  skippedLinks?: string[];
}

/** A new graph with the defaults of the Python dataclass. */
export function newRepoGraph(init: {
  name: string;
  files: Map<string, FileNode>;
  roots?: string[];
  warnings?: string[];
  rootPath?: string | null;
  language?: string;
}): RepoGraph {
  return {
    name: init.name,
    files: init.files,
    roots: init.roots ?? [],
    warnings: init.warnings ?? [],
    rootPath: init.rootPath ?? null,
    language: init.language ?? "typescript",
  };
}

/** One module entry of `dependency-graph.json`. */
export interface ModuleEntry {
  externalDependencies: string[];
  nodeDependencies: string[];
  internalDependencies: { file: string; imports: string[]; typeOnly: boolean }[];
  exports: string[];
}

/** The JSON shape that `toJson` gives (the artifacts add more fields to it). */
export interface GraphJson {
  metadata: {
    name: string;
    schemaVersion: string;
    language: string;
    totalFiles: number;
    totalModules: number;
    totalExports: number;
    [key: string]: unknown;
  };
  modules: Record<string, Record<string, ModuleEntry>>;
  statistics: Record<string, number | boolean>;
  reachability: {
    roots: string[];
    reachableCount: number;
    dormantCount: number;
    orphaned: string[];
    testOnly: string[];
  };
  [key: string]: unknown;
}

/** Python's `sorted` of a string list: code-point order (UTF-16 order for BMP text). */
const sortedStrings = (items: Iterable<string>): string[] =>
  [...items].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * The graph as JSON, in the shape of the Python tool. `modules` is keyed by area, then by file, in
 * census order. `totalTypeScriptFiles` is the historical name and `totalSourceFiles` the true one;
 * both carry the same value, because existing Verification blocks read both.
 */
export function toJson(graph: RepoGraph): GraphJson {
  const modules: Record<string, Record<string, ModuleEntry>> = {};
  let totalExports = 0;
  let totalLoc = 0;
  for (const [path, node] of graph.files) {
    const byArea = modules[node.area] ?? {};
    modules[node.area] = byArea;
    byArea[path] = {
      externalDependencies: sortedStrings(node.external),
      nodeDependencies: sortedStrings(node.nodeBuiltins),
      internalDependencies: node.internal.map((d) => ({
        file: d.file,
        imports: d.imports,
        typeOnly: d.typeOnly,
      })),
      exports: [...node.exports],
    };
    totalExports += node.exports.length;
    totalLoc += node.loc;
  }
  const totalModules = Object.keys(modules).length;
  return {
    metadata: {
      name: graph.name,
      schemaVersion: SCHEMA_VERSION,
      language: graph.language,
      totalFiles: graph.files.size,
      totalModules,
      totalExports,
    },
    modules,
    statistics: {
      totalTypeScriptFiles: graph.files.size,
      totalSourceFiles: graph.files.size,
      totalModules,
      totalLinesOfCode: totalLoc,
      totalExports,
    },
    reachability: {
      roots: [...graph.roots],
      reachableCount: 0,
      dormantCount: 0,
      orphaned: [],
      testOnly: [],
    },
  };
}
