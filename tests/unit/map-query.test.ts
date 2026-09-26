/**
 * The read-only queries over a written `dependency-graph.json`: `dependents`, `symbolUsers` and
 * `cycles`.
 *
 * Ported from the architecture-docs skill (`test_query.py`). Four adaptations, each deliberate:
 * the fixtures carry schema 2.0.0, so a 1.x graph is refused by the same major-version rule; a
 * warning is returned in the result, not raised through a warnings module; the cycle cap is a
 * parameter, not a patched constant; and the "never parses source" test is a transitive scan of
 * the static imports. The source test had to keep two copies of the cycle algorithm in step. Here
 * both callers share one module, and the test that compares them stays as a guard.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findCycles } from "../../src/map/graph.ts";
import { cycles, dependents, loadGraph, symbolUsers } from "../../src/map/query.ts";
import { type Dependency, type FileNode, newRepoGraph, toJson } from "../../src/map/schema.ts";
import { makeTempDir } from "./temp.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

type Dep = { file: string; imports: string[]; typeOnly: boolean };
type Modules = Record<string, Record<string, { internalDependencies: Dep[] }>>;

const dep = (file: string, imports: string[] = [], typeOnly = false): Dep => ({
  file,
  imports,
  typeOnly,
});

/** A graph document with the modules `modules`. */
const doc = (modules: Modules, schemaVersion: string | null = "2.0.0") => ({
  ...(schemaVersion === null ? {} : { metadata: { name: "d", schemaVersion } }),
  modules,
  statistics: {},
  reachability: { roots: [] },
});

/** Writes `data` to a new dependency-graph.json and returns its path. */
function graphFile(data: unknown): string {
  const dir = makeTempDir("map-query");
  made.push(dir);
  const p = join(dir, "dependency-graph.json");
  writeFileSync(p, JSON.stringify(data));
  return p;
}

const ABC = doc({
  src: {
    "src/a.ts": { internalDependencies: [dep("src/b.ts", ["B"])] },
    "src/c.ts": { internalDependencies: [dep("src/b.ts", ["B"], true)] },
    "src/b.ts": { internalDependencies: [] },
  },
});

describe("dependents and symbolUsers", () => {
  test("dependents lists the importers", () => {
    expect(dependents(loadGraph(graphFile(ABC)).data, "src/b.ts")).toEqual([
      "src/a.ts",
      "src/c.ts",
    ]);
  });

  test("symbolUsers finds the importers of a name", () => {
    expect(symbolUsers(loadGraph(graphFile(ABC)).data, "B")).toEqual(["src/a.ts", "src/c.ts"]);
  });

  test("dependents scans every area, not only src", () => {
    const data = doc({
      src: { "src/a.ts": { internalDependencies: [] } },
      tests: { "tests/a.test.ts": { internalDependencies: [dep("src/a.ts")] } },
    });
    expect(dependents(loadGraph(graphFile(data)).data, "src/a.ts")).toEqual(["tests/a.test.ts"]);
  });

  test("symbolUsers scans every area, not only src", () => {
    const data = doc({
      src: { "src/a.ts": { internalDependencies: [] } },
      tools: { "tools/gen.ts": { internalDependencies: [dep("src/a.ts", ["Thing"])] } },
    });
    expect(symbolUsers(loadGraph(graphFile(data)).data, "Thing")).toEqual(["tools/gen.ts"]);
  });

  test("dependents of an unknown file throws; it does not return an empty list", () => {
    const { data } = loadGraph(graphFile(ABC));
    expect(() => dependents(data, "src/does-not-exist.ts")).toThrow(/not a file in this graph/);
  });

  test("dependents of a known file with no importers is an empty list", () => {
    const data = doc({ src: { "src/lonely.ts": { internalDependencies: [] } } });
    expect(dependents(data, "src/lonely.ts")).toEqual([]);
  });

  test("symbolUsers with no match is an empty list, not an error", () => {
    const data = doc({ src: { "src/a.ts": { internalDependencies: [] } } });
    expect(symbolUsers(data, "NoSuchSymbol")).toEqual([]);
  });

  test("a hand-built document with no modules key throws", () => {
    expect(() => symbolUsers({ metadata: {} }, "B")).toThrow(/no 'modules' key/);
  });
});

