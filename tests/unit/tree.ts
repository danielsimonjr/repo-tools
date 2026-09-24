/** Test helper: writes a small file tree into a new temporary folder. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "../../src/depgraph/index.ts";

/** The temporary folders that `makeTree` made in this test file. */
const made: string[] = [];

/** Writes `files` (POSIX relative path to content) under a new folder and returns the folder. */
export function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "repo-tools-dg-"));
  made.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

/** The result of one depgraph run on a tree. */
export interface DepgraphRun {
  code: number;
  stdout: string;
  stderr: string;
  /** The text of one report in `docs/architecture`. */
  report: (name: string) => string;
  /** The parsed `dependency-graph.json`. */
  graph: () => DependencyGraphJson;
}

/** The parts of `dependency-graph.json` that the fix tests read. */
export interface DependencyGraphJson {
  modules: Record<string, Record<string, GraphFile>>;
}

/** One file entry of `dependency-graph.json`. */
export interface GraphFile {
  internalDependencies: { file: string; imports: string[]; typeOnly?: boolean }[];
  exports: string[];
}

/** The entry of the file `path` in any module of `graph`, or undefined. */
export function graphFile(graph: DependencyGraphJson, path: string): GraphFile | undefined {
  for (const files of Object.values(graph.modules)) {
    if (files[path]) return files[path];
  }
  return undefined;
}

/** Runs `repo-tools depgraph` on `root` with `flags`; returns the exit code, output and reports. */
export async function runDepgraph(root: string, flags: string[] = []): Promise<DepgraphRun> {
  let stdout = "";
  let stderr = "";
  const code = await run([`--root=${root}`, ...flags], {
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
  });
  const report = (name: string): string =>
    readFileSync(join(root, "docs/architecture", name), "utf8");
  return {
    code,
    stdout,
    stderr,
    report,
    graph: () => JSON.parse(report("dependency-graph.json")) as DependencyGraphJson,
  };
}

/** Removes every folder that `makeTree` made. Call it from `afterAll`. */
export function removeTrees(): void {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
}
