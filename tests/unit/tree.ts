/** Test helper: writes a small file tree into a new temporary folder. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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

/** Removes every folder that `makeTree` made. Call it from `afterAll`. */
export function removeTrees(): void {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
}
