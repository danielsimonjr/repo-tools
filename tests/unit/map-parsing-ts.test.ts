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
import { RUNTIME_IMPORTS, TYPE_IMPORTS } from "./dynamic-imports.ts";

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

describe("parseTs: dynamic imports are edges", () => {
  test("a literal relative import() is an edge; a substitution or a package is not", () => {
    const mod = parseTs(
      [
        "const x = 'y';",
        "await import('./a.js');",
        "await import(`./b.js`);",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is TypeScript source with a template literal.
        "await import(`./${x}.js`);",
        "await import('pkg');",
        "",
      ].join("\n"),
    );
    expect(mod.dynamicImports).toEqual(["./a.js", "./b.js"]);
    expect(mod.imports).toEqual([
      { specifier: "./a.js", names: ["*"], typeOnly: false },
      { specifier: "./b.js", names: ["*"], typeOnly: false },
    ]);
  });

  for (const [name, body] of Object.entries(RUNTIME_IMPORTS)) {
    test(`runtime: ${name}`, () => {
      const edge = parseTs(body).imports.find((i) => i.specifier === "./c.js");
      expect(edge).toEqual({ specifier: "./c.js", names: ["*"], typeOnly: false });
    });
  }

  for (const [name, body] of Object.entries(TYPE_IMPORTS)) {
    test(`type-only: ${name}`, () => {
      const edge = parseTs(body).imports.find((i) => i.specifier === "./c.js");
      expect(edge?.typeOnly).toBe(true);
      if (name === "typeof import()") expect(edge?.names).toEqual([]);
      else expect(edge?.names).toEqual(["C"]);
    });
  }

  test("import().then<T>(cb) is a runtime edge", () => {
    const edge = parseTs("export const p = import('./c.js').then<number>((m) => m.v);\n")
      .imports[0];
    expect(edge).toEqual({ specifier: "./c.js", names: ["*"], typeOnly: false });
  });

  test("a type argument with no call stays type-only and records the name", () => {
    const edge = parseTs("export type T = import('./c.js').Box<number>;\n").imports[0];
    expect(edge).toEqual({ specifier: "./c.js", names: ["Box"], typeOnly: true });
  });

  test("a runtime import() beside a type-only import adds a runtime edge", () => {
    const mod = parseTs(
      "import type { C } from './c.js';\n" +
        "export async function f(): Promise<C> {\n  return (await import('./c.js')).make();\n}\n",
    );
    expect(mod.imports).toEqual([
      { specifier: "./c.js", names: ["C"], typeOnly: true },
      { specifier: "./c.js", names: ["*"], typeOnly: false },
    ]);
  });

  test("a runtime import() of a statically imported file adds * to that edge", () => {
    const mod = parseTs(
      "import { one } from './c.js';\n" +
        "export async function f(): Promise<number> {\n" +
        "  return one + (await import('./c.js')).two;\n}\n",
    );
    expect(mod.imports).toEqual([{ specifier: "./c.js", names: ["one", "*"], typeOnly: false }]);
  });

  test("a bare import and a runtime import() are one edge that records *", () => {
    const mod = parseTs("import './c.js';\nexport const p = import('./c.js');\n");
    expect(mod.imports).toEqual([
      { specifier: "./c.js", names: ["*"], typeOnly: false, sideEffect: true },
    ]);
  });
});

describe("parseTs: a bodiless export function is not an export", () => {
  test("an overload signature is not a second export of the implementation", () => {
    const mod = parseTs(
      "export function f(x: string): string;\n" +
        "export function f(x: string): string { return x; }\n",
    );
    expect(mod.exports).toEqual(["f"]);
    expect(mod.exportKinds.f).toBe("function");
  });

  test("an ambient declaration in a declaration file is not an export", () => {
    const mod = parseTs("export function f(): void;\nexport declare function g(): void;\n");
    expect(mod.exports).toEqual([]);
    expect(mod.defaultExport).toBeNull();
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
