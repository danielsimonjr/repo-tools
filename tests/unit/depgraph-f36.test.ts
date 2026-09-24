/**
 * Fix F36: a negated workspace pattern (`!packages/skip`) excludes its folder, in the npm form
 * and in the pnpm form. The excluded folder is not a workspace package, and its files are not
 * in the graph.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { detectWorkspaces } from "../../src/depgraph/workspaces.ts";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

/** The packages of the fixture: `a`, `skip` and `skipped-too` under `packages/`. */
const PACKAGES = {
  "packages/a/package.json": '{ "name": "@f36/a", "version": "1.0.0" }',
  "packages/a/src/index.ts": "/** A. */\nexport const a = 1;\n",
  "packages/skip/package.json": '{ "name": "@f36/skip", "version": "1.0.0" }',
  "packages/skip/src/index.ts": "/** Skip. */\nexport const skip = 1;\n",
  "packages/skipped-too/package.json": '{ "name": "@f36/skipped-too", "version": "1.0.0" }',
  "packages/skipped-too/src/index.ts": "/** Skipped too. */\nexport const skippedToo = 1;\n",
};

describe("F36: negated workspace patterns", () => {
  test("npm: !packages/skip and a glob negation exclude their folders", async () => {
    const root = makeTree({
      "package.json": JSON.stringify({
        name: "ws",
        private: true,
        workspaces: ["packages/*", "!packages/skip", "!./packages/skipped-*/"],
      }),
      ...PACKAGES,
    });
    expect([...detectWorkspaces(root).keys()]).toEqual(["@f36/a"]);
    const result = await runDepgraph(root);
    const graph = result.report("dependency-graph.json");
    expect(graph).toContain("packages/a/src/index.ts");
    expect(graph).not.toContain("packages/skip");
    expect(result.stdout).toContain("Monorepo detected: 1 workspace packages\n  - @f36/a");
  });

  test("pnpm: !packages/skip excludes its folder", async () => {
    const root = makeTree({
      "package.json": '{ "name": "ws", "private": true }',
      "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n  - '!packages/skip'\n",
      ...PACKAGES,
    });
    expect([...detectWorkspaces(root).keys()]).toEqual(["@f36/a", "@f36/skipped-too"]);
    const result = await runDepgraph(root);
    expect(result.report("dependency-graph.json")).not.toContain("packages/skip/");
  });
});
