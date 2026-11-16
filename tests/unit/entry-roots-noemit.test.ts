/**
 * A `tsc -p` script whose config emits nothing is a typecheck, not a build. Its `include` names a
 * compilation set, not entry files, so it seeds no entry roots. A build config still seeds.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { buildGraph } from "../../src/map/graph.ts";
import { makeTree, removeTrees } from "./tree.ts";

afterAll(removeTrees);

const SRC = {
  "src/index.ts": "import './a.ts';",
  "src/a.ts": "export const a = 1;",
  "src/unused.ts": "export const unused = 1;",
};

async function rootsOf(files: Record<string, string>): Promise<string[]> {
  const graph = await buildGraph(makeTree(files));
  return [...graph.roots].sort();
}

const pkg = (script: string) =>
  JSON.stringify({ name: "lib", exports: { ".": "./dist/index.js" }, scripts: { check: script } });

describe("entry roots and a typecheck-only tsconfig", () => {
  test("a config with noEmit seeds no roots", async () => {
    const roots = await rootsOf({
      ...SRC,
      "package.json": pkg("tsc -p tsconfig.check.json"),
      "tsconfig.check.json": JSON.stringify({
        compilerOptions: { noEmit: true },
        include: ["src/**/*"],
      }),
    });
    expect(roots).not.toContain("src/unused.ts");
  });

  test("noEmit inherited through extends seeds no roots", async () => {
    const roots = await rootsOf({
      ...SRC,
      "package.json": pkg("tsc -p tsconfig.check.json"),
      "tsconfig.base.json": JSON.stringify({ compilerOptions: { noEmit: true } }),
      "tsconfig.check.json": JSON.stringify({
        extends: "./tsconfig.base.json",
        include: ["src/**/*"],
      }),
    });
    expect(roots).not.toContain("src/unused.ts");
  });

  test("the --noEmit flag on the script seeds no roots", async () => {
    const roots = await rootsOf({
      ...SRC,
      "package.json": pkg("tsc -p tsconfig.check.json --noEmit"),
      "tsconfig.check.json": JSON.stringify({ include: ["src/**/*"] }),
    });
    expect(roots).not.toContain("src/unused.ts");
  });

  test("--noEmit on one command leaves the build command of the same script seeding", async () => {
    const roots = await rootsOf({
      ...SRC,
      "package.json": pkg("tsc -p tsconfig.build.json && tsc -p tsconfig.check.json --noEmit"),
      "tsconfig.build.json": JSON.stringify({
        compilerOptions: { outDir: "dist" },
        include: ["src/**/*"],
      }),
      "tsconfig.check.json": JSON.stringify({ include: ["src/**/*"] }),
    });
    expect(roots).toContain("src/unused.ts");
  });

  test("control: an emitting build config still seeds its includes", async () => {
    const roots = await rootsOf({
      ...SRC,
      "package.json": pkg("tsc -p tsconfig.build.json"),
      "tsconfig.build.json": JSON.stringify({
        compilerOptions: { outDir: "dist" },
        include: ["src/**/*"],
      }),
    });
    expect(roots).toContain("src/unused.ts");
  });
});
