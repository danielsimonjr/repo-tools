/**
 * Fix F34: a link-safe walk. No walk descends into a link (symlink or junction). Each skipped
 * link is listed on standard output and in the file inventory, so the skip is visible.
 *
 * The links are junctions on Windows and symbolic links on POSIX (`symlinkSync` ignores the
 * `junction` type there). Each test removes its links in `finally`: `rmdirSync` removes a
 * Windows junction, and `unlinkSync` removes a POSIX symbolic link (`rmdirSync` fails on it
 * with ENOTDIR).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

/** Makes a junction (a symbolic link on POSIX) at `path` to `target`. */
function link(target: string, path: string, made: string[]): void {
  symlinkSync(target, path, "junction");
  made.push(path);
}

/** Removes each link in `made`. Throws after the loop when one removal failed. */
function removeLinks(made: string[]): void {
  const errors: unknown[] = [];
  for (const path of made.splice(0)) {
    try {
      if (process.platform === "win32") rmdirSync(path);
      else unlinkSync(path);
    } catch (err) {
      errors.push(err);
    }
  }
  if (errors.length > 0) throw errors[0];
}

/** A sibling tree outside the root. Its files must never be counted. */
function siblingTree(): string {
  return makeTree({ "src/foreign.ts": "/** Foreign. */\nexport const foreign = 1;\n" });
}

describe("F34: link-safe walk", () => {
  test("monorepo: dangling, self-loop and sibling links are skipped and listed", async () => {
    const root = makeTree({
      "package.json": '{ "name": "ws", "private": true, "workspaces": ["packages/*"] }',
      "packages/core/package.json": '{ "name": "@f34/core", "version": "1.0.0" }',
      "packages/core/src/index.ts": "/** Entry. */\nexport const main = 1;\n",
      "packages/core/tests/index.test.ts": "import { main } from '../src/index.js';\nmain;\n",
    });
    const before = await runDepgraph(root);
    expect(before.code).toBe(0);
    const graphBefore = before.report("dependency-graph.json");
    const filesBefore = JSON.parse(before.report("file-inventory.json")).files;

    const made: string[] = [];
    try {
      link(join(root, "missing"), join(root, "packages/core/src/dangling"), made);
      link(join(root, "packages/core/src"), join(root, "packages/core/src/loop"), made);
      link(siblingTree(), join(root, "packages/core/src/sibling"), made);
      link(siblingTree(), join(root, "packages/linked"), made);
      link(siblingTree(), join(root, "tests"), made);
      const result = await runDepgraph(root);
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(result.report("dependency-graph.json")).toBe(graphBefore);
      const inventory = JSON.parse(result.report("file-inventory.json"));
      expect(inventory.files).toEqual(filesBefore);
      const expected = [
        "packages/core/src/dangling",
        "packages/core/src/loop",
        "packages/core/src/sibling",
        "packages/linked",
        "tests",
      ];
      expect(inventory.skippedLinks).toEqual(expected);
      expect(result.report("FILE_INVENTORY.md")).toContain("- `packages/core/src/sibling`\n");
      expect(result.stdout).toContain(
        `Skipped 5 links (not followed):\n${expected.map((p) => `  - ${p}`).join("\n")}\n`,
      );
      expect(result.stdout).not.toContain("foreign");
    } finally {
      removeLinks(made);
    }
  });

  test("single package: a link under src is skipped and listed", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f34", "version": "1.0.0" }',
      "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
    });
    const made: string[] = [];
    try {
      link(siblingTree(), join(root, "src/sibling"), made);
      link(join(root, "src"), join(root, "src/loop"), made);
      const result = await runDepgraph(root);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Found 1 TypeScript files total");
      expect(result.stdout).toContain(
        "Skipped 2 links (not followed):\n  - src/loop\n  - src/sibling\n",
      );
      expect(result.report("dependency-graph.json")).not.toContain("foreign");
    } finally {
      removeLinks(made);
    }
  });
});
