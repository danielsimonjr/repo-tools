/**
 * Fix F17: the classifier fixes for unused and dormant files, one fixture per root kind. A `bin`
 * target, an `exports` subpath entry and a config-seeded file are roots, and an export that only
 * a test uses is not unused. Each test asserts the disposition in `file-inventory.json` and the
 * lists of `unused-analysis.md`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

/** The disposition of each file in `file-inventory.json`. */
function dispositions(text: string): Record<string, string> {
  const inventory = JSON.parse(text) as { files: { file: string; disposition: string }[] };
  return Object.fromEntries(inventory.files.map((f) => [f.file, f.disposition]));
}

/** The text of one `## <title>` section of `unused-analysis.md`. */
function section(report: string, title: string): string {
  const body = report.split(`\n## ${title}\n`)[1];
  if (body === undefined) throw new Error(`no section: ${title}`);
  return body.split("\n## ")[0] ?? "";
}

/** A monorepo whose package `lib` has the extra package.json fields `libPkg`, plus `files`. */
function tree(libPkg: object, files: Record<string, string>): string {
  return makeTree({
    "package.json": '{ "name": "f17", "private": true, "workspaces": ["packages/*"] }',
    "packages/lib/package.json": JSON.stringify({ name: "@f17/lib", version: "1.0.0", ...libPkg }),
    "packages/lib/src/index.ts": "/** Entry. */\nexport const main = 1;\n",
    ...files,
  });
}

describe("F17: classifier roots for unused and dormant files", () => {
  test("bin root: the bin target and its imports are live, not unused", async () => {
    const root = tree(
      { bin: { f17: "./dist/src/cli.js" } },
      {
        "packages/lib/src/cli.ts":
          "/** CLI. */\nimport { parse } from './parse.js';\nparse(process.argv);\n",
        "packages/lib/src/parse.ts":
          "/** Parse. */\nexport function parse(argv: string[]): number {\n  return argv.length;\n}\n",
      },
    );
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const d = dispositions(result.report("file-inventory.json"));
    expect(d["packages/lib/src/cli.ts"]).toBe("build-entry");
    expect(d["packages/lib/src/parse.ts"]).toBe("reachable");
    const report = result.report("unused-analysis.md");
    expect(section(report, "Potentially Unused Files")).not.toContain("cli.ts");
    expect(report).not.toContain("`parse`");
  });

  test("entry root: an exports subpath entry and its re-exported types are public", async () => {
    const root = tree(
      { exports: { ".": "./dist/index.js", "./extra": "./dist/extra.js" } },
      {
        "packages/lib/src/extra.ts":
          "/** Extra. */\nexport type { Shape } from './shape.js';\nexport const extra = 2;\n",
        "packages/lib/src/shape.ts": "/** Shape. */\nexport interface Shape {\n  n: number;\n}\n",
      },
    );
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const d = dispositions(result.report("file-inventory.json"));
    expect(d["packages/lib/src/extra.ts"]).toBe("build-entry");
    expect(d["packages/lib/src/shape.ts"]).toBe("reachable");
    const report = result.report("unused-analysis.md");
    const unusedFiles = section(report, "Potentially Unused Files");
    expect(unusedFiles).not.toContain("extra.ts");
    // A package `src/index.ts` is an entry root even when it re-exports nothing.
    expect(unusedFiles).not.toContain("packages/lib/src/index.ts");
    expect(report).not.toContain("`extra`");
    expect(report).not.toContain("`Shape`");
  });

  test("test-only consumer: a test import is use, and a test-reached file is test-only", async () => {
    const root = tree(
      {},
      {
        "packages/lib/src/index.ts":
          "/** Entry. */\nimport { used } from './tools.js';\nexport const main = used;\n",
        "packages/lib/src/tools.ts":
          "/** Tools. */\nexport const used = 1;\nexport const testedOnly = 2;\n",
        "packages/lib/src/legacy.ts": "/** Legacy. */\nexport const legacy = 3;\n",
        "packages/lib/tests/tools.test.ts":
          "import { testedOnly } from '../src/tools.js';\nimport { legacy } from '../src/legacy.js';\n" +
          "testedOnly; legacy;\n",
      },
    );
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const d = dispositions(result.report("file-inventory.json"));
    expect(d["packages/lib/src/legacy.ts"]).toBe("test-only");
    const report = result.report("unused-analysis.md");
    expect(report).not.toContain("`testedOnly`");
    expect(section(report, "Dormant Files — Test-only (ships nothing, but exercised)")).toContain(
      "`packages/lib/src/legacy.ts`",
    );
  });

  test("config-root seed: a tsc -p tsconfig and a config new URL() seed build roots", async () => {
    const root = tree(
      { scripts: { build: "tsc -p tsconfig.bindings.json" } },
      {
        "packages/lib/tsconfig.bindings.json": '{ "files": ["src/bindings.ts"] }',
        "packages/lib/src/bindings.ts": "/** Bindings. */\nexport const bind = 1;\n",
        "vitest.config.ts":
          "export default {\n  worker: new URL('./packages/lib/src/worker.ts', import.meta.url),\n};\n",
        "packages/lib/src/worker.ts": "/** Worker. */\nexport const work = 1;\n",
        "packages/lib/src/dead.ts": "/** Dead: the control. */\nexport const dead = 1;\n",
      },
    );
    const result = await runDepgraph(root);
    const d = dispositions(result.report("file-inventory.json"));
    expect(d["packages/lib/src/bindings.ts"]).toBe("build-entry");
    expect(d["packages/lib/src/worker.ts"]).toBe("build-entry");
    // The control: a file that no root seeds is an orphan, and the census gate fails the run.
    expect(d["packages/lib/src/dead.ts"]).toBe("orphan");
    expect(result.code).toBe(1);
  });
});
