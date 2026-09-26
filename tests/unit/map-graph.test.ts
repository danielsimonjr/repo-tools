/**
 * The graph of the map engine: schema, cycles, reachability, the import buckets, barrel
 * expansion, entry-point roots and thin launchers.
 *
 * Ported from the architecture-docs skill: `test_schema.py` and `test_graph.py`. The source test of
 * the cycle cap patched a module constant; this port passes the caps as an argument instead.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildGraph, findCycles, reachableFrom } from "../../src/map/graph.ts";
import {
  type FileNode,
  newRepoGraph,
  type RepoGraph,
  SCHEMA_VERSION,
  toJson,
} from "../../src/map/schema.ts";
import { makeTempDir } from "./temp.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A new empty folder with the files `files` (POSIX path to text). */
function repo(files: Record<string, string>): string {
  const root = makeTempDir("map-graph");
  made.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
}

/** A file node with defaults. */
function node(path: string, over: Partial<FileNode> = {}): FileNode {
  return {
    path,
    area: "src",
    disposition: "reachable",
    loc: 10,
    exports: ["A"],
    internal: [],
    external: [],
    nodeBuiltins: [],
    broken: [],
    aliases: [],
    ...over,
  };
}

/** A graph of `src` files with the edges `edges` (file -> targets). */
function g(edges: Record<string, string[]>): RepoGraph {
  const files = new Map<string, FileNode>();
  for (const [p, targets] of Object.entries(edges)) {
    files.set(
      p,
      node(p, {
        loc: 1,
        exports: [],
        internal: targets.map((t) => ({ file: t, imports: [], typeOnly: false })),
      }),
    );
  }
  return newRepoGraph({ name: "t", files, roots: [] });
}

describe("schema: toJson", () => {
  test("has the top-level keys, the name and the schema version", () => {
    const out = toJson(
      newRepoGraph({
        name: "demo",
        files: new Map([["src/a.ts", node("src/a.ts")]]),
        roots: ["src/a.ts"],
      }),
    );
    for (const key of ["metadata", "modules", "statistics", "reachability"])
      expect(out).toHaveProperty(key);
    expect(out.metadata.name).toBe("demo");
    expect(out.metadata.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe("2.0.0");
  });

  test("modules are keyed by area, then file; a dependency has its field names", () => {
    const dep = { file: "./b.js", imports: ["B"], typeOnly: true };
    const out = toJson(
      newRepoGraph({
        name: "d",
        files: new Map([["src/a.ts", node("src/a.ts", { internal: [dep] })]]),
        roots: [],
      }),
    );
    expect(out.modules.src?.["src/a.ts"]?.internalDependencies).toEqual([
      { file: "./b.js", imports: ["B"], typeOnly: true },
    ]);
  });

  test("statistics use totalTypeScriptFiles, not totalFiles; a module entry has its exports", () => {
    const out = toJson(
      newRepoGraph({
        name: "demo",
        files: new Map([["src/a.ts", node("src/a.ts", { exports: ["A", "B"] })]]),
        roots: [],
      }),
    );
    expect(out.statistics.totalTypeScriptFiles).toBe(1);
    expect(out.statistics).not.toHaveProperty("totalFiles");
    expect(out.modules.src?.["src/a.ts"]?.exports).toEqual(["A", "B"]);
  });
});

const MULTI = {
  "a.ts": ["b.ts"],
  "b.ts": ["a.ts", "c.ts"],
  "c.ts": ["a.ts", "d.ts"],
  "d.ts": ["a.ts"],
};
const signatures = (cycles: string[][]) =>
  new Set(cycles.map((c) => [...new Set(c)].sort().join(",")));

describe("findCycles", () => {
  test("a two-node cycle, and none in a DAG", () => {
    expect(
      findCycles(g({ "a.ts": ["b.ts"], "b.ts": ["a.ts"] })).cycles.some(
        (c) => new Set(c).size === 2,
      ),
    ).toBe(true);
    expect(findCycles(g({ "a.ts": ["b.ts"], "b.ts": [] })).cycles).toEqual([]);
  });

  test("finds all three cycles through a shared node, under every file order", () => {
    const want = new Set(["a.ts,b.ts", "a.ts,b.ts,c.ts", "a.ts,b.ts,c.ts,d.ts"]);
    const entries = Object.entries(MULTI);
    let seed = 20260804;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let trial = 0; trial < 8; trial++) {
      const order = trial === 0 ? entries : [...entries].sort(() => rand() - 0.5);
      const found = findCycles(g(Object.fromEntries(order))).cycles;
      expect(found.length).toBe(3);
      expect(signatures(found)).toEqual(want);
    }
  });

  test("the cap truncates and warns that the count is a floor; no warning under the cap", () => {
    const capped = g(MULTI);
    const r = findCycles(capped, { maxCycles: 1 });
    expect(r.cycles.length).toBe(1);
    expect(r.truncated).toBe(true);
    expect(
      capped.warnings.some(
        (w) => w.toLowerCase().includes("floor") || w.toLowerCase().includes("cap"),
      ),
    ).toBe(true);
    const plain = g(MULTI);
    findCycles(plain);
    expect(plain.warnings).toEqual([]);
  });

  test("a large acyclic fan-out costs almost no backtracking", () => {
    const edges: Record<string, string[]> = { aaa_hub: [] };
    let level = ["aaa_hub"];
    for (let d = 0; d < 5; d++) {
      const next: string[] = [];
      level.forEach((n, i) => {
        const children = Array.from({ length: 6 }, (_, c) => `aab_${d}_${i}_${c}`);
        edges[n] = children;
        next.push(...children);
      });
      level = next;
    }
    for (const leaf of level) edges[leaf] = [];
    edges.zzz_a = ["zzz_b"];
    edges.zzz_b = ["zzz_a"];
    const graph = g(edges);
    const r = findCycles(graph);
    expect(r.cycles.length).toBe(1);
    expect(new Set(r.cycles[0])).toEqual(new Set(["zzz_a", "zzz_b"]));
    expect(graph.warnings).toEqual([]);
    expect(r.steps).toBeLessThanOrEqual(20);
  });
});

