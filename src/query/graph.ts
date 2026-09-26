/**
 * The edge model of `repo-tools query` on the core graph: the forward and the reverse file edges.
 * The core edges are resolved already (`file` is the root-relative target), so no specifier is
 * resolved here. Every function is pure. Every list sorts in code-unit order (fix F22).
 */
import { sortCodeUnits } from "../sort.ts";
import type { GraphFileEntry, QueryGraph } from "./load.ts";

/** `[root-relative file path, its graph entry]`. */
export type FilePair = [string, GraphFileEntry];

/** Returns each file of the graph with its entry, over every area, in graph order. */
export function fileEntriesOf(graph: Pick<QueryGraph, "modules">): FilePair[] {
  const pairs: FilePair[] = [];
  for (const files of Object.values(graph.modules)) {
    for (const [file, entry] of Object.entries(files)) pairs.push([file, entry]);
  }
  return pairs;
}

/** Returns file to the set of files that it imports: each internal edge whose target is a file. */
export function buildForward(
  fileEntries: readonly FilePair[],
  allFiles: ReadonlySet<string>,
): Map<string, Set<string>> {
  const forward = new Map<string, Set<string>>();
  for (const [file, entry] of fileEntries) {
    const targets = new Set<string>();
    for (const dep of entry.internalDependencies ?? []) {
      if (dep.file !== undefined && allFiles.has(dep.file)) targets.add(dep.file);
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
