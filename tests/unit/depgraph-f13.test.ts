/**
 * Fix F13: a pnpm workspace declares its packages in `pnpm-workspace.yaml`, not in
 * `package.json`. The fixture `pnpm-repo` has a `packages/*` glob and one plain folder pattern.
 * Every package is found, and a workspace import resolves to the package entry.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectWorkspaces } from "../../src/depgraph/workspaces.ts";
import { graphFile, runDepgraph } from "./tree.ts";

const repo = join(import.meta.dir, "../..");
const fixture = join(repo, "tests/fixtures/depgraph/pnpm-repo");
const work = mkdtempSync(join(tmpdir(), "repo-tools-f13-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("F13: pnpm workspaces", () => {
  test("detectWorkspaces finds each package of pnpm-workspace.yaml", () => {
    const found = [...detectWorkspaces(fixture)].map(([name, ws]) => [name, ws.directory]);
    expect(found).toEqual([
      ["@pn/core", "packages/core"],
      ["@pn/util", "packages/util"],
      ["@pn/web", "apps/web"],
    ]);
  });

  test("depgraph runs in monorepo mode on the pnpm fixture", async () => {
    const root = join(work, "pnpm-repo");
    cpSync(fixture, root, { recursive: true });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Monorepo detected: 3 workspace packages\n");
    expect(result.stdout).toContain("Found 3 TypeScript files total\n");
    const graph = result.graph();
    for (const path of [
      "packages/core/src/index.ts",
      "packages/util/src/index.ts",
      "apps/web/src/index.ts",
    ]) {
      expect({ path, found: graphFile(graph, path) !== undefined }).toEqual({ path, found: true });
    }
    expect(result.report("file-inventory.json")).toContain('"apps/web/tests/index.test.ts"');
  });
});
