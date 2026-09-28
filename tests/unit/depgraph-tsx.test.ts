/**
 * `.tsx` input (design section 3.2, "Input files: `.ts` and `.tsx`"). The graph walk, the census
 * walks, the test walk and the resolver read `.tsx` as well as `.ts`. The `.d.ts` rules do not
 * change: the graph walk keeps a `.d.ts` file and the census walks skip it.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { graphFile, makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

const TREE = {
  "package.json": JSON.stringify({ name: "tsx", version: "1.0.0" }),
  "src/index.ts": "/** Entry. */\nexport { render } from './view.js';\n",
  "src/view.tsx": "/** View. */\nexport function render(): string {\n  return 'v';\n}\n",
  "src/types.d.ts": "declare const g: number;\n",
  "src/view.test.tsx": "import { render } from './view.js';\nrender();\n",
  "tests/app.spec.tsx": "import { render } from '../src/view.js';\nrender();\n",
};

describe("a .tsx file in the run", () => {
  test("joins the graph with its edge, its census row and its coverage", async () => {
    const root = makeTree(TREE);
    const r = await runDepgraph(root);
    expect(r.code).toBe(0);
    const graph = r.graph();
    expect(graphFile(graph, "src/view.tsx")?.exports).toEqual(["render"]);
    expect(graphFile(graph, "src/index.ts")?.internalDependencies).toContainEqual(
      expect.objectContaining({ file: "src/view.tsx", imports: ["render"], typeOnly: false }),
    );
    const inventory = JSON.parse(r.report("file-inventory.json")) as {
      files: { file: string; area: string; disposition: string }[];
    };
    const row = (file: string) => inventory.files.find((f) => f.file === file);
    expect(row("src/view.tsx")?.disposition).toBe("reachable");
    expect(row("src/view.test.tsx")?.area).toBe("tests");
    const coverage = JSON.parse(r.report("test-coverage.json")) as { testedFiles: string[] };
    expect(coverage.testedFiles).toContain("src/view.tsx");
    expect(r.stderr).not.toContain("not in the census");
  });

  test("the reports name a .tsx file without its extension, as they name a .ts file", async () => {
    const root = makeTree({
      ...TREE,
      "src/view.tsx": "export function render(): string {\n  return 'v';\n}\n",
    });
    const r = await runDepgraph(root);
    const md = r.report("DEPENDENCY_GRAPH.md");
    expect(md).toContain("### `src/view.tsx` - view module");
    expect(md).toContain("| `src/view` |");
    expect(md).not.toContain("view.tsx module");
  });
});
