/**
 * The subsystem reports of the map engine (design decisions D3 and D5): DEPENDENCY_GRAPH.md,
 * dependency-graph.yaml and dependency-summary.compact.json, for every language. The Markdown and
 * the compact summary render the subsystem view and the core statistics; the YAML mirrors the
 * core dependency-graph.json.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { load } from "js-yaml";
import { emitDependencyGraph } from "../../src/map/artifacts.ts";
import { buildGraph } from "../../src/map/graph.ts";
import { emitSubsystemReports } from "../../src/map/reports.ts";
import { makeTempDir } from "./temp.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A new folder with the files `files`. */
function repo(files: Record<string, string>): string {
  const root = makeTempDir("map-reports");
  made.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
}

/** Writes the core graph and the three reports into `<root>/_out`; returns the texts. */
async function reports(root: string): Promise<Record<string, string>> {
  const graph = await buildGraph(root);
  const out = join(root, "_out");
  mkdirSync(out, { recursive: true });
  const corePath = emitDependencyGraph(graph, out);
  const paths = emitSubsystemReports(graph, root, out, corePath);
  const texts: Record<string, string> = { core: readFileSync(corePath, "utf8") };
  for (const p of paths) texts[p.split(/[\\/]/).pop() as string] = readFileSync(p, "utf8");
  return texts;
}

const TS = {
  "package.json": '{"name": "demo", "version": "1.2.3", "main": "src/index.ts"}\n',
  "src/index.ts": 'export * from "./core/a.js";\nexport { u } from "./util/u.js";\n',
  "src/core/a.ts": 'import { b } from "./b.js";\nexport class A {}\nexport const a = () => b;\n',
  "src/core/b.ts": 'import { a } from "./a.js";\nexport const b = () => a;\n',
  "src/util/u.ts": "export const u = 1;\n",
  "tests/t1.test.ts": 'import { t2 } from "./t2.test.js";\nexport const t1 = t2;\n',
  "tests/t2.test.ts": 'import { t1 } from "./t1.test.js";\nexport const t2 = t1;\n',
};

const PY = {
  "pkg/__init__.py": "",
  "pkg/a.py": "from .b import y\nclass A:\n    pass\n",
  "pkg/b.py": "from .a import A\ny = 2\n",
};

describe("emitSubsystemReports", () => {
  test("writes the three reports, each with one trailing LF and no CR", async () => {
    const texts = await reports(repo(TS));
    for (const name of [
      "DEPENDENCY_GRAPH.md",
      "dependency-graph.yaml",
      "dependency-summary.compact.json",
    ]) {
      const text = texts[name] as string;
      expect(text.endsWith("\n")).toBe(true);
      expect(text.endsWith("\n\n")).toBe(false);
      expect(text).not.toContain("\r");
    }
  });

  test("the Markdown has the banner of `repo-tools map`, the title and the subsystems", async () => {
    const md = (await reports(repo(TS)))["DEPENDENCY_GRAPH.md"] as string;
    expect(md).toContain("Regenerate with `repo-tools map`.");
    expect(md).toContain("# demo - Dependency Graph\n\n**Version**: 1.2.3\n");
    expect(md).toContain("## Core Dependencies");
    expect(md).toContain("## Util Dependencies");
  });

  test("the Markdown cycle section counts the files of the listed components", async () => {
    const md = (await reports(repo(TS)))["DEPENDENCY_GRAPH.md"] as string;
    expect(md).toContain("**2 cyclic components detected**");
    expect(md).toContain("- **Runtime components**: 2 (4 files; require attention)");
  });

  test("the Markdown statistics table reads the core statistics", async () => {
    const texts = await reports(repo(TS));
    const stats = JSON.parse(texts.core as string).statistics;
    const md = texts["DEPENDENCY_GRAPH.md"] as string;
    expect(md).toContain(`| Total Source Files | ${stats.totalSourceFiles} |`);
    expect(md).toContain("| Subsystems | 3 |");
    expect(md).toContain(`| Total Classes | ${stats.totalClasses} |`);
    expect(md).toContain(`| Runtime Cyclic Components | ${stats.runtimeCyclicComponents} |`);
    expect(md).not.toContain("Total TypeScript Files");
  });

  test("a Python table has no TypeScript kind rows", async () => {
    const md = (await reports(repo(PY)))["DEPENDENCY_GRAPH.md"] as string;
    expect(md).toContain("| Total Source Files |");
    expect(md).not.toContain("Total Classes");
    expect(md).not.toContain("undefined");
    expect(md).toContain("**1 cyclic component detected**");
  });

  test("the YAML mirrors the core dependency-graph.json", async () => {
    const texts = await reports(repo(PY));
    expect(load(texts["dependency-graph.yaml"] as string)).toEqual(
      JSON.parse(texts.core as string),
    );
  });

  test("the compact summary reads the core statistics", async () => {
    const texts = await reports(repo(TS));
    const stats = JSON.parse(texts.core as string).statistics;
    const compact = JSON.parse(texts["dependency-summary.compact.json"] as string);
    expect(compact.m).toEqual({
      n: "demo",
      v: "1.2.3",
      f: stats.totalSourceFiles,
      e: stats.totalExports,
      re: stats.totalReExports,
    });
    expect(compact.s.cls).toBe(stats.totalClasses);
    expect(compact.c.rtc).toBe(2);
    expect(Object.keys(compact.mod)).toEqual(["core", "entry", "util"]);
  });

  test("a Python compact summary leaves out the kind counts", async () => {
    const compact = JSON.parse(
      (await reports(repo(PY)))["dependency-summary.compact.json"] as string,
    );
    expect(compact.s).not.toHaveProperty("cls");
    expect(compact.s).toHaveProperty("loc");
  });
});
