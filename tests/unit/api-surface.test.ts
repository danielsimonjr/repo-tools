import { describe, expect, it } from "bun:test";
import {
  DEFAULT_STABILITY_TAGS,
  type ExportDetail,
  extractExportDetails,
  extractReExports,
  type ReExport,
  resolveSurface,
  type SurfaceSymbol,
} from "../../src/depgraph/api-surface.ts";

const one = (src: string, name: string) => {
  const hits = extractExportDetails(src).filter((d) => d.name === name);
  expect(hits, `expected exactly one declaration named ${name}`).toHaveLength(1);
  return hits[0] as ExportDetail;
};

describe("extractExportDetails — signatures", () => {
  it("reads an async generic function with defaults that contain brackets and quotes", () => {
    const src = [
      "export async function load<T extends { id: string }>(",
      "  path: string = ')',",
      "  opts: { mode: '{' | '}' } = { mode: '{' },",
      "): Promise<T[]> {",
      "  return [];",
      "}",
    ].join("\n");
    const d = one(src, "load");
    expect(d.kind).toBe("function");
    expect(d.async).toBe(true);
    expect(d.typeParams).toBe("<T extends { id: string }>");
    expect(d.params).toBe("path: string = ')', opts: { mode: '{' | '}' } = { mode: '{' }");
    expect(d.returnType).toBe("Promise<T[]>");
    expect(d.line).toBe(1);
  });

  it("reads an object-literal return type and stops at the body brace", () => {
    const src = [
      "export function pair(R: number): {",
      "  residual: number;",
      "  evaluate: (x: number) => Promise<number>;",
      "} {",
      "  return null as never;",
      "}",
    ].join("\n");
    const d = one(src, "pair");
    expect(d.async).toBe(false);
    expect(d.params).toBe("R: number");
    expect(d.returnType).toBe("{ residual: number; evaluate: (x: number) => Promise<number>; }");
  });

  it("records a missing return annotation as null, not as an empty string", () => {
    const d = one("export function f(a: number) { return a; }", "f");
    expect(d.returnType).toBeNull();
    expect(d.params).toBe("a: number");
  });

  it("reads a const arrow export as a function-valued const", () => {
    const d = one("export const g = async <K>(k: K, n = 2): Promise<K> => k;", "g");
    expect(d.kind).toBe("const");
    expect(d.async).toBe(true);
    expect(d.typeParams).toBe("<K>");
    expect(d.params).toBe("k: K, n = 2");
    expect(d.returnType).toBe("Promise<K>");
  });

  it("gives a plain const no signature", () => {
    const d = one("export const N: number = (1 + 2) * 3;", "N");
    expect(d.kind).toBe("const");
    expect(d.params).toBeNull();
    expect(d.returnType).toBeNull();
  });

  it("records each declaration kind", () => {
    const src = [
      "export class C {}",
      "export interface I { a: number }",
      "export type T = string;",
      "export enum E { A }",
      "export declare function d(x: number): void;",
    ].join("\n");
    const kinds = Object.fromEntries(extractExportDetails(src).map((d) => [d.name, d.kind]));
    expect(kinds).toEqual({ C: "class", I: "interface", T: "type", E: "enum", d: "function" });
  });
});

describe("extractExportDetails — what is NOT an export", () => {
  it("ignores exports inside comments, strings, template literals and regex literals", () => {
    const src = [
      "// export function commented() {}",
      "/* export function blockCommented() {} */",
      "const s = 'export function inString() {}';",
      "const t = `",
      "export function inTemplate() {}",
      "`;",
      "const re = /['\"`]/g;",
      "export function real(): void {}",
    ].join("\n");
    expect(extractExportDetails(src).map((d) => d.name)).toEqual(["real"]);
  });

  it("ignores declarations that are not exported and not at the top level", () => {
    const src = [
      "function hidden() {}",
      "namespace N {",
      "  export function nested() {}",
      "}",
      "namespace M {",
      "export function unindented() {}",
      "}",
      "export function shown() {}",
    ].join("\n");
    expect(extractExportDetails(src).map((d) => d.name)).toEqual(["shown"]);
  });

  it("maps a local export list onto the declarations it names", () => {
    const src = [
      "function a(x: number): number { return x; }",
      "const b = 1;",
      "export { a, b as bee };",
    ].join("\n");
    const names = extractExportDetails(src).map((d) => `${d.name}:${d.kind}:${d.params ?? "-"}`);
    expect(names).toEqual(["a:function:x: number", "bee:const:-"]);
  });
});

describe("extractExportDetails — JSDoc and stability", () => {
  it("takes the stability tag and summary from the ATTACHED block only", () => {
    const src = [
      "/**",
      " * A detached block.",
      " * @internal",
      " */",
      "const spacer = 0;",
      "",
      "/**",
      " * Loads the thing.",
      " *",
      " * More detail.",
      " * @public",
      " */",
      "export function tagged() {}",
      "",
      "export function untagged() {}",
    ].join("\n");
    const tagged = one(src, "tagged");
    expect(tagged.documented).toBe(true);
    expect(tagged.stability).toBe("public");
    expect(tagged.summary).toBe("Loads the thing.");
    const untagged = one(src, "untagged");
    expect(untagged.documented).toBe(false);
    expect(untagged.stability).toBeNull();
    expect(untagged.summary).toBeNull();
  });

  it("matches whole tags: @public-new is not @public unless the tag list says so", () => {
    const src = "/** Doc. @public-new */\nexport function f() {}";
    expect(one(src, "f").stability).toBeNull();
    const custom = extractExportDetails(src, {
      stabilityTags: [...DEFAULT_STABILITY_TAGS, "public-new"],
    });
    expect((custom[0] as ExportDetail).stability).toBe("public-new");
  });

  it("a plain // comment above a declaration is not documentation", () => {
    expect(one("// looks like doc\nexport function f() {}", "f").documented).toBe(false);
  });
});