describe("reachableFrom", () => {
  test("excludes orphans", () => {
    expect(reachableFrom(g({ "a.ts": ["b.ts"], "b.ts": [], "orphan.ts": [] }), ["a.ts"])).toEqual(
      new Set(["a.ts", "b.ts"]),
    );
  });
});

describe("buildGraph: edges and import buckets", () => {
  test("links a real import", async () => {
    const graph = await buildGraph(
      repo({
        "src/a.ts": 'import { B } from "./b.js";\nexport const a = B;\n',
        "src/b.ts": "export const B = 1;\n",
      }),
    );
    expect(graph.files.get("src/a.ts")?.internal[0]?.file).toBe("src/b.ts");
  });

  test("a broken relative import is counted, not dropped", async () => {
    const n = (
      await buildGraph(repo({ "src/a.ts": 'import { X } from "./missing.js";\n' }))
    ).files.get("src/a.ts");
    expect(n?.internal).toEqual([]);
    expect(n?.broken).toEqual(["./missing.js"]);
  });

  test("an alias lands in the alias bucket, not external", async () => {
    const n = (await buildGraph(repo({ "src/a.ts": 'import { X } from "@/lib/x";\n' }))).files.get(
      "src/a.ts",
    );
    expect(n?.external).toEqual([]);
    expect(n?.internal).toEqual([]);
    expect(n?.aliases).toEqual(["@/lib/x"]);
  });

  test("a node builtin and an external package are neither broken nor alias", async () => {
    const n = (
      await buildGraph(
        repo({ "src/a.ts": 'import fs from "node:fs";\nimport { z } from "zod";\n' }),
      )
    ).files.get("src/a.ts");
    expect(n?.nodeBuiltins).toEqual(["node:fs"]);
    expect(n?.external).toEqual(["zod"]);
    expect(n?.broken).toEqual([]);
    expect(n?.aliases).toEqual([]);
  });
});

