/**
 * Fix F23: an `import()` with a backtick-quoted relative specifier is a dependency edge when the
 * specifier holds no `${`. A template with a substitution names no fixed file, so it gives no
 * edge.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { graphFile, makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F23: backtick specifiers in import()", () => {
  test("import(`./x.js`) gives an edge; a template with a substitution gives none", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f23", "version": "1.0.0" }',
      "src/index.ts":
        "/** Entry. */\nexport async function load(name: string): Promise<unknown[]> {\n" +
        "  const fixed = await import(`./x.js`);\n" +
        // `import(`./${name}.js`)`, written without a literal `${` for the linter.
        `  const dynamic = await import(\`./${"$"}{name}.js\`);\n` +
        "  return [fixed, dynamic];\n}\n",
      "src/x.ts": "/** X. */\nexport const x = 1;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const edges = graphFile(result.graph(), "src/index.ts")?.internalDependencies ?? [];
    expect(edges.map((e) => e.file)).toEqual(["./x.js"]);
  });
});
