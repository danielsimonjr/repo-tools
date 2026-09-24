/**
 * Fix F27: comment removal does not cut `//` inside a string literal. A URL string on the same
 * line as an import must not remove the import, and a `/*` inside a string must not remove the
 * lines after it.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { classifyDefiner } from "../../src/depgraph/duplicates.ts";
import type { ParsedFile } from "../../src/depgraph/types.ts";
import { graphFile, makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F27: comment removal is string-aware", () => {
  test("a `//` or `/*` inside a string does not remove an import", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f27", "version": "1.0.0" }',
      "src/index.ts":
        "/** Entry. */\n" +
        "import { a } from './a.js'; const u = 'http://x';\n" +
        "export async function load(): Promise<unknown> {\n" +
        "  const v = 'http://x'; const b = await import('./b.js');\n" +
        "  return [a, u, v, b];\n}\n" +
        "export const glob = 'src/*';\n" +
        "import { c } from './c.js';\n/** K. */\nexport const k = c;\n",
      "src/a.ts": "/** A. */\nexport const a = 1;\n",
      "src/b.ts": "/** B. */\nexport const b = 2;\n",
      "src/c.ts": "/** C. */\nexport const c = 3;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const edges = graphFile(result.graph(), "src/index.ts")?.internalDependencies ?? [];
    expect(edges.map((e) => e.file).sort()).toEqual(["./a.js", "./b.js", "./c.js"]);
  });

  test("the duplicate classifier keeps an import after a URL string", () => {
    const raw =
      "const u = 'http://x'; import { base } from './b.js';\nexport const alias = base;\n";
    const file = { path: "src/c.ts" } as ParsedFile;
    expect(classifyDefiner(file, "alias", "constant", [], () => raw).tag).toBe("ALIAS_DELEGATION");
  });
});