describe("loadGraph", () => {
  test("a file with no modules key throws", () => {
    const p = graphFile({ metadata: { schemaVersion: "2.0.0" } });
    expect(() => loadGraph(p)).toThrow(/no 'modules' key/);
  });

  test("an incompatible major schema version throws", () => {
    const p = graphFile(doc({ src: { "src/a.ts": { internalDependencies: [] } } }, "99.0.0"));
    expect(() => loadGraph(p)).toThrow(/not compatible/);
  });

  test("a 1.x graph is refused by the same rule (the engine writes 2.0.0)", () => {
    const p = graphFile(doc({ src: { "src/a.ts": { internalDependencies: [] } } }, "1.0.0"));
    expect(() => loadGraph(p)).toThrow(/not compatible/);
  });

  test("a missing schema version gives a warning, not an error", () => {
    const p = graphFile(doc({ src: { "src/a.ts": { internalDependencies: [] } } }, null));
    const { warnings } = loadGraph(p);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("schemaVersion is missing");
  });

  test("a current graph loads with no warning", () => {
    expect(loadGraph(graphFile(ABC)).warnings).toEqual([]);
  });
});

describe("the query module never parses source", () => {
  /** The relative modules that `file` imports, transitively. */
  function importClosure(file: string, seen = new Set<string>()): Set<string> {
    if (seen.has(file)) return seen;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+"(\.[^"]+)"/gmsu)) {
      importClosure(resolve(dirname(file), m[1] as string), seen);
    }
    for (const m of text.matchAll(/\bimport\(\s*"(\.[^"]+)"/gu)) {
      importClosure(resolve(dirname(file), m[1] as string), seen);
    }
    return seen;
  }

  test("no parser, discovery, resolver, grammar or graph module is reachable from it", () => {
    const closure = [...importClosure(resolve(import.meta.dir, "../../src/map/query.ts"))];
    const names = closure.map((p) => p.replace(/\\/g, "/").split("/").pop());
    for (const forbidden of [
      "parsing.ts",
      "discovery.ts",
      "resolvers.ts",
      "grammars.ts",
      "graph.ts",
    ]) {
      expect(names).not.toContain(forbidden);
    }
    // A positive control: the scan does see the modules query.ts really imports.
    expect(names).toContain("cycles.ts");
  });
});

/** a <-> b (with a duplicate a -> b edge), and an acyclic leg c -> a. */
const CYCLE = doc({
  src: {
    "src/a.ts": {
      internalDependencies: [dep("src/b.ts", ["B"]), dep("src/b.ts", ["B2"], true)],
    },
    "src/b.ts": { internalDependencies: [dep("src/a.ts", ["A"])] },
    "src/c.ts": { internalDependencies: [dep("src/a.ts", ["A"])] },
  },
});

/** a <-> b, a -> b -> c -> a, and a -> b -> c -> d -> a: three cycles through one node. */
function sharedScc(order?: string[]) {
  const files: Record<string, { internalDependencies: Dep[] }> = {
    "src/a.ts": { internalDependencies: [dep("src/b.ts")] },
    "src/b.ts": { internalDependencies: [dep("src/a.ts"), dep("src/c.ts")] },
    "src/c.ts": { internalDependencies: [dep("src/a.ts"), dep("src/d.ts")] },
    "src/d.ts": { internalDependencies: [dep("src/a.ts")] },
  };
  const ordered = order ? Object.fromEntries(order.map((p) => [p, files[p]])) : files;
  return doc({ src: ordered as Record<string, { internalDependencies: Dep[] }> });
}

const signatures = (found: string[][]): Set<string> =>
  new Set(found.map((c) => [...new Set(c)].sort().join("|")));

