/**
 * Post-release behavior of the 2.0 engine: a skip-list folder under src/ warns, coverage and
 * cycles follow a package-name import, and a workspace subpath uses the exports target.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

/** The internal edges of `path` in the core graph. */
function edges(
  graphText: string,
  path: string,
): { file: string; imports: string[]; typeOnly: boolean }[] {
  const graph = JSON.parse(graphText) as {
    modules: Record<
      string,
      Record<
        string,
        { internalDependencies: { file: string; imports: string[]; typeOnly: boolean }[] }
      >
    >;
  };
  for (const files of Object.values(graph.modules)) {
    const node = files[path];
    if (node) return node.internalDependencies;
  }
  throw new Error(`no ${path}`);
}

describe("a skip-list name under src/", () => {
  test("src/build warns and stays out of the census; a root build/ folder stays silent", async () => {
    const root = makeTree({
      "package.json": '{ "name": "skipbuild", "version": "1.0.0" }',
      "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
      "src/build/hidden.ts": "/** Hidden by the skip list. */\nexport const hidden = 1;\n",
      "build/out.ts": "/** Build output, not source. */\nexport const out = 1;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain(
      "skipped source folder 'src/build' because its name is in the skip list; its files are not in the census",
    );
    expect(result.stderr).not.toContain("skipped source folder 'build'");
    const graph = result.report("dependency-graph.json");
    expect(graph).not.toContain("hidden.ts");
    expect(graph).not.toContain("build/out.ts");
  });
});

describe("package-name imports", () => {
  test("coverage follows a workspace import and its side-effect imports", async () => {
    const root = makeTree({
      "package.json": '{ "private": true, "workspaces": ["packages/*"] }',
      "packages/lib/package.json": JSON.stringify({
        name: "@cov/lib",
        version: "1.0.0",
        exports: { ".": "./dist/index.js" },
      }),
      "packages/lib/src/index.ts": "import './deep.js';\nexport const lib = 1;\n",
      "packages/lib/src/deep.ts": "/** Deep. */\nexport const deep = 1;\n",
      "packages/lib/src/alone.ts": "/** Alone. */\nexport const alone = 1;\n",
      "packages/app/package.json": '{ "name": "@cov/app", "version": "1.0.0" }',
      "packages/app/src/index.ts": "/** App. */\nexport const app = 1;\n",
      "packages/app/tests/app.test.ts": "import { lib } from '@cov/lib';\nlib;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const coverage = JSON.parse(result.report("test-coverage.json")) as { testedFiles: string[] };
    expect(coverage.testedFiles).toContain("packages/lib/src/index.ts");
    expect(coverage.testedFiles).toContain("packages/lib/src/deep.ts");
    expect(coverage.testedFiles).not.toContain("packages/lib/src/alone.ts");
  });

  test("coverage follows a self-import of an exports subpath", async () => {
    const root = makeTree({
      "package.json": JSON.stringify({
        name: "selfcov",
        version: "1.0.0",
        exports: { ".": "./dist/index.js", "./util": "./dist/util.js" },
      }),
      "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
      "src/util.ts": "/** Util. */\nexport const util = 1;\n",
      "tests/util.test.ts": "import { util } from 'selfcov/util';\nutil;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const coverage = JSON.parse(result.report("test-coverage.json")) as { testedFiles: string[] };
    expect(coverage.testedFiles).toEqual(["src/util.ts"]);
  });

  test("a package-name cycle is a runtime component", async () => {
    const root = makeTree({
      "package.json": '{ "private": true, "workspaces": ["packages/*"] }',
      "packages/a/package.json": '{ "name": "@cyc/a", "version": "1.0.0" }',
      "packages/b/package.json": '{ "name": "@cyc/b", "version": "1.0.0" }',
      "packages/a/src/index.ts": "/** A. */\nimport { b } from '@cyc/b';\nexport const a = b;\n",
      "packages/b/src/index.ts": "/** B. */\nimport { a } from '@cyc/a';\nexport const b = a;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const layers = JSON.parse(result.report("dependency-layers.json")) as {
      cyclicComponents: { runtime: { members: string[] }[] };
    };
    expect(layers.cyclicComponents.runtime.map((c) => c.members)).toEqual([
      ["packages/a/src/index.ts", "packages/b/src/index.ts"],
    ]);
  });

  test("a workspace subpath uses the exports target, else <sub>/index.ts", async () => {
    const root = makeTree({
      "package.json": '{ "private": true, "workspaces": ["packages/*"] }',
      "packages/lib/package.json": JSON.stringify({
        name: "@sub/lib",
        version: "1.0.0",
        exports: {
          ".": "./dist/index.js",
          "./sub": "./dist/real/sub.js",
          "./util": "./dist/missing.js",
        },
      }),
      "packages/lib/src/index.ts": "/** Entry. */\nexport const main = 1;\n",
      "packages/lib/src/sub.ts":
        "/** Decoy: the export key, not the target. */\nexport const decoy = 1;\n",
      "packages/lib/src/real/sub.ts": "/** Target. */\nexport const helper = 1;\n",
      "packages/lib/src/util/index.ts": "/** Util index. */\nexport const util = 1;\n",
      "packages/app/package.json": '{ "name": "@sub/app", "version": "1.0.0" }',
      "packages/app/src/main.ts":
        "/** App. */\nimport { helper } from '@sub/lib/sub';\nimport { util } from '@sub/lib/util';\n" +
        "export const app = helper + util;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    expect(edges(result.report("dependency-graph.json"), "packages/app/src/main.ts")).toEqual([
      { file: "packages/lib/src/real/sub.ts", imports: ["helper"], typeOnly: false },
      { file: "packages/lib/src/util/index.ts", imports: ["util"], typeOnly: false },
    ]);
  });
});
