/**
 * Fix F25: a dynamic `import()` is a runtime edge unless it is in a type position. A type position
 * is defined by exclusion: `import()` after `typeof`, or `import('...').Name` that no call
 * follows (a type alias, an annotation, an interface member). Every other `import()` is a runtime
 * edge.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseFile } from "../../src/depgraph/parser.ts";
import type { WorkspacePackage } from "../../src/depgraph/types.ts";
import { RUNTIME_IMPORTS, TYPE_IMPORTS } from "./dynamic-imports.ts";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

const none = new Map<string, WorkspacePackage>();

/** The `typeOnly` flag of the one edge of `a.ts` to `./c.js`, when `a.ts` holds `body`. */
function edgeKind(body: string): boolean | undefined {
  const root = makeTree({
    "src/a.ts": `/** A. */\n${body}`,
    "src/c.ts":
      "/** C. */\nexport interface C {\n  n: number;\n}\nexport function run(): void {}\n",
  });
  const parsed = parseFile({ root, workspaces: none }, join(root, "src/a.ts"));
  const edges = parsed.internalDependencies.filter((d) => d.file === "./c.js");
  expect(edges.length).toBe(1);
  return edges[0]?.typeOnly;
}

describe("F25: runtime and type-position import()", () => {
  for (const [name, body] of Object.entries(RUNTIME_IMPORTS)) {
    test(`runtime: ${name}`, () => {
      expect(edgeKind(body)).toBe(false);
    });
  }
  for (const [name, body] of Object.entries(TYPE_IMPORTS)) {
    test(`type-only: ${name}`, () => {
      expect(edgeKind(body)).toBe(true);
    });
  }

  test("a runtime import() of a file that a type-only import also names adds a runtime edge", () => {
    const root = makeTree({
      "src/a.ts":
        "/** A. */\nimport type { C } from './c.js';\n" +
        "export async function f(): Promise<C> {\n  return (await import('./c.js')).make();\n}\n",
      "src/c.ts": "/** C. */\nexport interface C {\n  n: number;\n}\n",
    });
    const parsed = parseFile({ root, workspaces: none }, join(root, "src/a.ts"));
    const kinds = parsed.internalDependencies
      .filter((d) => d.file === "./c.js")
      .map((d) => Boolean(d.typeOnly));
    expect(kinds).toEqual([true, false]);
  });

  test("await import() in a and import './a.js' in b is a runtime cycle", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f25", "version": "1.0.0" }',
      "src/index.ts": "/** Entry. */\nexport { load } from './a.js';\n",
      "src/a.ts":
        "/** A. */\nexport async function load(): Promise<unknown> {\n" +
        "  return await import('./b.js');\n}\n",
      "src/b.ts": "/** B. */\nimport './a.js';\nexport const b = 1;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("(1 runtime, 0 type-only)");
  });
});
