/**
 * Fix F26: cycles are reported by strongly connected component (SCC), not by the cycles that a
 * depth-first search meets. A runtime component is an SCC of the runtime edges. A type-only
 * component is an SCC of all edges that is not identical to a runtime SCC. Each component lists
 * its members in code-unit order and one representative cycle: the shortest cycle through its
 * smallest member.
 */
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { detectCyclicComponents } from "../../src/depgraph/cycles.ts";
import { readdirHook } from "../../src/depgraph/dirlist.ts";
import type { ParsedFile } from "../../src/depgraph/types.ts";
import { RUNTIME_IMPORTS, TYPE_IMPORTS } from "./dynamic-imports.ts";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);
const normal = { ...readdirHook };
afterEach(() => Object.assign(readdirHook, normal));

/** The cycle fields of `dependency-graph.json`. */
interface CycleJson {
  dependencyGraph: {
    cyclicComponents: {
      runtime: { members: string[]; cycle: string[] }[];
      typeOnly: { members: string[]; cycle: string[] }[];
    };
  };
  statistics: Record<string, number>;
}

/** A parsed file with runtime edges to `runtime` and type-only edges to `types`. */
function node(path: string, runtime: string[], types: string[] = []): ParsedFile {
  const edge = (to: string, typeOnly: boolean) => ({
    file: `./${to}.js`,
    imports: [],
    typeOnly,
  });
  return {
    path: `src/${path}.ts`,
    name: path,
    externalDependencies: [],
    nodeDependencies: [],
    internalDependencies: [
      ...runtime.map((t) => edge(t, false)),
      ...types.map((t) => edge(t, true)),
    ],
    workspaceDependencies: [],
    packageName: null,
    exports: {
      named: [],
      default: null,
      types: [],
      interfaces: [],
      enums: [],
      classes: [],
      functions: [],
      constants: [],
      reExported: [],
    },
    description: null,
  };
}

/** The complete directed graph on `names`: every file imports every other file at run time. */
function complete(names: string[]): ParsedFile[] {
  return names.map((n) =>
    node(
      n,
      names.filter((m) => m !== n),
    ),
  );
}

/** The source of a file that imports every name in `targets` at run time. */
function importsAll(targets: string[]): string {
  return `/** Node. */\n${targets.map((t) => `import './${t}.js';`).join("\n")}\nexport const x = 1;\n`;
}

/** A tree with two runtime components, one type-only component and one self-import. */
const MANY_CYCLES: Record<string, string> = {
  "package.json": '{ "name": "f26", "version": "1.0.0" }',
  "src/index.ts": importsAll(["m1", "k1", "t1", "self"]),
  "src/m1.ts": importsAll(["m2"]),
  "src/m2.ts": importsAll(["m3", "m1"]),
  "src/m3.ts": importsAll(["m1"]),
  "src/k1.ts": importsAll(["k2", "k3"]),
  "src/k2.ts": importsAll(["k1", "k3"]),
  "src/k3.ts": importsAll(["k1", "k2"]),
  "src/t1.ts": "/** T1. */\nimport type { T } from './t2.js';\nexport type U = T;\n",
  "src/t2.ts": "/** T2. */\nimport type { U } from './t1.js';\nexport type T = U | 1;\n",
  "src/self.ts": "/** Self. */\nimport './self.js';\nexport const s = 1;\n",
};

