/**
 * Fix F38: a runtime dynamic `import()` edge records the import as `["*"]` (namespace use). The
 * exports of a module that only `import()` loads are then not "unreferenced anywhere".
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseFile } from "../../src/depgraph/parser.ts";
import type { WorkspacePackage } from "../../src/depgraph/types.ts";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

const none = new Map<string, WorkspacePackage>();

describe("F38: a runtime import() is a namespace use", () => {
  test("the exports of a module loaded only through import() are not unreferenced", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f38", "version": "1.0.0" }',
      "src/index.ts": "/** Entry. */\nexport { load } from './b.js';\n",
      "src/b.ts":
        "/** B. */\nexport async function load(): Promise<string> {\n" +
        "  const mod = await import('./dyn.js');\n  return mod.value;\n}\n",
      "src/dyn.ts": "/** Dyn. */\nexport const value = 'v';\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const edge = result
      .graph()
      .modules.root?.["src/b.ts"]?.internalDependencies.find((d) => d.file === "./dyn.js");
    expect(edge?.imports).toEqual(["*"]);
    expect(edge?.typeOnly).toBeUndefined();
    expect(result.report("unused-analysis.md")).not.toContain("`value`");
  });

  test("a type-position import() records no names", () => {
    const root = makeTree({
      "src/a.ts": "/** A. */\nexport type T = import('./c.js').C;\n",
      "src/c.ts": "/** C. */\nexport interface C {\n  n: number;\n}\n",
    });
    const parsed = parseFile({ root, workspaces: none }, join(root, "src/a.ts"));
    expect(parsed.internalDependencies).toEqual([{ file: "./c.js", imports: [], typeOnly: true }]);
  });

  test("a runtime import() of a file that a static import names adds the namespace use", () => {
    const root = makeTree({
      "src/a.ts":
        "/** A. */\nimport { one } from './c.js';\n" +
        "export async function f(): Promise<number> {\n" +
        "  return one + (await import('./c.js')).two;\n}\n",
      "src/c.ts": "/** C. */\nexport const one = 1;\nexport const two = 2;\n",
    });
    const parsed = parseFile({ root, workspaces: none }, join(root, "src/a.ts"));
    expect(parsed.internalDependencies).toEqual([
      { file: "./c.js", imports: ["one", "*"], typeOnly: false },
    ]);
  });
});
