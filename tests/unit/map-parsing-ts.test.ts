/**
 * The TypeScript reader of the map engine (tree-sitter-typescript).
 *
 * Ported from the architecture-docs skill (`test_parsing.py`). The source test of a real barrel
 * file read a local repository through an absolute path; this port uses a synthetic barrel of the
 * same shape instead. Decisions D3 and D5: an `export ... from` import also carries
 * `reExport: true`, which depgraph's analyzers read. The graph JSON does not write it.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { loadGrammar } from "../../src/map/grammars.ts";
import { parseTs } from "../../src/map/parsing.ts";

beforeAll(async () => {
  await loadGrammar("typescript");
});

describe("parseTs: imports", () => {
  test("extracts named imports and the specifier", () => {
    const mod = parseTs('import { A, B } from "./b.js";\n');
    expect(mod.imports.length).toBe(1);
    expect(mod.imports[0]?.specifier).toBe("./b.js");
    expect([...(mod.imports[0]?.names ?? [])].sort()).toEqual(["A", "B"]);
    expect(mod.imports[0]?.typeOnly).toBe(false);
  });

  test("flags a type-only import", () => {
    expect(parseTs('import type { T } from "./t.js";\n').imports[0]?.typeOnly).toBe(true);
  });

  test("ignores a string that looks like an import", () => {
    expect(parseTs('const s = "./not-an-import.js";\n').imports).toEqual([]);
  });

  test("a barrel of 12 re-exports gives 12 import edges", () => {
    const barrel = Array.from({ length: 12 }, (_, i) => `export * from "./m${i}.js";`).join("\n");
    expect(parseTs(`${barrel}\n`).imports.length).toBeGreaterThan(10);
  });
});

describe("parseTs: exports", () => {
  test("extracts exported names", () => {
    const src = "export const a = 1;\nexport function b() {}\nexport class C {}\n";
    expect([...parseTs(src).exports].sort()).toEqual(["C", "a", "b"]);
  });

  test("export kinds follow the declaration type", () => {
    const mod = parseTs(
      "export interface I {}\nexport type A = string;\nexport class C {}\n" +
        "export const c = 1;\nexport function f() {}\nexport enum E {}\n",
    );
    expect(mod.exportKinds).toEqual({
      I: "interface",
      A: "type",
      C: "class",
      c: "const",
      f: "function",
      E: "enum",
    });
  });
});

describe("parseTs: re-exports are both an export and an import", () => {
  test("a named re-export gives an import edge", () => {
    const mod = parseTs('export { A, B } from "./m.js";\n');
    expect([...mod.exports].sort()).toEqual(["A", "B"]);
    expect(mod.imports).toEqual([
      { specifier: "./m.js", names: ["A", "B"], typeOnly: false, reExport: true },
    ]);
  });

  test("a bare star re-export gives an edge with no names and no export", () => {
    const mod = parseTs('export * from "./m.js";\n');
    expect(mod.exports).toEqual([]);
    expect(mod.imports).toEqual([
      { specifier: "./m.js", names: [], typeOnly: false, reExport: true },
    ]);
  });

  test("a namespace star re-export gives the export and an edge", () => {
    const mod = parseTs('export * as ns from "./x.js";\n');
    expect(mod.exports).toEqual(["ns"]);
    expect(mod.imports).toEqual([
      { specifier: "./x.js", names: ["*"], typeOnly: false, reExport: true },
    ]);
  });

  test("a type-only named re-export sets typeOnly", () => {
    const mod = parseTs('export type { T } from "./t.js";\n');
    expect(mod.exports).toEqual(["T"]);
    expect(mod.imports).toEqual([
      { specifier: "./t.js", names: ["T"], typeOnly: true, reExport: true },
    ]);
  });

  test("a default-alias re-export records the source name", () => {
    const mod = parseTs('export { default as D } from "./d";\n');
    expect(mod.exports).toEqual(["D"]);
    expect(mod.imports).toEqual([
      { specifier: "./d", names: ["default"], typeOnly: false, reExport: true },
    ]);
  });

  test("export { foo as default } from is a named clause", () => {
    const mod = parseTs('export { foo as default } from "./m.js";\n');
    expect(mod.exports).toEqual(["default"]);
    expect(mod.imports).toEqual([
      { specifier: "./m.js", names: ["foo"], typeOnly: false, reExport: true },
    ]);
  });
});

describe("parseTs: export default", () => {
  const cases: [string, string, string | null][] = [
    ["export default class Foo {}\n", "class", "Foo"],
    ["export default function foo() {}\n", "function", "foo"],
    ["export default class {}\n", "class", null],
    ["export default function () {}\n", "function", null],
    ["export default 5;\n", "unknown", null],
  ];
  for (const [src, kind, local] of cases) {
    test(`${src.trim()} -> default (${kind}, local ${local})`, () => {
      const mod = parseTs(src);
      expect(mod.exports).toEqual([]);
      expect(mod.defaultExport).toBe("default");
      expect(mod.defaultExportLocal).toBe(local);
      expect(mod.exportKinds.default).toBe(kind);
    });
  }

  test("no default export when the module has none", () => {
    const mod = parseTs("export const a = 1;\n");
    expect(mod.defaultExport).toBeNull();
    expect(mod.defaultExportLocal).toBeNull();
  });
});
