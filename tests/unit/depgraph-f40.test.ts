/**
 * Fix F40: a member call on a dynamic import is a runtime edge. `import('./x').then<T>(cb)` (a
 * member name, a type-argument list, then a call) and `import('./x').then(cb)` are runtime;
 * `type T = import('./x').Name` stays type-only and records the member name.
 */
import { describe, expect, test } from "bun:test";
import { parseTs } from "../../src/map/parsing.ts";

/** The `typeOnly` flag of the `./c.js` edge when the source holds `body`. */
function edgeKind(body: string): boolean | undefined {
  return parseTs(body).imports.find((i) => i.specifier === "./c.js")?.typeOnly;
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

  test("type T = import().Name stays type-only and records the name", () => {
    const edge = parseTs("export type T = import('./c.js').C;\n").imports[0];
    expect(edge).toEqual({ specifier: "./c.js", names: ["C"], typeOnly: true });
  });

  test("a type-argument list with no call after it stays type-only", () => {
    const edge = parseTs("type T = import('./c.js').Box<number>;\n").imports[0];
    expect(edge).toEqual({ specifier: "./c.js", names: ["Box"], typeOnly: true });
  });
});
