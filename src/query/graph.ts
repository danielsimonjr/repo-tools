/**
 * The edge model of `repo-tools query`: the forward and the reverse file edges of the graph, and
 * the users of a symbol. Every function is pure. Every list sorts in code-unit order (fix F22).
 */
import { resolveCandidates } from "../depgraph/resolver.ts";
import { compareCodeUnits, sortCodeUnits } from "../sort.ts";
import type { GraphFileEntry, QueryGraph } from "./load.ts";

/** `[root-relative file path, its graph entry]`. */
export type FilePair = [string, GraphFileEntry];

/** Returns each file of the graph with its entry, in graph order. */
export function fileEntriesOf(graph: Pick<QueryGraph, "modules">): FilePair[] {
  const pairs: FilePair[] = [];
  for (const files of Object.values(graph.modules)) {
    for (const [file, entry] of Object.entries(files)) pairs.push([file, entry]);
  }
  return pairs;
}

/**
 * Resolves the relative specifier `spec` of the file `importer` to a file of `allFiles`, with the
 * candidate order of depgraph (fix F30). Returns null for a bare specifier and for a specifier
 * that no file of `allFiles` matches.
 */
export function resolveSpec(
  importer: string,
  spec: string,
  allFiles: ReadonlySet<string>,
): string | null {
  if (!spec.startsWith(".")) return null;
  return resolveCandidates(importer, spec).find((c) => allFiles.has(c)) ?? null;
}

/** Returns file to the set of files that it imports, from the resolved internal edges. */
export function buildForward(
  fileEntries: readonly FilePair[],
  allFiles: ReadonlySet<string>,
): Map<string, Set<string>> {
  const forward = new Map<string, Set<string>>();
  for (const [file, entry] of fileEntries) {
    const targets = new Set<string>();
    for (const dep of entry.internalDependencies ?? []) {
      if (dep.file === undefined) continue;
      const target = resolveSpec(file, dep.file, allFiles);
      if (target) targets.add(target);
    }
    forward.set(file, targets);
  }
  return forward;
}

/**
 * Inverts the forward edges: file to the sorted list of the files that import it. A file that no
 * file imports has no key. The keys sort in code-unit order.
 */
export function invert(
  forward: ReadonlyMap<string, ReadonlySet<string>>,
): Record<string, string[]> {
  const reverse = new Map<string, Set<string>>();
  for (const [file, targets] of forward) {
    for (const target of targets) {
      const importers = reverse.get(target) ?? new Set<string>();
      importers.add(file);
      reverse.set(target, importers);
    }
  }
  const out: Record<string, string[]> = {};
  for (const target of sortCodeUnits([...reverse.keys()])) {
    out[target] = sortCodeUnits([...(reverse.get(target) ?? [])]);
  }
  return out;
}

/** One file that imports a symbol, and where from: `internal` or the workspace package name. */
export interface SymbolUser {
  file: string;
  from: string;
}

/**
 * The files that import `symbol` through an internal or a workspace edge. Each (file, from) pair
 * is listed once, sorted by file and then by `from`.
 */
export function symbolUsers(symbol: string, fileEntries: readonly FilePair[]): SymbolUser[] {
  const seen = new Set<string>();
  const users: SymbolUser[] = [];
  const add = (file: string, from: string): void => {
    const key = `${file}\n${from}`;
    if (seen.has(key)) return;
    seen.add(key);
    users.push({ file, from });
  };
  for (const [file, entry] of fileEntries) {
    for (const dep of entry.internalDependencies ?? []) {
      if ((dep.imports ?? []).includes(symbol)) add(file, "internal");
    }
    for (const dep of entry.workspaceDependencies ?? []) {
      if ((dep.imports ?? []).includes(symbol)) add(file, dep.package ?? "workspace");
    }
  }
  return users.sort((a, b) => compareCodeUnits(a.file, b.file) || compareCodeUnits(a.from, b.from));
}
