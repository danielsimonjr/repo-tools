/**
 * Fix F30: a relative specifier resolves to a `.tsx` file and to a directory index. `./Z`
 * resolves to `Z/index.ts` (not to a missing `Z.ts`), and `./view` to `view.tsx`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { resolveCandidates, resolvePath } from "../../src/depgraph/resolver.ts";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F30: .tsx files and directory indexes", () => {
  test("resolvePath picks the first known candidate", () => {
    const known = new Set(["src/Z/index.ts", "src/view.tsx", "src/W/index.tsx", "src/index.ts"]);
    expect(resolvePath("src/a.ts", "./Z", known)).toBe("src/Z/index.ts");
    expect(resolvePath("src/a.ts", "./view", known)).toBe("src/view.tsx");
    expect(resolvePath("src/a.ts", "./view.js", known)).toBe("src/view.tsx");
    expect(resolvePath("src/a.ts", "./W", known)).toBe("src/W/index.tsx");
    expect(resolvePath("src/Z/index.ts", "..", known)).toBe("src/index.ts");
    // No known file: the first candidate, as before the fix.
    expect(resolvePath("src/a.ts", "./Z")).toBe("src/Z.ts");
    expect(resolvePath("src/a.ts", "./missing", known)).toBe("src/missing.ts");
    expect(resolveCandidates("src/a.ts", "./Z")).toEqual([
      "src/Z.ts",
      "src/Z.tsx",
      "src/Z/index.ts",
      "src/Z/index.tsx",
    ]);
    expect(resolveCandidates("x/a.ts", "../dist/b.js")).toEqual(["src/b.ts", "src/b.tsx"]);
  });

  test("an import of a directory lands on its index.ts", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f30", "version": "1.0.0" }',
      "src/index.ts": "/** Entry. */\nimport { z } from './Z';\nexport const main = z;\n",
      "src/Z/index.ts": "/** Z. */\nimport { main } from '..';\nexport const z = 1;\nmain;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const graph = result.graph() as unknown as {
      dependencyGraph: { cyclicComponents: { runtime: { members: string[] }[] } };
    };
    expect(graph.dependencyGraph.cyclicComponents.runtime.map((c) => c.members)).toEqual([
      ["src/Z/index.ts", "src/index.ts"],
    ]);
    expect(result.report("unused-analysis.md")).toContain("- **Potentially unused files**: 0\n");
  });
});
