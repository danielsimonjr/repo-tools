/**
 * The Markdown reports of the map engine (design decisions D4 and D5): FILE_INVENTORY.md,
 * duplicate-symbols.md and unused-analysis.md. Each one renders the JSON files that the run wrote
 * into the output folder, for every language.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  emitDependencyGraph,
  emitDuplicateSymbols,
  emitFileInventory,
  emitUnusedAnalysis,
} from "../../src/map/artifacts.ts";
import { buildGraph } from "../../src/map/graph.ts";
import { emitMarkdownReports } from "../../src/map/markdown.ts";
import { makeTempDir } from "./temp.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A new folder with the files `files`. */
function repo(files: Record<string, string>): string {
  const root = makeTempDir("map-markdown");
  made.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
}

// biome-ignore lint/suspicious/noExplicitAny: the artifacts are untyped JSON.
type Json = any;

/** Writes the four core files, then the Markdown; returns the texts and the parsed JSON. */
async function run(root: string): Promise<{ md: Record<string, string>; json: Json }> {
  const graph = await buildGraph(root);
  const out = join(root, "_out");
  mkdirSync(out, { recursive: true });
  emitDependencyGraph(graph, out);
  emitFileInventory(graph, out);
  emitDuplicateSymbols(graph, out);
  emitUnusedAnalysis(graph, out);
  const md: Record<string, string> = {};
  for (const p of emitMarkdownReports(out)) {
    md[p.split(/[\\/]/).pop() as string] = readFileSync(p, "utf8");
  }
  const read = (name: string): Json => JSON.parse(readFileSync(join(out, name), "utf8"));
  return {
    md,
    json: {
      graph: read("dependency-graph.json"),
      inventory: read("file-inventory.json"),
      duplicates: read("duplicate-symbols.json"),
      unused: read("unused-analysis.json"),
    },
  };
}

const TS = {
  "package.json": '{"name": "demo", "main": "src/index.ts"}\n',
  "src/index.ts": 'import { used } from "./a.js";\nexport const main = used;\n',
  "src/a.ts":
    "export function foo() { return 1; }\nexport const used = 1;\nexport const dead = 2;\n",
  "src/b.ts": "export function foo() { return 2; }\n",
  "tests/a.test.ts": 'import { used } from "../src/a.js";\nexport const t = used;\n',
};

const PY = {
  "pkg/__init__.py": "",
  "pkg/a.py": "def foo():\n    return 1\n",
  "pkg/b.py": "def foo():\n    return 2\n",
};

describe("emitMarkdownReports", () => {
  test("writes three reports with the `repo-tools map` banner, one LF and no CR", async () => {
    const { md } = await run(repo(TS));
    expect(Object.keys(md).sort()).toEqual([
      "FILE_INVENTORY.md",
      "duplicate-symbols.md",
      "unused-analysis.md",
    ]);
    for (const text of Object.values(md)) {
      expect(text).toContain("Regenerate with `repo-tools map`.");
      expect(text.endsWith("\n")).toBe(true);
      expect(text.endsWith("\n\n")).toBe(false);
      expect(text).not.toContain("\r");
    }
  });
});

describe("FILE_INVENTORY.md", () => {
  test("renders the counts and every file of file-inventory.json", async () => {
    const { md, json } = await run(repo(TS));
    const text = md["FILE_INVENTORY.md"] as string;
    expect(text).toContain(`**Total files**: ${json.inventory.totalFiles}`);
    expect(text).toContain("**Language**: typescript");
    for (const [disposition, count] of Object.entries(json.inventory.byDisposition)) {
      expect(text).toContain(`| \`${disposition}\` | ${count} |`);
    }
    for (const f of json.inventory.files) expect(text).toContain(`| \`${f.file}\` |`);
    expect(text).toContain("## Skipped links\n\nLinks");
    expect(text).toContain("_None._");
    expect(text).not.toContain("verifyFileCensus");
  });
});

describe("duplicate-symbols.md", () => {
  test("a TypeScript report shows depgraph's classified sections", async () => {
    const { md } = await run(repo(TS));
    const text = md["duplicate-symbols.md"] as string;
    expect(text).toContain("### TRUE_DUPLICATE — actionable merge targets");
    expect(text).toContain("| `foo` |");
  });

  test("another language gets the name-only grouping and the explicit note", async () => {
    const { md, json } = await run(repo(PY));
    const text = md["duplicate-symbols.md"] as string;
    expect(text).toContain(json.duplicates.classificationNote);
    expect(text).toContain("| `foo` | `pkg/a.py`, `pkg/b.py` |");
    expect(text).not.toContain("TRUE_DUPLICATE — actionable");
  });
});

describe("unused-analysis.md", () => {
  test("renders the summary, the buckets, the dormant files and the caveats", async () => {
    const { md, json } = await run(repo(TS));
    const text = md["unused-analysis.md"] as string;
    const s = json.unused.summary;
    expect(text).toContain(`- **Potentially unused exports**: ${s.unusedExportCount}`);
    expect(text).toContain(`- **Files with no in-repo importer**: ${s.noImporterFileCount}`);
    for (const [file, names] of Object.entries(json.unused.unreferencedAnywhere) as [
      string,
      string[],
    ][]) {
      expect(text).toContain(`- \`${file}\`: \`${names.join("`, `")}\``);
    }
    expect(json.graph.reachability.orphaned).toContain("src/b.ts");
    expect(text).toContain("## Dormant files: orphaned");
    expect(text).toContain("- `src/b.ts`");
    for (const caveat of json.unused.caveats) expect(text).toContain(caveat);
  });

  test("a Python report renders too (D5)", async () => {
    const { md } = await run(repo(PY));
    expect(md["unused-analysis.md"]).toContain("# Unused Files and Exports Analysis");
  });
});
