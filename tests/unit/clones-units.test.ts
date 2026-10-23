/**
 * The normal form of a function body and the units of a file (design sections 17.3 and 17.4):
 * what the normaliser erases, what it keeps, and how each declaration form becomes a unit.
 */
import { afterAll, describe, expect, test } from "bun:test";
import type { Tree } from "web-tree-sitter";
import { normalise } from "../../src/clones/normalise.ts";
import { type Unit, unitsOf } from "../../src/clones/units.ts";
import { grammarFor, loadGrammar, parserFor } from "../../src/map/grammars.ts";

const trees: Tree[] = [];

// The describe blocks below parse while bun collects the tests, so the grammar loads first.
await loadGrammar(grammarFor("a.ts"));

afterAll(() => {
  for (const tree of trees) tree.delete();
});

/** Parses `source` as TypeScript and keeps the tree until the end of the run. */
function parse(source: string): Tree {
  const tree = parserFor(grammarFor("a.ts")).parse(source);
  if (!tree) throw new Error("the parser returned no tree");
  trees.push(tree);
  return tree;
}

/** The labels of the body of the first function declaration in `source`. */
function labelsOf(source: string): string[] {
  const fn = parse(source).rootNode.descendantsOfType("function_declaration")[0];
  const body = fn?.childForFieldName("body");
  if (!body) throw new Error("no function body in the sample");
  return normalise(body).labels;
}

/** The units of `source` with no size limit. */
function units(source: string, minNodes = 1): Unit[] {
  return unitsOf(parse(source).rootNode, source, "a.ts", minNodes);
}

/** The single unit named `name`. */
function unit(all: Unit[], name: string): Unit {
  const found = all.filter((u) => u.name === name);
  if (found.length !== 1 || !found[0]) throw new Error(`expected one unit named ${name}`);
  return found[0];
}

describe("normalise: what the normal form erases", () => {
  const BASE = `function f(items: Item[]): number {
    let total = 0;
    for (const item of items) {
      if (item.price > 10 && item.ok) total += item.price * 2;
    }
    return total;
  }`;

  test("renamed identifiers and changed literals give the same labels", () => {
    const renamed = `function g(rows: Row[]): number {
    let sum = 5;
    for (const row of rows) {
      if (row.cost > 99 && row.good) sum += row.cost * 7;
    }
    return sum;
  }`;
    expect(labelsOf(renamed)).toEqual(labelsOf(BASE));
  });

  test("types, assertions, parentheses and comments give no label", () => {
    const typed = `function f(items): number {
    // a comment
    let total: number = 0;
    for (const item of (items as Item[])) {
      /* another */
      if ((item!.price satisfies number) > 10 && <boolean>item.ok) total += (item.price * 2);
    }
    return total as number;
  }`;
    expect(labelsOf(typed)).toEqual(labelsOf(BASE));
  });

  test("a decorator inside the body gives no label", () => {
    const plain = "function f() { class A { m() { return 1; } } return A; }";
    const decorated = "function f() { class A { @dec(1) m() { return 1; } } return A; }";
    expect(labelsOf(decorated)).toEqual(labelsOf(plain));
  });

  test("a different operator gives a different label", () => {
    expect(labelsOf(BASE.replace("item.price * 2", "item.price - 2"))).not.toEqual(labelsOf(BASE));
    expect(labelsOf(BASE.replace("&&", "||"))).not.toEqual(labelsOf(BASE));
    expect(labelsOf(BASE.replace("+=", "-="))).not.toEqual(labelsOf(BASE));
  });

  test("an extra statement gives a longer sequence", () => {
    const longer = BASE.replace("return total;", "console.log(total);\n    return total;");
    expect(labelsOf(longer).length).toBeGreaterThan(labelsOf(BASE).length);
  });

  test("a different control structure gives a different sequence", () => {
    const other = `function f(items: Item[]): number {
    let total = 0;
    while (total < items.length) {
      if (items[total].price > 10 && items[total].ok) total += items[total].price * 2;
      total++;
    }
    return total;
  }`;
    expect(labelsOf(other)).not.toEqual(labelsOf(BASE));
  });

  test("identifiers, literals and template text have fixed labels", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the sample is source code with a template string
    const labels = labelsOf("function f() { return `a${x}b` + 'c' + 1 + /r/ + true + null; }");
    expect(labels).toContain("ID");
    expect(labels).toContain("LIT");
    expect(labels).toContain("TPL");
    expect(labels).toContain("binary_expression:+");
    expect(labels).not.toContain("identifier");
    expect(labels).not.toContain("template_substitution");
  });

  test("the names of the identifiers are collected in lower case", () => {
    const fn = parse("function f() { return Alpha.beta(Gamma); }").rootNode.descendantsOfType(
      "function_declaration",
    )[0];
    const body = fn?.childForFieldName("body");
    if (!body) throw new Error("no body");
    expect([...normalise(body).names].sort()).toEqual(["alpha", "beta", "gamma"]);
  });

  test("a generic call and a type declaration inside the body give no type label", () => {
    const labels = labelsOf(
      "function f() { type T = { a: string }; interface I { b: number } return make<T>(1); }",
    );
    expect(labels.join(" ")).not.toContain("type_");
    expect(labels.join(" ")).not.toContain("interface");
  });
});