describe("buildGraph: barrel export * expansion", () => {
  test("a bare star re-export expands to the target's exports", async () => {
    const graph = await buildGraph(
      repo({
        "src/a.ts": "export const A = 1;\nexport const B = 2;\n",
        "src/index.ts": 'export * from "./a.js";\n',
      }),
    );
    const edge = graph.files.get("src/index.ts")?.internal[0];
    expect(edge?.file).toBe("src/a.ts");
    expect([...(edge?.imports ?? [])].sort()).toEqual(["A", "B"]);
  });

  test("expands transitively through nested barrels", async () => {
    const graph = await buildGraph(
      repo({
        "src/leaf.ts": "export const L = 1;\n",
        "src/mid.ts": 'export * from "./leaf.js";\nexport const M = 2;\n',
        "src/index.ts": 'export * from "./mid.js";\n',
      }),
    );
    expect([...(graph.files.get("src/index.ts")?.internal[0]?.imports ?? [])].sort()).toEqual([
      "L",
      "M",
    ]);
  });

  test("a side-effect import is not a barrel", async () => {
    const graph = await buildGraph(
      repo({ "src/a.ts": "export const A = 1;\n", "src/b.ts": 'import "./a.js";\n' }),
    );
    // D3 and D5: the edge also keeps its written specifier and its side-effect flag for the
    // extras; it is no re-export.
    expect(graph.files.get("src/b.ts")?.internal[0]).toEqual({
      file: "src/a.ts",
      imports: [],
      typeOnly: false,
      sideEffect: true,
      specifier: "./a.js",
    });
  });

  test("a mutual star re-export terminates without duplicate names", async () => {
    const graph = await buildGraph(
      repo({
        "src/a.ts": 'export * from "./b.js";\nexport const A = 1;\n',
        "src/b.ts": 'export * from "./a.js";\nexport const B = 1;\n',
      }),
    );
    const aEdge = graph.files.get("src/a.ts")?.internal.find((d) => d.file === "src/b.ts");
    const bEdge = graph.files.get("src/b.ts")?.internal.find((d) => d.file === "src/a.ts");
    expect(aEdge?.imports).toEqual(["A", "B"]);
    expect(bEdge?.imports).toEqual(["A", "B"]);
  });

  test("a self-referential star re-export terminates", async () => {
    const graph = await buildGraph(
      repo({ "src/a.ts": 'export * from "./a.js";\nexport const A = 1;\n' }),
    );
    expect(
      graph.files.get("src/a.ts")?.internal.find((d) => d.file === "src/a.ts")?.imports,
    ).toEqual(["A"]);
  });
});

describe("buildGraph: dispositions and roots", () => {
  test("the fallback root, reachable and orphan", async () => {
    const graph = await buildGraph(
      repo({
        "src/index.ts": 'import "./used.js";\n',
        "src/used.ts": "export const U = 1;\n",
        "src/orphan.ts": "export const O = 1;\n",
      }),
    );
    expect(graph.files.get("src/index.ts")?.disposition).toBe("build-entry");
    expect(graph.files.get("src/used.ts")?.disposition).toBe("reachable");
    expect(graph.files.get("src/orphan.ts")?.disposition).toBe("orphan");
    expect(graph.roots).toEqual(["src/index.ts"]);
  });

  test("test-only when a test is the only importer", async () => {
    const graph = await buildGraph(
      repo({
        "src/index.ts": "export const A = 1;\n",
        "src/helper.ts": "export const H = 1;\n",
        "tests/helper.test.ts": 'import { H } from "../src/helper.js";\n',
      }),
    );
    expect(graph.files.get("src/helper.ts")?.disposition).toBe("test-only");
  });

  test("package.json exports map to source roots", async () => {
    const graph = await buildGraph(
      repo({
        "package.json": JSON.stringify({
          main: "dist/index.cjs",
          exports: { ".": "./dist/index.js", "./core": "./dist/core/index.js" },
        }),
        "src/index.ts": "export const A = 1;\n",
        "src/core/index.ts": "export const C = 1;\n",
      }),
    );
    expect(new Set(graph.roots)).toEqual(new Set(["src/index.ts", "src/core/index.ts"]));
    expect(graph.files.get("src/core/index.ts")?.disposition).toBe("build-entry");
  });

  test("roots resolve when dist mirrors the package root", async () => {
    const graph = await buildGraph(
      repo({
        "package.json": JSON.stringify({
          main: "dist/src/index.js",
          bin: { portal: "dist/src/portal.js" },
        }),
        "src/index.ts": "export const A = 1;\n",
        "src/portal.ts": "export const P = 1;\n",
      }),
    );
    expect(new Set(graph.roots)).toEqual(new Set(["src/index.ts", "src/portal.ts"]));
    expect(graph.warnings.some((w) => w.includes("did not resolve"))).toBe(false);
  });

  test("a warning when no root can be determined", async () => {
    const graph = await buildGraph(repo({ "src/a.ts": "export const A = 1;\n" }));
    expect(graph.roots).toEqual([]);
    expect(graph.warnings.some((w) => w.includes("entry-point"))).toBe(true);
  });

  test("an empty repo warns that nothing was scanned, with no orphan wording", async () => {
    const graph = await buildGraph(repo({ "README.md": "# docs only\n" }));
    expect(graph.files.size).toBe(0);
    expect(graph.roots).toEqual([]);
    expect(
      graph.warnings.some(
        (w) =>
          w.includes("no TypeScript/JavaScript source files found") && w.includes("not because"),
      ),
    ).toBe(true);
    expect(graph.warnings.some((w) => w.includes("will show as orphan"))).toBe(false);
    // Output rule R4: no absolute path in the warning.
    expect(graph.warnings.join(" ")).not.toContain(made.at(-1) as string);
  });

  test("an unresolvable package.json main warns before the fallback; a resolvable one does not", async () => {
    const bad = await buildGraph(
      repo({
        "package.json": JSON.stringify({ main: "dist/foo.js" }),
        "src/index.ts": "export const A = 1;\n",
      }),
    );
    expect(bad.roots).toEqual(["src/index.ts"]);
    expect(
      bad.warnings.some((w) => w.includes("dist/foo.js") && w.includes("did not resolve")),
    ).toBe(true);
    const good = await buildGraph(
      repo({
        "package.json": JSON.stringify({ main: "dist/index.js" }),
        "src/index.ts": "export const A = 1;\n",
      }),
    );
    expect(good.roots).toEqual(["src/index.ts"]);
    expect(good.warnings).toEqual([]);
  });
});

