/**
 * The adapter from the map engine's graph to depgraph's parsed-file records. depgraph's analyzers
 * (layers, cyclic components, coverage, surfaces) then run on the one graph for every language
 * (design decisions D3 and D5).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { detectCyclicComponents } from "../../src/depgraph/cycles.ts";
import { targetOf } from "../../src/depgraph/resolver.ts";
import type { ParsedFile } from "../../src/depgraph/types.ts";
import { toParsedFiles } from "../../src/map/adapter.ts";
import { buildGraph } from "../../src/map/graph.ts";
import { makeTempDir } from "./temp.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A new folder with the files `files`. */
function repo(files: Record<string, string>): string {
  const root = makeTempDir("map-adapter");
  made.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
}

const TS = {
  "package.json": '{"name": "demo", "main": "src/index.ts"}\n',
  "src/index.ts":
    '/**\n * The entry.\n */\nexport * from "./a.js";\nexport { b as bee } from "./b.js";\n',
  "src/a.ts": [
    'import type { B } from "./b.js";',
    'import { readFileSync } from "node:fs";',
    'import lodash from "lodash";',
    "export class A {}",
    "export interface IA {}",
    "export type TA = 1;",
    "export const ca = 1;",
    "export function fa() {}",
    "export enum EA { X }",
    "export default function main() {}",
    "",
  ].join("\n"),
  "src/b.ts": "// B helpers\nexport const b = 2;\nexport type B = number;\n",
  "tests/a.test.ts": 'import { A } from "../src/a.js";\n',
};

/** The records of the TypeScript fixture, by path. */
async function tsRecords(): Promise<Map<string, ParsedFile>> {
  const root = repo(TS);
  const records = toParsedFiles(await buildGraph(root), root);
  return new Map(records.map((r) => [r.path, r]));
}

describe("toParsedFiles", () => {
  test("gives the src files only, with depgraph's file name", async () => {
    const byPath = await tsRecords();
    expect(new Set(byPath.keys())).toEqual(new Set(["src/index.ts", "src/a.ts", "src/b.ts"]));
    expect(byPath.get("src/a.ts")?.name).toBe("a");
  });

  test("an internal edge carries its resolved target, imports and type-only flag", async () => {
    const a = (await tsRecords()).get("src/a.ts") as ParsedFile;
    expect(a.internalDependencies).toHaveLength(1);
    const dep = a.internalDependencies[0];
    expect(dep?.resolved).toBe("src/b.ts");
    expect(dep?.imports).toEqual(["B"]);
    expect(dep?.typeOnly).toBe(true);
    expect(targetOf("src/a.ts", dep as NonNullable<typeof dep>)).toBe("src/b.ts");
  });

  test("packages and built-ins are listed without their imported names", async () => {
    const a = (await tsRecords()).get("src/a.ts") as ParsedFile;
    expect(a.externalDependencies).toEqual([{ package: "lodash", imports: [] }]);
    expect(a.nodeDependencies).toEqual([{ module: "node:fs", imports: [] }]);
  });

  test("the export lists follow depgraph's kinds", async () => {
    const ex = ((await tsRecords()).get("src/a.ts") as ParsedFile).exports;
    expect(new Set(ex.named)).toEqual(new Set(["A", "ca", "fa", "EA"]));
    expect(new Set(ex.types)).toEqual(new Set(["IA", "TA"]));
    expect(ex.interfaces).toEqual(["IA"]);
    expect(ex.classes).toEqual(["A"]);
    expect(ex.functions).toEqual(["fa"]);
    expect(ex.constants).toEqual(["ca"]);
    expect(ex.enums).toEqual(["EA"]);
    expect(ex.default).toBe("main");
  });

  test("re-exports are marked, and listed as depgraph lists them", async () => {
    const index = (await tsRecords()).get("src/index.ts") as ParsedFile;
    expect(new Set(index.exports.reExported)).toEqual(new Set(["* from ./a.js", "bee"]));
    expect(index.exports.named).toContain("bee");
    expect(index.internalDependencies.every((d) => d.reExport === true)).toBe(true);
    expect(new Set(index.internalDependencies.map((d) => d.resolved))).toEqual(
      new Set(["src/a.ts", "src/b.ts"]),
    );
  });

  test("a description comes from the first JSDoc block, else the first // line", async () => {
    const byPath = await tsRecords();
    expect(byPath.get("src/index.ts")?.description).toBe("The entry.");
    expect(byPath.get("src/b.ts")?.description).toBe("B helpers");
    expect(byPath.get("src/a.ts")?.description).toBeNull();
  });
});

describe("depgraph's analyzers on adapted records", () => {
  test("a Python import cycle is a cyclic component (the resolved .py targets are used)", async () => {
    const root = repo({
      "pkg/__init__.py": "",
      "pkg/a.py": "from .b import y\nx = 1\n",
      "pkg/b.py": "from .a import x\ny = 2\n",
    });
    const records = toParsedFiles(await buildGraph(root), root);
    const found = detectCyclicComponents(records);
    expect(found.runtime.map((c) => c.members)).toEqual([["pkg/a.py", "pkg/b.py"]]);
  });

  test("a record with no resolved target still resolves as 1.x does", () => {
    const dep = { file: "./x.js", imports: [] };
    expect(targetOf("src/a.ts", dep)).toBe("src/x.ts");
  });
});