describe("extractReExports", () => {
  it("reads named, renamed, type-only, star and namespace re-exports", () => {
    const src = [
      "export { a, b as c } from './x.js';",
      "export type { T } from './types.js';",
      "export { type U, v } from './mixed.js';",
      "export * from './all.js';",
      "export * as ns from './space.js';",
    ].join("\n");
    expect(extractReExports(src)).toEqual([
      {
        from: "./x.js",
        star: false,
        namespace: null,
        names: [
          { exported: "a", local: "a", typeOnly: false },
          { exported: "c", local: "b", typeOnly: false },
        ],
      },
      {
        from: "./types.js",
        star: false,
        namespace: null,
        names: [{ exported: "T", local: "T", typeOnly: true }],
      },
      {
        from: "./mixed.js",
        star: false,
        namespace: null,
        names: [
          { exported: "U", local: "U", typeOnly: true },
          { exported: "v", local: "v", typeOnly: false },
        ],
      },
      { from: "./all.js", star: true, namespace: null, names: [] },
      { from: "./space.js", star: true, namespace: "ns", names: [] },
    ]);
  });
});

describe("comments inside export braces", () => {
  it("never become part of a name", () => {
    const src = [
      "export {",
      "  // a line comment — with a dash",
      "  a,",
      "  /* a block comment */ b as c, // trailing",
      "} from './x.js';",
    ].join("\n");
    expect(
      (extractReExports(src)[0] as ReExport).names.map((n) => `${n.local}>${n.exported}`),
    ).toEqual(["a>a", "b>c"]);
  });
});

describe("resolveSurface", () => {
  const files: Record<string, string> = {
    "src/index.ts": [
      "export { deep as renamed } from './barrel.js';",
      "export * from './star.js';",
      "export * as tools from './ns.js';",
      "export type { Shape } from './types.js';",
      "export { ghost } from './missing.js';",
      "export * from './loop-a.js';",
      "/** Root own. @public */",
      "export const OWN = 1;",
    ].join("\n"),
    "src/barrel.ts": "export { deep } from './leaf.js';",
    "src/leaf.ts":
      "/**\n * Deep fn.\n * @public\n */\nexport async function deep(a: number): Promise<number> { return a; }",
    "src/star.ts": "export function s1() {}\nexport default function dflt() {}",
    "src/ns.ts": "export function inner() {}",
    "src/types.ts": "/** A shape. @public */\nexport interface Shape { k: number }",
    "src/loop-a.ts": "export * from './loop-b.js';\nexport const LA = 1;",
    "src/loop-b.ts": "export * from './loop-a.js';\nexport const LB = 2;",
  };
  const load = (p: string) => files[p] ?? null;
  const resolve = (from: string, spec: string) => {
    const dir = from.slice(0, from.lastIndexOf("/"));
    return `${dir}/${spec.replace(/^\.\//, "").replace(/\.js$/, ".ts")}`;
  };
  const surface = resolveSurface("src/index.ts", load, resolve);
  const byName = Object.fromEntries(surface.symbols.map((s) => [s.name, s]));

  it("lists every root export, sorted, and nothing else", () => {
    expect(surface.symbols.map((s) => s.name)).toEqual([
      "LA",
      "LB",
      "OWN",
      "Shape",
      "renamed",
      "s1",
      "tools",
    ]);
  });

  it("follows a rename through a barrel to the declaring file", () => {
    const r = byName.renamed as SurfaceSymbol;
    expect(r.declaredName).toBe("deep");
    expect(r.declaredIn).toBe("src/leaf.ts");
    expect(r.via).toEqual(["src/index.ts", "src/barrel.ts"]);
    expect(r.async).toBe(true);
    expect(r.returnType).toBe("Promise<number>");
    expect(r.stability).toBe("public");
  });

  it("carries type-only re-exports as typeOnly", () => {
    expect((byName.Shape as SurfaceSymbol).typeOnly).toBe(true);
    expect((byName.Shape as SurfaceSymbol).kind).toBe("interface");
    expect((byName.renamed as SurfaceSymbol).typeOnly).toBe(false);
  });

  it("does not re-export a default through export *", () => {
    expect(byName.default).toBeUndefined();
    expect((byName.s1 as SurfaceSymbol).declaredIn).toBe("src/star.ts");
  });

  it("records export * as ns as one namespace symbol", () => {
    expect((byName.tools as SurfaceSymbol).kind).toBe("namespace");
    expect((byName.tools as SurfaceSymbol).declaredIn).toBe("src/ns.ts");
  });

  it("survives a star-export cycle and reports an unresolvable specifier", () => {
    expect((byName.LA as SurfaceSymbol).declaredIn).toBe("src/loop-a.ts");
    expect((byName.LB as SurfaceSymbol).declaredIn).toBe("src/loop-b.ts");
    expect(surface.unresolved).toEqual([{ from: "src/index.ts", specifier: "./missing.js" }]);
  });
});
