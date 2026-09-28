/**
 * Fix F43: a self-import in single-package mode. A package that imports its own npm name
 * (`'my-pkg'` or `'my-pkg/sub'`) resolves to its own source: the `exports` target or `main`,
 * mapped from `dist/` to `src/`, else `src/index.ts`, and for a subpath `src/<sub>.ts`, else
 * `src/<sub>/index.ts`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

/** The text of one `## <title>` section of `unused-analysis.md`. */
function section(report: string, title: string): string {
  const body = report.split(`\n## ${title}\n`)[1];
  if (body === undefined) throw new Error(`no section: ${title}`);
  return body.split("\n## ")[0] ?? "";
}

/** The disposition of each file in `file-inventory.json`. */
function dispositions(text: string): Record<string, string> {
  const inventory = JSON.parse(text) as { files: { file: string; disposition: string }[] };
  return Object.fromEntries(inventory.files.map((f) => [f.file, f.disposition]));
}

/** The internal edges of `src/cli.ts` in the core graph. */
function cliEdges(graphText: string): { file: string; imports: string[]; typeOnly: boolean }[] {
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
    const cli = files["src/cli.ts"];
    if (cli) return cli.internalDependencies;
  }
  throw new Error("no src/cli.ts");
}

const CLI =
  "/** CLI. */\nimport { core } from 'PKG';\nimport { helper } from 'PKG/sub';\n" +
  "console.log(core(), helper());\n";
const CORE =
  "/** Core. */\nexport function core(): number {\n  return 1;\n}\n" +
  "export function coreUnused(): number {\n  return 2;\n}\n";
const SUB =
  "/** Sub. */\nexport function helper(): number {\n  return 3;\n}\n" +
  "export function subUnused(): number {\n  return 4;\n}\n";

describe("F43: self-imports in single-package mode", () => {
  test("the exports targets resolve to the source files", async () => {
    const root = makeTree({
      "package.json": JSON.stringify({
        name: "f43",
        version: "1.0.0",
        exports: {
          ".": { types: "./dist/core.d.ts", import: "./dist/core.js" },
          "./sub": "./dist/lib/sub.js",
        },
        bin: { f43: "./dist/cli.js" },
      }),
      "src/cli.ts": CLI.replaceAll("PKG", "f43"),
      "src/core.ts": CORE,
      "src/lib/sub.ts": SUB,
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("orphaned source file");
    const d = dispositions(result.report("file-inventory.json"));
    // The "." target is src/core.ts, and the ./sub target is src/lib/sub.ts, not src/sub.ts.
    expect(d["src/core.ts"]).toBe("build-entry");
    expect(d["src/lib/sub.ts"]).toBe("build-entry");
    expect(d["src/cli.ts"]).toBe("build-entry");
    expect(cliEdges(result.report("dependency-graph.json"))).toEqual([
      { file: "src/core.ts", imports: ["core"], typeOnly: false },
      { file: "src/lib/sub.ts", imports: ["helper"], typeOnly: false },
    ]);
    const dead = section(result.report("unused-analysis.md"), "Exports unreferenced anywhere");
    expect(dead).not.toContain("`core`");
    expect(dead).not.toContain("`helper`");
  });

  test("main resolves the package name", async () => {
    const root = makeTree({
      "package.json": JSON.stringify({
        name: "f43b",
        version: "1.0.0",
        main: "dist/core.js",
        bin: { f43b: "./dist/cli.js" },
      }),
      "src/cli.ts": "/** CLI. */\nimport { core } from 'f43b';\nconsole.log(core());\n",
      "src/core.ts": CORE,
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("ORPHAN");
    const d = dispositions(result.report("file-inventory.json"));
    expect(d["src/core.ts"]).toBe("build-entry");
    expect(d["src/cli.ts"]).toBe("build-entry");
  });

  test("without exports and main: src/index.ts, then src/<sub>.ts or src/<sub>/index.ts", async () => {
    const root = makeTree({
      "package.json": JSON.stringify({
        name: "f43c",
        version: "1.0.0",
        bin: { f43c: "./dist/cli.js" },
      }),
      "src/cli.ts":
        "/** CLI. */\nimport { main } from 'f43c';\nimport { clamp } from 'f43c/util';\n" +
        "import { one } from 'f43c/one';\nconsole.log(main, clamp(1), one);\n",
      "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
      "src/util/index.ts":
        "/** Util. */\nexport function clamp(v: number): number {\n  return v;\n}\n",
      "src/one.ts": "/** One. */\nexport const one = 1;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("orphaned source file");
    expect(result.stdout).toContain("Language: typescript; 4 source files; 1 roots");
  });

  test("a monorepo does not treat its root package name as a self-import", async () => {
    const root = makeTree({
      "package.json": '{ "name": "ws-root", "private": true, "workspaces": ["packages/*"] }',
      "packages/core/package.json": '{ "name": "@f43/core", "version": "1.0.0" }',
      "packages/core/src/index.ts":
        "/** Entry. */\nimport { x } from 'ws-root';\nexport const y = x;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    expect(result.report("dependency-graph.json")).toContain('"ws-root"');
    expect(result.report("dependency-graph.json")).not.toContain('"directory": ""');
  });
});
