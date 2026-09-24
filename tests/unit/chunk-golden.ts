/**
 * Golden helpers for the `chunk` tests. The same functions make the goldens (from the original
 * tool) and check the port, so both sides use one masking rule.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sortCodeUnits } from "../../src/sort.ts";

export const FIXTURES = join(import.meta.dir, "../fixtures/chunk");
export const GOLDEN = join(import.meta.dir, "../golden/chunk");

/** One characterization case: a fixture file and the extra split arguments. */
export interface GoldenCase {
  name: string;
  file: string;
  splitArgs: string[];
}

export const CASES: GoldenCase[] = [
  { name: "markdown", file: "guide.md", splitArgs: ["-m", "8"] },
  { name: "json", file: "config.json", splitArgs: [] },
  { name: "typescript", file: "parser.ts", splitArgs: [] },
];

/** Copies the fixture of `c` into `dir` and returns the path of the copy. */
export function stageFixture(c: GoldenCase, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, c.file);
  copyFileSync(join(FIXTURES, c.file), target);
  return target;
}

/** Replaces the run folder, dates and timestamps in console output with placeholders. */
export function maskOutput(text: string, dir: string): string {
  const forms = [dir, dir.replace(/\\/g, "/")];
  let out = text;
  for (const f of forms) out = out.split(f).join("<DIR>");
  out = out
    .split("\n")
    .map((line) => (line.includes("<DIR>") ? line.replace(/\\/g, "/") : line))
    .join("\n");
  return out
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<createdAt>")
    .replace(/\.backup-\d+/g, ".backup-<ts>");
}

/**
 * Replaces the `createdAt` value and an absolute `sourceFile` value of a manifest text with
 * placeholders. All other bytes stay the same, so the check stays byte for byte.
 */
export function maskManifest(text: string): string {
  return text
    .replace(/"createdAt": "[^"]*"/, '"createdAt": "<createdAt>"')
    .replace(/"sourceFile": "((?:[^"\\]|\\.)*)"/, (whole, value: string) =>
      isAbsolutePath(JSON.parse(`"${value}"`)) ? '"sourceFile": "<sourceFile>"' : whole,
    );
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}

/** Returns the chunk file names of a chunk folder, without the manifest, in code-unit order. */
export function chunkFiles(dir: string): string[] {
  return sortCodeUnits(readdirSync(dir).filter((f) => f !== "manifest.json"));
}

export function readText(path: string): string {
  return readFileSync(path, "utf8");
}