describe("units: the declaration forms", () => {
  const SOURCE = `
/** Adds the numbers. Second sentence.
 * @param a the first
 */
export function add(a: number, b: number): number { return a + b; }
export const mul = async (a: number, b: number) => { return a * b; };
const half = function (a: number) { return a / 2; };
function* gen() { yield 1; }
export class Box<T> {
  value = (x: number) => x + 1;
  constructor(private n: number) { this.n = n; }
  get size(): number { return this.n; }
  set size(v: number) { this.n = v; }
  static async make(): Promise<Box<number>> { return new Box(1); }
  helper() { const inner = (z: number) => z * 3; function nested() { return 1; } return inner(1); }
}
const obj = {
  run(a) { return a; },
  go: (b) => b + 1,
  "quoted-key": function (c) { return c; },
};
foo(function () { return 1; });
`;
  const all = units(SOURCE);

  test("each form is a unit with its kind and container", () => {
    const rows = all.map((u) => `${u.container}|${u.name}|${u.kind}`);
    expect(rows).toEqual([
      "|add|function",
      "|mul|function",
      "|half|function",
      "|gen|function",
      "Box|value|field",
      "Box|constructor|ctor",
      "Box|size|get",
      "Box|size|set",
      "Box|make|method",
      "Box|helper|method",
      "Box|inner|local",
      "Box|nested|local",
      "|run|prop",
      "|go|prop",
      "|quoted-key|prop",
    ]);
  });

  test("an anonymous function is not a unit", () => {
    expect(all.map((u) => u.name)).not.toContain("foo");
    expect(all).toHaveLength(15);
  });

  test("exported, async, params, doc and lines", () => {
    const add = unit(all, "add");
    expect(add.exported).toBe(true);
    expect(add.params).toBe(2);
    expect(add.async).toBe(false);
    expect(add.doc).toBe("Adds the numbers. Second sentence.");
    expect(add.startLine).toBe(5);
    expect(add.endLine).toBe(5);
    const mul = unit(all, "mul");
    expect(mul.exported).toBe(true);
    expect(mul.async).toBe(true);
    expect(mul.doc).toBe("");
    expect(unit(all, "half").exported).toBe(false);
    expect(unit(all, "make").async).toBe(true);
    expect(unit(all, "make").exported).toBe(false);
    expect(unit(all, "go").params).toBe(1);
    expect(unit(all, "gen").params).toBe(0);
  });

  test("a nested unit lies inside the range of the unit that holds it", () => {
    const helper = unit(all, "helper");
    for (const name of ["inner", "nested"]) {
      const inner = unit(all, name);
      expect(inner.startIndex).toBeGreaterThanOrEqual(helper.startIndex);
      expect(inner.endIndex).toBeLessThanOrEqual(helper.endIndex);
    }
  });

  test("minNodes drops a unit whose body is too short", () => {
    const tiny = units("function f() { return 1; }", 1);
    expect(tiny).toHaveLength(1);
    const labels = unit(tiny, "f").nodes;
    expect(units("function f() { return 1; }", labels)).toHaveLength(1);
    expect(units("function f() { return 1; }", labels + 1)).toHaveLength(0);
  });

  test("the hashes: equal for a rename, different for a changed shape", () => {
    const a = unit(units("function f(x) { if (x > 1) { return x * 2; } return 0; }"), "f");
    const b = unit(units("function g(y) { if (y > 9) { return y * 5; } return 7; }"), "g");
    const c = unit(units("function h(x) { if (x > 1) { return x * 2; } return -1; }"), "h");
    const d = unit(units("function k(x) { while (x > 1) { x--; } return 0; }"), "k");
    expect(a.exactHash).toBe(b.exactHash);
    expect(a.textHash).not.toBe(b.textHash);
    expect(a.exactHash).not.toBe(d.exactHash);
    expect(a.exactHash).not.toBe(c.exactHash);
  });
});
