/**
 * Simple-cycle enumeration over a plain edge map, shared by the graph (`findCycles`) and the
 * read-only queries (`cycles`). It imports no reader, resolver or grammar, so the query module can
 * use it and still never parse source.
 *
 * The source tool kept two copies of this algorithm, because its query module could not import
 * its graph module. One shared module removes that duplicate. The strongly connected components
 * (fix F26 of depgraph) are here too, so the core statistics and depgraph count them the same way.
 */
import { compareCodeUnits } from "../sort.ts";

/** The safety caps of the simple-cycle enumeration. */
export interface CycleLimits {
  maxCycles?: number;
  maxSteps?: number;
}

/** The simple cycles of a graph, the backtracking steps taken, and whether a cap stopped it. */
export interface CycleResult {
  cycles: string[][];
  steps: number;
  truncated: boolean;
}

/** The strongly connected component of `start` within the nodes `eligible`. */
export function sccContaining(
  start: string,
  eligible: ReadonlySet<string>,
  edges: ReadonlyMap<string, string[]>,
  reverseEdges: ReadonlyMap<string, string[]>,
): Set<string> {
  const forward = new Set([start]);
  let stack = [start];
  while (stack.length > 0) {
    const node = stack.pop() as string;
    for (const next of edges.get(node) ?? []) {
      if (eligible.has(next) && !forward.has(next)) {
        forward.add(next);
        stack.push(next);
      }
    }
  }
  const scc = new Set([start]);
  stack = [start];
  while (stack.length > 0) {
    const node = stack.pop() as string;
    for (const prev of reverseEdges.get(node) ?? []) {
      if (forward.has(prev) && !scc.has(prev)) {
        scc.add(prev);
        stack.push(prev);
      }
    }
  }
  return scc;
}

/**
 * Every simple cycle of `edges`, independent of the key order: canonical-rotation backtracking
 * restricted to the strongly connected component of each start node, in sorted node order.
 * `edges` maps each node to its distinct targets, all of them nodes of the map. Capped; a capped
 * result is a floor, and `truncated` says so.
 */
export function simpleCycles(
  edges: ReadonlyMap<string, string[]>,
  limits: CycleLimits = {},
): CycleResult {
  const maxCycles = limits.maxCycles ?? 5000;
  const maxSteps = limits.maxSteps ?? 2_000_000;
  const reverseEdges = new Map<string, string[]>();
  for (const [p, targets] of edges) {
    for (const t of targets) {
      const list = reverseEdges.get(t) ?? [];
      list.push(p);
      reverseEdges.set(t, list);
    }
  }
  const order = [...edges.keys()].sort(compareCodeUnits);
  const cycles: string[][] = [];
  let steps = 0;
  let truncated = false;
  for (let pos = 0; pos < order.length && !truncated; pos++) {
    const start = order[pos] as string;
    const eligible = new Set(order.slice(pos));
    const scc = sccContaining(start, eligible, edges, reverseEdges);
    if (scc.size < 2 && !(edges.get(start) ?? []).includes(start)) continue;
    const path = [start];
    const onPath = new Set([start]);
    const frames: [string, number][] = [[start, 0]];
    while (frames.length > 0) {
      const [node, idx] = frames[frames.length - 1] as [string, number];
      const deps = edges.get(node) ?? [];
      if (idx >= deps.length) {
        frames.pop();
        path.pop();
        onPath.delete(node);
        continue;
      }
      frames[frames.length - 1] = [node, idx + 1];
      const next = deps[idx] as string;
      if (!scc.has(next)) continue;
      steps += 1;
      if (steps > maxSteps) {
        truncated = true;
        break;
      }
      if (next === start) {
        cycles.push([...path, start]);
        if (cycles.length >= maxCycles) {
          truncated = true;
          break;
        }
      } else if (!onPath.has(next)) {
        onPath.add(next);
        path.push(next);
        frames.push([next, 0]);
      }
    }
  }
  return { cycles, steps, truncated };
}

/**
 * The strongly connected components of `graph` that hold a cycle: 2 or more nodes, or 1 node
 * with an edge to itself. Tarjan's algorithm with an explicit stack, so a deep graph does not
 * overflow the call stack. Each component is sorted in code-unit order.
 */
export function stronglyConnectedComponents(
  graph: ReadonlyMap<string, readonly string[]>,
): string[][] {
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
