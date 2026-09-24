/**
 * Fix F40: a member call on a dynamic import is a runtime edge. `import('./x').then<T>(cb)` (a
 * member name, a type-argument list, then a call) and `import('./x').then(cb)` are runtime;
 * `type T = import('./x').Name` stays type-only. It corrects fix F25.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { isTypePositionImport, parseFile } from "../../src/depgraph/parser.ts";
import type { WorkspacePackage } from "../../src/depgraph/types.ts";
import { makeTree, removeTrees } from "./tree.ts";

afterAll(removeTrees);

const none = new Map<string, WorkspacePackage>();

/** The `typeOnly` flag of the one edge of `a.ts` to `./c.js`, when `a.ts` holds `body`. */
function edgeKind(body: string): boolean | undefined {
  const root = makeTree({
    "src/a.ts": `/** A. */\n${body}`,
    "src/c.ts": "/** C. */\nexport interface C {\n  n: number;\n}\nexport const v = 1;\n",
  });
  const parsed = parseFile({ root, workspaces: none }, join(root, "src/a.ts"));
  const edges = parsed.internalDependencies.filter((d) => d.file === "./c.js");
  expect(edges.length).toBe(1);
  return edges[0]?.typeOnly;
}

describe("F40: a member call on import() is runtime", () => {
  test("import().then<T>(cb) is a runtime edge", () => {
    expect(edgeKind("export const p = import('./c.js').then<number>((m) => m.v);\n")).toBe(false);
  });

  test("a nested type-argument list before the call is a runtime edge", () => {
    expect(
      edgeKind("export const p = import('./c.js').then<Map<string, number>>((m) => new Map());\n"),
    ).toBe(false);
  });

  test("a function type or an object type in the type arguments is a runtime edge", () => {
    expect(
      edgeKind("export const p = import('./c.js').then<() => void>((m) => () => m.v);\n"),
    ).toBe(false);
    expect(edgeKind("export const p = import('./c.js').then<{ v: number }>((m) => m);\n")).toBe(
      false,
    );
  });

  test("import().then(cb) is a runtime edge", () => {
    expect(edgeKind("export const p = import('./c.js').then((m) => m.v);\n")).toBe(false);
  });

  test("type T = import().Name stays type-only", () => {
    expect(edgeKind("export type T = import('./c.js').C;\n")).toBe(true);
  });

  test("a type-argument list with no call after it stays type-only", () => {
    const code = "type T = import('./c.js').Box<number>;";
    const start = code.indexOf("import");
    expect(isTypePositionImport(code, start, code.indexOf(")") + 1)).toBe(true);
  });
});
