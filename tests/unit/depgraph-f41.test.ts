/**
 * Fix F41: a folder that a negated workspace pattern excludes is not part of the repo's census.
 * Both census walks skip it, so its files do not fail the census as "absent".
 */
import { afterAll, describe, expect, test } from "bun:test";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F41: negated workspace folders are outside the census", () => {
  for (const kind of ["npm", "pnpm"] as const) {
    test(`${kind}: an excluded package does not fail the census`, async () => {
      const patterns = ["packages/*", "!packages/skip"];
      const root = makeTree({
        "package.json": JSON.stringify(
          kind === "npm" ? { name: "f41", workspaces: patterns } : { name: "f41" },
        ),
        ...(kind === "pnpm"
          ? {
              "pnpm-workspace.yaml": `packages:\n${patterns.map((p) => `  - '${p}'`).join("\n")}\n`,
            }
          : {}),
        "packages/core/package.json": JSON.stringify({ name: "@f41/core", version: "1.0.0" }),
        "packages/core/src/index.ts": "/** Entry. */\nexport const core = 1;\n",
        "packages/skip/package.json": JSON.stringify({ name: "@f41/skip", version: "1.0.0" }),
        "packages/skip/src/old.ts": "/** Excluded. */\nexport const old = 1;\n",
      });
      const result = await runDepgraph(root);
      expect(result.stderr).not.toContain("ABSENT");
      expect(result.code).toBe(0);
    });
  }
});
