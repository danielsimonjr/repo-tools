/**
 * `.tsx` input (design section 3.2, "Input files: `.ts` and `.tsx`"). The graph walk, the census
 * walks, the test walk and the resolver read `.tsx` as well as `.ts`. The `.d.ts` rules do not
 * change: the graph walk keeps a `.d.ts` file and the census walks skip it.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  collectCensusFiles,
  getAllSourceTsFiles,
  getAllTestFiles,
  getAllTsFiles,
  walkRepoTsFiles,
} from "../../src/depgraph/scanner.ts";
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

/** The root-relative POSIX form of each absolute path in `paths`. */
function rel(root: string, paths: string[]): string[] {
  return paths.map((p) => p.slice(root.length + 1).replace(/\\/g, "/")).sort();
}

describe("the walks read .tsx", () => {
  test("the graph walk keeps .tsx and .d.ts and skips .test.tsx", () => {
    const root = makeTree(TREE);
    expect(rel(root, getAllTsFiles(join(root, "src")))).toEqual([
      "src/index.ts",
      "src/types.d.ts",
      "src/view.tsx",
    ]);
  });

  test("the source walk keeps .tsx and skips .d.ts and .test.tsx", () => {
    const root = makeTree(TREE);
    expect(rel(root, getAllSourceTsFiles(join(root, "src")))).toEqual([
      "src/index.ts",
      "src/view.tsx",
    ]);
  });

  test("the test walk finds .test.tsx and .spec.tsx", () => {
    const root = makeTree(TREE);
    expect(rel(root, getAllTestFiles(root))).toEqual(["src/view.test.tsx", "tests/app.spec.tsx"]);
  });

  test("the census walks list .tsx and skip .d.ts", () => {
    const root = makeTree(TREE);
    const want = ["src/index.ts", "src/view.test.tsx", "src/view.tsx", "tests/app.spec.tsx"];
    expect(walkRepoTsFiles(root)).toEqual(want);
    expect(collectCensusFiles(root, new Map()).sort()).toEqual(want);
  });
});

describe("a .tsx file in the run", () => {
  test("joins the graph with its edge, its census row and its coverage", async () => {
    const root = makeTree(TREE);
    const r = await runDepgraph(root);
    expect(r.code).toBe(0);
    const graph = r.graph();
    expect(graphFile(graph, "src/view.tsx")?.exports).toEqual(["render"]);
    expect(graphFile(graph, "src/index.ts")?.internalDependencies).toContainEqual(
      expect.objectContaining({ file: "./view.js", imports: ["render"] }),
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
