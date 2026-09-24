/**
 * Cycles of the relative-import graph, by strongly connected component (fix F26).
 *
 * A depth-first search that lists the cycles it meets can miss a cycle, and the cycles that it
 * lists depend on the order of the files. A graph can also hold an exponential number of
 * elementary cycles. This module reports each strongly connected component (SCC) once, in
 * linear time (Tarjan's algorithm), with one representative cycle.
 *
 * - A runtime component is an SCC of the graph of runtime edges.
 * - A type-only component is an SCC of the graph of all edges that is not identical to a runtime
 *   SCC.
 * - A component has 2 or more files, or 1 file that imports itself.
 * - Members sort in code-unit order (fix F22). Components sort by their smallest member.
 * - The representative cycle is the shortest cycle through the smallest member. A breadth-first
 *   search finds it, with neighbours in code-unit order, over runtime edges for a runtime
 *   component and over all edges for a type-only component. The cycle starts and ends with the
 *   smallest member.
 */
import { compareCodeUnits } from "../sort.ts";
import { resolvePath } from "./resolver.ts";
import type { CyclicComponent, CyclicComponents, ParsedFile } from "./types.ts";

/** Node to its neighbours: no duplicates, in code-unit order. */
type Graph = Map<string, string[]>;

/** The runtime graph and the graph of all edges of `files`. Nodes are the file paths. */
function buildGraphs(files: readonly ParsedFile[]): { runtime: Graph; all: Graph } {
  const nodes = files.map((f) => f.path).sort(compareCodeUnits);
  const known = new Set(nodes);
  const runtimeSets = new Map<string, Set<string>>(nodes.map((n) => [n, new Set<string>()]));
  const allSets = new Map<string, Set<string>>(nodes.map((n) => [n, new Set<string>()]));
  for (const file of files) {
    for (const dep of file.internalDependencies) {
      const target = resolvePath(file.path, dep.file);
      if (!known.has(target)) continue;
      allSets.get(file.path)?.add(target);
      if (!dep.typeOnly) runtimeSets.get(file.path)?.add(target);
    }
  }
  const toGraph = (sets: Map<string, Set<string>>): Graph =>
    new Map(nodes.map((n) => [n, [...(sets.get(n) ?? [])].sort(compareCodeUnits)]));
  return { runtime: toGraph(runtimeSets), all: toGraph(allSets) };
}

/**
 * The strongly connected components of `graph` that hold a cycle: 2 or more nodes, or 1 node
 * with an edge to itself. Tarjan's algorithm with an explicit stack, so a deep graph does not
 * overflow the call stack. Each component is sorted in code-unit order.
 */
export function stronglyConnectedComponents(graph: Graph): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const visit = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);
  };
  for (const start of graph.keys()) {
    if (index.has(start)) continue;
    visit(start);
    const work: { node: string; next: number }[] = [{ node: start, next: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1] as { node: string; next: number };
      const neighbours = graph.get(frame.node) ?? [];
      if (frame.next < neighbours.length) {
        const next = neighbours[frame.next++] as string;
        if (!index.has(next)) {
          visit(next);
          work.push({ node: next, next: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node) ?? 0, index.get(next) ?? 0));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) {
        low.set(parent.node, Math.min(low.get(parent.node) ?? 0, low.get(frame.node) ?? 0));
      }
      if (low.get(frame.node) !== index.get(frame.node)) continue;
      const component: string[] = [];
      let member: string | undefined;
      do {
        member = stack.pop() as string;
        onStack.delete(member);
        component.push(member);
      } while (member !== frame.node);
      const selfLoop = (graph.get(frame.node) ?? []).includes(frame.node);
      if (component.length > 1 || selfLoop) components.push(component.sort(compareCodeUnits));
    }
  }
  return components;
}

/**
 * The shortest cycle through `start` inside `members`, found by a breadth-first search over
 * `graph` with neighbours in code-unit order. The cycle starts and ends with `start`.
 */
export function shortestCycleThrough(
  graph: Graph,
  members: readonly string[],
  start: string,
): string[] {
  const inside = new Set(members);
  const parent = new Map<string, string>();
  const queue = [start];
  const seen = new Set([start]);
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head] as string;
    for (const next of graph.get(node) ?? []) {
      if (!inside.has(next)) continue;
      if (next === start) {
        const path = [node];
        while (path[0] !== start) path.unshift(parent.get(path[0] as string) as string);
        return [...path, start];
      }
      if (seen.has(next)) continue;
      seen.add(next);
      parent.set(next, node);
      queue.push(next);
    }
  }
  return [start];
}

/** The components of `graph` with their representative cycles, sorted by smallest member. */
function componentsOf(graph: Graph, sccs: readonly string[][]): CyclicComponent[] {
  return sccs
    .map((members) => ({
      members,
      cycle: shortestCycleThrough(graph, members, members[0] as string),
    }))
    .sort((a, b) => compareCodeUnits(a.members[0] ?? "", b.members[0] ?? ""));
}

/**
 * The cyclic components of the relative-import graph of `files` (fix F26). The result does not
 * depend on the order of `files` or of their edges.
 */
export function detectCyclicComponents(files: readonly ParsedFile[]): CyclicComponents {
  const graphs = buildGraphs(files);
  const runtimeSccs = stronglyConnectedComponents(graphs.runtime);
  const runtimeKeys = new Set(runtimeSccs.map((c) => c.join("\n")));
  const typeOnlySccs = stronglyConnectedComponents(graphs.all).filter(
    (c) => !runtimeKeys.has(c.join("\n")),
  );
  return {
    runtime: componentsOf(graphs.runtime, runtimeSccs),
    typeOnly: componentsOf(graphs.all, typeOnlySccs),
  };
}

/** The number of distinct files in `components`. */
export function filesInCycles(components: readonly CyclicComponent[]): number {
  return new Set(components.flatMap((c) => c.members)).size;
}