describe("F26: cycles by strongly connected component", () => {
  test("components: members in code-unit order, sorted by smallest member, shortest cycle", async () => {
    const root = makeTree(MANY_CYCLES);
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const json = JSON.parse(result.report("dependency-graph.json")) as CycleJson;
    expect(json.dependencyGraph.cyclicComponents).toEqual({
      runtime: [
        {
          members: ["src/k1.ts", "src/k2.ts", "src/k3.ts"],
          cycle: ["src/k1.ts", "src/k2.ts", "src/k1.ts"],
        },
        {
          members: ["src/m1.ts", "src/m2.ts", "src/m3.ts"],
          cycle: ["src/m1.ts", "src/m2.ts", "src/m1.ts"],
        },
        { members: ["src/self.ts"], cycle: ["src/self.ts", "src/self.ts"] },
      ],
      typeOnly: [
        { members: ["src/t1.ts", "src/t2.ts"], cycle: ["src/t1.ts", "src/t2.ts", "src/t1.ts"] },
      ],
    });
    const s = json.statistics;
    expect([
      s.runtimeCyclicComponents,
      s.typeOnlyCyclicComponents,
      s.runtimeFilesInCycles,
      s.typeOnlyFilesInCycles,
    ]).toEqual([3, 1, 7, 2]);
    for (const old of ["runtimeCircularDeps", "typeOnlyCircularDeps"]) {
      expect(s).not.toHaveProperty(old);
    }
    expect(result.report("dependency-graph.json")).not.toContain("circularDependencies");
    expect(result.report("dependency-graph.yaml")).toContain("cyclicComponents:");
    const compact = JSON.parse(result.report("dependency-summary.compact.json")) as {
      c: Record<string, unknown>;
    };
    expect(compact.c).toEqual({
      rtc: 3,
      toc: 1,
      rtf: 7,
      tof: 2,
      rtp: ["k1→k2→k1", "m1→m2→m1", "self→self"],
    });
    expect(result.stdout).toContain("Found 4 cyclic components (3 runtime, 1 type-only)\n");
    const md = result.report("DEPENDENCY_GRAPH.md");
    expect(md).toContain("**4 cyclic components detected**");
    expect(md).toContain("- src/k1.ts -> src/k2.ts -> src/k1.ts\n  - Members (3): ");
    expect(md).toContain("| Runtime Cyclic Components | 3 |");
    expect(md).toContain("| Files in Type-only Cycles | 2 |");
  });

  test("a reversed folder listing gives the same bytes", async () => {
    const forward = await runDepgraph(makeTree(MANY_CYCLES));
    readdirHook.names = (dir) => normal.names(dir).reverse();
    readdirHook.entries = (dir) => normal.entries(dir).reverse();
    const reversedRoot = makeTree(MANY_CYCLES);
    const reversed = await runDepgraph(reversedRoot);
    expect(reversed.stdout).toBe(forward.stdout);
    for (const name of readdirSync(join(reversedRoot, "docs/architecture"))) {
      expect({ name, text: reversed.report(name) }).toEqual({ name, text: forward.report(name) });
    }
  });

  test("the result does not depend on the order of the files or of their edges", () => {
    const files = [
      node("a", ["b"], ["c"]),
      node("b", ["a", "d"]),
      node("c", ["b"]),
      node("d", ["e"]),
      node("e", ["d", "b"]),
    ];
    const reversed = [...files]
      .reverse()
      .map((f) => ({ ...f, internalDependencies: [...f.internalDependencies].reverse() }));
    expect(detectCyclicComponents(reversed)).toEqual(detectCyclicComponents(files));
  });

  test("completeness: a type-only cycle through a finished node is found", async () => {
    // Runtime a <-> b; type-only a -> c -> b. A depth-first search from a finishes b through
    // a -> b -> a, then meets b again from c and reports nothing: it misses a -> c -> b -> a.
    const root = makeTree({
      "package.json": '{ "name": "f26", "version": "1.0.0" }',
      "src/index.ts": "/** Entry. */\nexport { a } from './a.js';\n",
      "src/a.ts":
        "/** A. */\nimport { b } from './b.js';\nimport type { C } from './c.js';\n" +
        "export const a: C | number = b;\n",
      "src/b.ts": "/** B. */\nimport { a } from './a.js';\nexport const b = 1;\nexport { a };\n",
      "src/c.ts": "/** C. */\nimport type { B } from './b.js';\nexport type C = B;\n",
    });
    const result = await runDepgraph(root);
    expect(result.stdout).toContain("(1 runtime, 1 type-only)");
    const json = JSON.parse(result.report("dependency-graph.json")) as CycleJson;
    expect(json.dependencyGraph.cyclicComponents.typeOnly).toEqual([
      {
        members: ["src/a.ts", "src/b.ts", "src/c.ts"],
        cycle: ["src/a.ts", "src/b.ts", "src/a.ts"],
      },
    ]);
  });

  test("bound: a 6-file complete graph (409 elementary cycles) is 1 component", async () => {
    const names = ["f1", "f2", "f3", "f4", "f5", "f6"];
    const tree: Record<string, string> = {
      "package.json": '{ "name": "f26", "version": "1.0.0" }',
      "src/index.ts": importsAll(["f1"]),
    };
    for (const n of names) tree[`src/${n}.ts`] = importsAll(names.filter((m) => m !== n));
    const result = await runDepgraph(makeTree(tree));
    expect(result.stdout).toContain("Found 1 cyclic component (1 runtime, 0 type-only)\n");
    const json = JSON.parse(result.report("dependency-graph.json")) as CycleJson;
    expect(json.dependencyGraph.cyclicComponents.runtime).toEqual([
      { members: names.map((n) => `src/${n}.ts`), cycle: ["src/f1.ts", "src/f2.ts", "src/f1.ts"] },
    ]);
  });

  test("bound: a 14-file complete graph is 1 component in linear time", () => {
    // It has more than 10^10 elementary cycles: a search that lists cycles does not end.
    const names = Array.from({ length: 14 }, (_, i) => `n${String(i).padStart(2, "0")}`);
    const started = performance.now();
    const found = detectCyclicComponents(complete(names));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(found.runtime.length).toBe(1);
    expect(found.runtime[0]?.members.length).toBe(14);
    expect(found.typeOnly).toEqual([]);
  });

  describe("the runtime and type-only split on the F25 fixtures", () => {
    const cycleOf = async (body: string) => {
      const root = makeTree({
        "package.json": '{ "name": "f26", "version": "1.0.0" }',
        "src/index.ts": "/** Entry. */\nimport './a.js';\nexport const main = 1;\n",
        "src/a.ts": `/** A. */\n${body}`,
        "src/c.ts":
          "/** C. */\nimport './a.js';\nexport interface C {\n  n: number;\n}\n" +
          "export function run(): void {}\n",
      });
      const result = await runDepgraph(root);
      const json = JSON.parse(result.report("dependency-graph.json")) as CycleJson;
      return json.dependencyGraph.cyclicComponents;
    };
    const pair = { members: ["src/a.ts", "src/c.ts"], cycle: ["src/a.ts", "src/c.ts", "src/a.ts"] };
    for (const [name, body] of Object.entries(RUNTIME_IMPORTS)) {
      test(`runtime: ${name}`, async () => {
        expect(await cycleOf(body)).toEqual({ runtime: [pair], typeOnly: [] });
      });
    }
    for (const [name, body] of Object.entries(TYPE_IMPORTS)) {
      test(`type-only: ${name}`, async () => {
        expect(await cycleOf(body)).toEqual({ runtime: [], typeOnly: [pair] });
      });
    }
  });
});
