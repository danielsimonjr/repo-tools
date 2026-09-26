/**
 * dependency-layers.json (design decision D3): depgraph's subsystem view, built on the map
 * engine's graph. `modules`, `entryPoints` and `layers` hold the `src` files, as in depgraph 1.x.
 * `cyclicComponents` holds every area, so it agrees with the core statistics.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { emitDependencyGraph } from "../../src/map/artifacts.ts";
import { buildGraph } from "../../src/map/graph.ts";
import { emitDependencyLayers } from "../../src/map/layers.ts";
import { makeTempDir } from "./temp.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A new folder with the files `files`. */
function repo(files: Record<string, string>): string {
  const root = makeTempDir("map-layers");
  made.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
}

// biome-ignore lint/suspicious/noExplicitAny: the artifact is untyped JSON.
type Json = any;

/** Builds the graph, then writes the layers file to `<root>/_out` and reads it back. */
async function layers(root: string): Promise<{ data: Json; text: string; out: string }> {
  const graph = await buildGraph(root);
  const out = join(root, "_out");
  mkdirSync(out, { recursive: true });
  const path = emitDependencyLayers(graph, root, out);
  const text = readFileSync(path, "utf8");
  return { data: JSON.parse(text), text, out };
}

const TS = {
  "package.json": '{"name": "demo", "version": "1.2.3", "main": "src/index.ts"}\n',
  "src/index.ts": 'export * from "./core/a.js";\nexport { u } from "./util/u.js";\n',
  "src/core/a.ts": 'import { b } from "./b.js";\nexport const a = () => b;\n',
  "src/core/b.ts": 'import { a } from "./a.js";\nexport const b = () => a;\n',
  "src/util/u.ts": "export const u = 1;\n",
  "tests/t1.test.ts": 'import { t2 } from "./t2.test.js";\nexport const t1 = t2;\n',
  "tests/t2.test.ts": 'import { t1 } from "./t1.test.js";\nexport const t2 = t1;\n',
};

describe("dependency-layers.json", () => {
  test("is written with the D3 keys, in order, with one trailing LF", async () => {
    const { data, text, out } = await layers(repo(TS));
    expect(Object.keys(data)).toEqual([
      "metadata",
      "entryPoints",
      "modules",
      "cyclicComponents",
      "layers",
    ]);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).not.toContain("\r");
    expect(readFileSync(join(out, "dependency-layers.json"), "utf8")).toBe(text);
  });

  test("metadata names the project, its version, the schema and the language", async () => {
    const { data } = await layers(repo(TS));
    expect(data.metadata).toEqual({
      name: "demo",
      version: "1.2.3",
      schemaVersion: "2.0.0",
      language: "typescript",
    });
  });

  test("modules group the src files by subsystem, as depgraph 1.x does", async () => {
    const { data } = await layers(repo(TS));
    expect(Object.keys(data.modules)).toEqual(["core", "entry", "util"]);
    expect(Object.keys(data.modules.core)).toEqual(["src/core/a.ts", "src/core/b.ts"]);
    expect(JSON.stringify(data.modules)).not.toContain("tests/");
    expect(data.layers.map((l: Json) => l.name)).toEqual(["Core", "Entry", "Util"]);
  });

  test("a module entry keeps depgraph's fields", async () => {
    const { data } = await layers(repo(TS));
    const a = data.modules.core["src/core/a.ts"];
    expect(a.internalDependencies).toEqual([{ file: "./b.js", imports: ["b"] }]);
    expect(a.exports).toEqual(["a"]);
    expect(a.constants).toEqual(["a"]);
    const index = data.modules.entry["src/index.ts"];
    expect(index.internalDependencies.every((d: Json) => d.reExport === true)).toBe(true);
  });

  test("entry points are the src index files", async () => {
    const { data } = await layers(repo(TS));
    expect(data.entryPoints.map((e: Json) => e.file)).toEqual(["src/index.ts"]);
  });

  test("the cyclic components cover every area and agree with the core statistics", async () => {
    const root = repo(TS);
    const { data } = await layers(root);
    expect(data.cyclicComponents.runtime.map((c: Json) => c.members)).toEqual([
      ["src/core/a.ts", "src/core/b.ts"],
      ["tests/t1.test.ts", "tests/t2.test.ts"],
    ]);
    expect(data.cyclicComponents.runtime[0].cycle).toEqual([
      "src/core/a.ts",
      "src/core/b.ts",
      "src/core/a.ts",
    ]);
    const graphOut = join(root, "_core");
    mkdirSync(graphOut, { recursive: true });
    const core = JSON.parse(
      readFileSync(emitDependencyGraph(await buildGraph(root), graphOut), "utf8"),
    );
    expect(core.statistics.runtimeCyclicComponents).toBe(data.cyclicComponents.runtime.length);
    expect(core.statistics.typeOnlyCyclicComponents).toBe(data.cyclicComponents.typeOnly.length);
  });

  test("a Python repo gets a layers file too (D5)", async () => {
    const { data } = await layers(
      repo({
        "pkg/__init__.py": "",
        "pkg/a.py": "from .b import y\nx = 1\n",
        "pkg/b.py": "y = 2\n",
      }),
    );
    expect(data.metadata.language).toBe("python");
    expect(Object.keys(data.modules)).toEqual(["pkg"]);
    expect(data.modules.pkg["pkg/a.py"].internalDependencies).toEqual([
      { file: ".b", imports: ["y"] },
    ]);
  });

  test("a project with no package.json names its version as unknown", async () => {
    const { data } = await layers(repo({ "pkg/__init__.py": "", "pkg/a.py": "x = 1\n" }));
    expect(data.metadata.version).toBe("unknown");
  });
});