describe("buildGraph: thin launchers", () => {
  /** A repo whose bin is a launcher with the body `body`. */
  const launcherRepo = (body: string): string =>
    repo({
      "package.json": JSON.stringify({ main: "dist/index.js", bin: { upt: "bin/upt.mjs" } }),
      "bin/upt.mjs": body,
      "src/index.ts": "export const A = 1;\n",
      "src/cli/main.ts": "import { run } from './run';\nexport const main = run;\n",
      "src/cli/run.ts": "export const run = () => 0;\n",
    });

  test("split path literals resolve to the source entry", async () => {
    const graph = await buildGraph(
      launcherRepo(
        "const here = dirname(fileURLToPath(import.meta.url));\n" +
          "const entry = pathToFileURL(join(here, '..', 'dist', 'cli', 'main.js')).href;\nconst main = await import(entry);\n",
      ),
    );
    expect(graph.roots).toContain("src/cli/main.ts");
    expect(graph.warnings.some((w) => w.includes("bin/upt.mjs"))).toBe(false);
  });

  test("a single path literal resolves to the source entry", async () => {
    expect(
      (await buildGraph(launcherRepo("const main = await import('../dist/cli/main.js');\n"))).roots,
    ).toContain("src/cli/main.ts");
  });

  test("the subtree that the launcher reaches is not orphaned", async () => {
    const graph = await buildGraph(
      launcherRepo("const entry = join(here, '..', 'dist', 'cli', 'main.js');\n"),
    );
    expect(reachableFrom(graph, graph.roots).has("src/cli/run.ts")).toBe(true);
  });

  test("a launcher that names no build output still warns", async () => {
    const graph = await buildGraph(
      launcherRepo("console.error('this shim references no build output at all');\n"),
    );
    expect(graph.roots).not.toContain("src/cli/main.ts");
    expect(graph.warnings.some((w) => w.includes("bin/upt.mjs"))).toBe(true);
  });

  test("a large entry file is not read as a launcher", async () => {
    const body = `${"// padding\n".repeat(4000)}const s = join('dist', 'cli', 'main.js');\n`;
    const graph = await buildGraph(launcherRepo(body));
    expect(graph.roots).not.toContain("src/cli/main.ts");
    expect(graph.warnings.some((w) => w.includes("bin/upt.mjs"))).toBe(true);
  });
});
