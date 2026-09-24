/**
 * Fix F7: an import of compiled output (`dist/`) lands on its source file (`src/`), and so does
 * the `dist/src/` form of a build that mirrors the source tree. A `bin` that names
 * `dist/src/cli.js` seeds `src/cli.ts` as a build root.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { distToSrc } from "../../src/depgraph/resolver.ts";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

/** The tested and untested file lists of `test-coverage.json`. */
function coverage(text: string): { testedFiles: string[]; untestedFiles: string[] } {
  return JSON.parse(text) as { testedFiles: string[]; untestedFiles: string[] };
}

describe("F7: dist/ imports land on src/", () => {
  test("distToSrc maps dist/ and dist/src/, and keeps a dist/ folder inside src/", () => {
    expect(distToSrc("dist/x.ts")).toBe("src/x.ts");
    expect(distToSrc("dist/src/cli.ts")).toBe("src/cli.ts");
    expect(distToSrc("packages/a/dist/lib.ts")).toBe("packages/a/src/lib.ts");
    expect(distToSrc("src/dist/z.ts")).toBe("src/dist/z.ts");
    expect(distToSrc("src/a.ts")).toBe("src/a.ts");
  });

  test("single package: test imports of dist/x.js and dist/src/y.js cover src/", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f7", "version": "1.0.0" }',
      "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
      "src/x.ts": "/** X. */\nexport function x(): number { return 1; }\n",
      "src/y.ts": "/** Y. */\nexport function y(): number { return 2; }\n",
      "tests/x.test.ts": "import { x } from '../dist/x.js';\nx();\n",
      "tests/y.test.ts": "import { y } from '../dist/src/y.js';\ny();\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const cov = coverage(result.report("test-coverage.json"));
    expect(cov.testedFiles).toContain("src/x.ts");
    expect(cov.testedFiles).toContain("src/y.ts");
    const unused = result.report("unused-analysis.md");
    expect(unused).not.toContain("`src/x.ts`");
    expect(unused).not.toContain("`src/y.ts`");
  });

  test("monorepo: a bin of dist/src/cli.js is a root, and a dist/ import lands on src/", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f7-mono", "private": true, "workspaces": ["packages/*"] }',
      "packages/app/package.json":
        '{ "name": "@f7/app", "version": "1.0.0", "bin": { "app": "./dist/src/cli.js" } }',
      "packages/app/src/index.ts": "/** Entry. */\nexport const app = 1;\n",
      "packages/app/src/cli.ts": "/** CLI. */\nimport { helper } from './helper.js';\nhelper();\n",
      "packages/app/src/helper.ts": "/** Helper. */\nexport function helper(): void {}\n",
      "packages/app/src/lib.ts": "/** Lib. */\nexport function lib(): number { return 1; }\n",
      "packages/app/tests/lib.test.ts": "import { lib } from '../dist/lib.js';\nlib();\n",
      "packages/other/package.json": '{ "name": "@f7/other", "version": "1.0.0" }',
      "packages/other/src/index.ts": "/** Other. */\nexport const other = 1;\n",
    });
    const result = await runDepgraph(root, ["--all"]);
    const cov = coverage(result.report("test-coverage.json"));
    expect(cov.testedFiles).toContain("packages/app/src/lib.ts");
    const inventory = JSON.parse(result.report("file-inventory.json")) as {
      files: { file: string; disposition: string }[];
    };
    const disposition = (path: string): string | undefined =>
      inventory.files.find((f) => f.file === path)?.disposition;
    expect(disposition("packages/app/src/cli.ts")).toBe("build-entry");
    expect(disposition("packages/app/src/helper.ts")).toBe("reachable");
  });
});
