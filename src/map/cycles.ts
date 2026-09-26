/**
 * Simple-cycle enumeration over a plain edge map, shared by the graph (`findCycles`) and the
 * read-only queries (`cycles`). It imports no reader, resolver or grammar, so the query module can
 * use it and still never parse source.
 *
 * The source tool kept two copies of this algorithm, because its query module could not import
 * its graph module. One shared module removes that duplicate.
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
