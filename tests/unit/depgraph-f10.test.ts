/**
 * Fix F10: a bare side-effect import (`import './x.js';`) loads and runs its target, so test
 * coverage follows a chain of side-effect imports. A namespace import does not carry coverage.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

describe("F10: coverage follows side-effect imports transitively", () => {
  test("a test that imports a covers b and c of the chain a -> b -> c", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f10", "version": "1.0.0" }',
      "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
      "src/a.ts": "/** A. */\nimport './b.js';\nexport const a = 1;\n",
      "src/b.ts": "/** B. */\nimport './c.js';\n",
      "src/c.ts": "/** C. */\n(globalThis as Record<string, unknown>).c = true;\n",
      "src/ns.ts":
        "/** Namespace user. */\nimport * as lib from './lib.js';\nexport const n = lib;\n",
      "src/lib.ts": "/** Lib. */\nexport const lib = 1;\n",
      "tests/a.test.ts":
        "import { a } from '../src/a.js';\nimport { n } from '../src/ns.js';\na; n;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const cov = JSON.parse(result.report("test-coverage.json")) as { testedFiles: string[] };
    expect(cov.testedFiles).toContain("src/a.ts");
    expect(cov.testedFiles).toContain("src/b.ts");
    expect(cov.testedFiles).toContain("src/c.ts");
    // The control: a namespace import is a binding, not a side-effect import.
    expect(cov.testedFiles).not.toContain("src/lib.ts");
  });

  test("a side-effect cycle ends", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f10-cycle", "version": "1.0.0" }',
      "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
      "src/p.ts": "/** P. */\nimport './q.js';\nexport const p = 1;\n",
      "src/q.ts": "/** Q. */\nimport './p.js';\n",
      "tests/p.test.ts": "import { p } from '../src/p.js';\np;\n",
    });
    const result = await runDepgraph(root);
    const cov = JSON.parse(result.report("test-coverage.json")) as { testedFiles: string[] };
    expect(cov.testedFiles).toContain("src/q.ts");
  });
});