describe("cycles", () => {
  test("finds a two-node cycle exactly once (a duplicate edge counts once)", () => {
    const found = cycles(CYCLE).cycles;
    expect(found).toHaveLength(1);
    expect(new Set(found[0])).toEqual(new Set(["src/a.ts", "src/b.ts"]));
  });

  test("is empty on a DAG", () => {
    const data = doc({
      src: {
        "src/a.ts": { internalDependencies: [dep("src/b.ts")] },
        "src/b.ts": { internalDependencies: [] },
      },
    });
    expect(cycles(data).cycles).toEqual([]);
  });

  test("does not depend on the key order of the JSON", () => {
    const reordered = doc({
      src: Object.fromEntries(Object.entries(CYCLE.modules.src ?? {}).reverse()),
    });
    expect(cycles(reordered).cycles).toEqual(cycles(CYCLE).cycles);
  });

  test("finds all three cycles in a shared-node SCC", () => {
    const found = cycles(sharedScc()).cycles;
    expect(found).toHaveLength(3);
    expect(signatures(found)).toEqual(
      new Set([
        "src/a.ts|src/b.ts",
        "src/a.ts|src/b.ts|src/c.ts",
        "src/a.ts|src/b.ts|src/c.ts|src/d.ts",
      ]),
    );
  });

  test("is order-independent under shuffling", () => {
    const paths = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"];
    const baseline = signatures(cycles(sharedScc(paths)).cycles);
    // Every rotation and every reversal: a deterministic set of eight orders.
    for (let r = 0; r < paths.length; r++) {
      const rotated = [...paths.slice(r), ...paths.slice(0, r)];
      for (const order of [rotated, [...rotated].reverse()]) {
        const found = signatures(cycles(sharedScc(order)).cycles);
        expect(found).toEqual(baseline);
        expect(found.size).toBe(3);
      }
    }
  });

  test("a cap stops it early, and the result says so with a warning", () => {
    const result = cycles(sharedScc(), { maxCycles: 1 });
    expect(result.cycles).toHaveLength(1);
    expect(result.truncated).toBe(true);
    expect(result.warning).toContain("FLOOR");
  });

  test("an uncapped result carries no warning", () => {
    const result = cycles(sharedScc());
    expect(result.truncated).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  test("ignores a large acyclic fan-out hub (bounded steps, not wall-clock)", () => {
    const files: Record<string, { internalDependencies: Dep[] }> = {
      aaa_hub: { internalDependencies: [] },
    };
    let level = ["aaa_hub"];
    for (let d = 0; d < 5; d++) {
      const next: string[] = [];
      level.forEach((node, i) => {
        const children = Array.from({ length: 6 }, (_, c) => `aab_${d}_${i}_${c}`);
        files[node] = { internalDependencies: children.map((c) => dep(c)) };
        next.push(...children);
      });
      level = next;
    }
    for (const leaf of level) files[leaf] = { internalDependencies: [] };
    files.zzz_a = { internalDependencies: [dep("zzz_b")] };
    files.zzz_b = { internalDependencies: [dep("zzz_a")] };

    const result = cycles(doc({ src: files }));
    expect(result.cycles).toHaveLength(1);
    expect(new Set(result.cycles[0])).toEqual(new Set(["zzz_a", "zzz_b"]));
    expect(result.steps).toBeLessThanOrEqual(20);
  });

  test("gives the same cycles as the graph's findCycles, through the real toJson", () => {
    const edges: Record<string, string[]> = {
      "a.ts": ["b.ts"],
      "b.ts": ["a.ts", "c.ts"],
      "c.ts": ["a.ts", "d.ts"],
      "d.ts": ["a.ts"],
    };
    const graph = newRepoGraph({ name: "t", files: new Map(), roots: [] });
    for (const [p, targets] of Object.entries(edges)) {
      const node: FileNode = {
        path: p,
        area: "src",
        disposition: "reachable",
        loc: 1,
        exports: [],
        internal: targets.map((t): Dependency => ({ file: t, imports: [], typeOnly: false })),
        external: [],
        nodeBuiltins: [],
        broken: [],
        aliases: [],
      };
      graph.files.set(p, node);
    }
    const fromGraph = signatures(findCycles(graph).cycles);
    const fromQuery = signatures(cycles(JSON.parse(JSON.stringify(toJson(graph)))).cycles);
    expect(fromGraph.size).toBe(3);
    expect(fromQuery).toEqual(fromGraph);
  });
});
