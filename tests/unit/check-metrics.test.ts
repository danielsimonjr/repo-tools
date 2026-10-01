/**
 * The metrics of `repo-tools check` (design section 15): the claim names that a document can
 * hold, and the warnings of the graph build. The values come from the same emitters that
 * `repo-tools map` writes its reports with, into a scratch folder that the run removes.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { collectMetrics } from "../../src/check/metrics.ts";
import { makeTempDir } from "./temp.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A new folder with the files `files`; returns the folder of the repository. */
function repo(files: Record<string, string>): string {
  const base = makeTempDir("check-metrics");
  made.push(base);
  const root = join(base, "repo");
  mkdirSync(root, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

const PKG = '{"name": "demo", "version": "1.0.0", "main": "src/index.ts"}\n';
const DUP = {
  "package.json": PKG,
  "src/index.ts": 'export { a } from "./a.js";\n',
  "src/a.ts": "export function a() { return 1; }\n",
  "src/b.ts": "export function a() { return 2; }\n",
};

describe("collectMetrics", () => {
  test("holds the metadata, the statistics, the inventory total and both summaries", async () => {
    const { metrics } = await collectMetrics(repo(DUP));
    expect(metrics.get("language")).toBe("typescript");
    expect(metrics.get("schemaVersion")).toBe("2.0.0");
    expect(metrics.get("totalFiles")).toBe(3);
    expect(metrics.get("totalSourceFiles")).toBe(3);
    expect(metrics.get("totalTypeScriptFiles")).toBe(3);
    expect(metrics.get("entryRoots")).toBe(1);
    expect(metrics.get("orphanedFiles")).toBe(1);
    expect(metrics.get("circularDepsTruncated")).toBe(false);
    expect(metrics.get("duplicateCount")).toBe(1);
    expect(metrics.get("runtimeDuplicates")).toBe(1);
    expect(metrics.get("unreferencedAnywhereCount")).toBe(1);
    expect(metrics.get("noImporterFileCount")).toBe(1);
  });

  test("holds scalar values only: a tag table is not a claim", async () => {
    const { metrics } = await collectMetrics(repo(DUP));
    expect(metrics.has("runtimeByTag")).toBe(false);
    expect(metrics.has("typeByTag")).toBe(false);
    for (const value of metrics.values()) {
      expect(["string", "number", "boolean"]).toContain(typeof value);
    }
  });

  test("the duplicate allowlist path decides the TRUE_DUPLICATE count", async () => {
    const allow = JSON.stringify({
      entries: [{ names: ["a"], filesGlob: ["src/**"], reason: "accepted" }],
    });
    const root = repo({ ...DUP, "policy/allow.json": allow });
    expect((await collectMetrics(root)).metrics.get("runtimeDuplicates")).toBe(1);
    const named = await collectMetrics(root, { allowlistPath: join(root, "policy", "allow.json") });
    expect(named.metrics.get("runtimeDuplicates")).toBe(0);
  });

  test("the default allowlist is docs/architecture/duplicate-allowlist.json (D9)", async () => {
    const allow = JSON.stringify({
      entries: [{ names: ["a"], filesGlob: ["src/**"], reason: "accepted" }],
    });
    const root = repo({ ...DUP, "docs/architecture/duplicate-allowlist.json": allow });
    expect((await collectMetrics(root)).metrics.get("runtimeDuplicates")).toBe(0);
  });

  test("the warnings hold the roots warning of the graph build", async () => {
    const root = repo({ "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 1;\n" });
    const { warnings } = await collectMetrics(root);
    expect(warnings.some((w) => w.includes("could not determine any entry-point roots"))).toBe(
      true,
    );
  });

  test("the warnings hold the notes that the emitters add, read after all four ran", async () => {
    // No package.json: the inventory emitter notes that it could not derive the packages. The note
    // exists only after emitFileInventory has run, so a read right after the graph build misses it.
    const root = repo({ "src/index.ts": "export const a = 1;\n" });
    const { warnings } = await collectMetrics(root);
    expect(warnings.some((w) => w.includes("no readable package.json"))).toBe(true);
    expect(warnings.some((w) => w.includes("could not determine any entry-point roots"))).toBe(
      false,
    );
  });

  test("a repository with no source file throws the message of map", async () => {
    const root = repo({ "README.md": "nothing\n" });
    await expect(collectMetrics(root)).rejects.toThrow("no source file found");
  });

  test("a language the engine cannot read throws", async () => {
    const root = repo({ "main.go": "package main\n", "util.go": "package main\n" });
    await expect(collectMetrics(root)).rejects.toThrow();
  });

  test("the scratch folder is removed after a run", async () => {
    const scratchBase = makeTempDir("check-scratch");
    made.push(scratchBase);
    await collectMetrics(repo(DUP), { scratchBase });
    expect(readdirSync(scratchBase)).toEqual([]);
  });

  test("a run writes nothing into the repository", async () => {
    const root = repo(DUP);
    const before = readdirSync(root, { recursive: true }).sort();
    await collectMetrics(root);
    expect(readdirSync(root, { recursive: true }).sort()).toEqual(before);
  });
});
