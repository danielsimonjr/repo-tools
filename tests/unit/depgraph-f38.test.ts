/**
 * Fix F38: a runtime dynamic `import()` edge records the import as `["*"]` (namespace use). The
 * exports of a module that only `import()` loads are then not unreferenced. A type-position
 * `import('./c').C` records the member name (a deliberate difference from the 1.x reader, which
 * recorded no names).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { parseTs } from "../../src/map/parsing.ts";
import { graphFile, makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

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
    const edge = graphFile(result.graph(), "src/b.ts")?.internalDependencies.find(
      (d) => d.file === "src/dyn.ts",
    );
    expect(edge?.imports).toEqual(["*"]);
    expect(edge?.typeOnly).toBe(false);
    expect(result.report("unused-analysis.md")).not.toContain("`value`");
  });

  test("a type-position import() records the member name", () => {
    const edge = parseTs("/** A. */\nexport type T = import('./c.js').C;\n").imports[0];
    expect(edge).toEqual({ specifier: "./c.js", names: ["C"], typeOnly: true });
  });

  test("a runtime import() of a file that a static import names adds the namespace use", () => {
    const mod = parseTs(
      "/** A. */\nimport { one } from './c.js';\n" +
        "export async function f(): Promise<number> {\n" +
        "  return one + (await import('./c.js')).two;\n}\n",
    );
    expect(mod.imports).toEqual([{ specifier: "./c.js", names: ["one", "*"], typeOnly: false }]);
  });
});
