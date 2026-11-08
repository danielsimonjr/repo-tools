/**
 * The Rust analyser of `repo-tools docs` (design section 16). The cases follow the plan order: the
 * grammar loads, the exported rule, a doc across an attribute, the parameters, the stale argument
 * (M3), the dialect, the stub and its re-parse, and a file with a syntax error.
 */
import { describe, expect, test } from "bun:test";
import type { DocSymbol } from "../../src/docs/model.ts";
import { analyseRust, parsesAsRust } from "../../src/docs/rust.ts";
import {
  applyInsertions,
  type Insertion,
  planTypeScript,
  splitLines,
} from "../../src/docs/stub.ts";

const symbols = async (src: string): Promise<DocSymbol[]> =>
  (await analyseRust("a.rs", src)).symbols;
const byName = (all: DocSymbol[], name: string): DocSymbol => {
  const found = all.find((s) => s.name === name);
  if (!found) throw new Error(`no symbol '${name}'`);
  return found;
};

describe("analyseRust", () => {
  test("a valid file parses, and its items are reported with their kinds", async () => {
    const all = await symbols(
      "pub fn f() {}\npub struct S;\npub enum E { A }\npub trait T { fn t(&self); }\n" +
        "pub type U = i32;\npub const C: i32 = 1;\npub static V: i32 = 1;\npub mod m {}\n" +
        "impl S { pub fn h(&self) {} }\npub union W { a: i32 }\n",
    );
    expect(all.map((s) => `${s.name}:${s.kind}`)).toEqual([
      "f:function",
      "S:struct",
      "E:enum",
      "T:trait",
      "t:method",
      "U:type",
      "C:const",
      "V:const",
      "m:module",
      "h:method",
      "W:struct",
    ]);
  });

  test("only a bare pub is exported, and every enclosing module must be pub", async () => {
    const all = await symbols(
      "pub fn a() {}\npub(crate) fn b() {}\npub(super) fn c() {}\npub(in crate::x) fn d() {}\n" +
        "fn e() {}\nmod hidden { pub fn g() {} }\npub mod open { pub fn h() {} fn i() {} }\n",
    );
    const exported = Object.fromEntries(all.map((s) => [s.name, s.exported]));
    expect(exported).toEqual({
      a: true,
      b: false,
      c: false,
      d: false,
      e: false,
      hidden: false,
      g: false,
      open: true,
      h: true,
      i: false,
    });
  });

  test("a trait item follows the trait; a trait impl method is not exported", async () => {
    const all = await symbols(
      "pub trait T { fn t(&self); }\ntrait Q { fn q(&self); }\npub struct S;\n" +
        "impl T for S { fn t(&self) {} }\nimpl S { pub fn own(&self) {} fn hid(&self) {} }\n",
    );
    const methods = all.filter((s) => s.kind === "method");
    expect(methods.map((s) => `${s.name}:${s.exported}`)).toEqual([
      "t:true",
      "q:false",
      "t:false",
      "own:true",
      "hid:false",
    ]);
  });

  test("a function inside a function body is not exported", async () => {
    const all = await symbols("pub fn outer() { pub fn inner() {} }\n");
    expect(byName(all, "inner").exported).toBe(false);
  });

  test("a /// run documents the item across an attribute, in either order", async () => {
    const above = await symbols("/// Runs it.\n#[inline]\npub fn f() {}\n");
    expect(above[0]?.hasDoc).toBe(true);
    expect(above[0]?.summary).toBe("Runs it.");
    expect(above[0]?.anchorLine).toBe(2);
    const below = await symbols("#[inline]\n/// Runs it.\npub fn f() {}\n");
    expect(below[0]?.hasDoc).toBe(true);
    expect(below[0]?.summary).toBe("Runs it.");
  });

  test("the stub anchor of an item with no doc is its first attribute", async () => {
    const [f] = await symbols("#[inline]\n#[must_use]\npub fn f() {}\n");
    expect(f?.hasDoc).toBe(false);
    expect(f?.anchorLine).toBe(1);
    expect(f?.line).toBe(3);
  });

  test("//// and // are not doc comments; /** */ is", async () => {
    expect((await symbols("//// Not doc.\npub fn f() {}\n"))[0]?.hasDoc).toBe(false);
    expect((await symbols("// Not doc.\npub fn f() {}\n"))[0]?.hasDoc).toBe(false);
    const [g] = await symbols("/** Runs it. */\npub fn g() {}\n");
    expect(g?.hasDoc).toBe(true);
    expect(g?.summary).toBe("Runs it.");
  });

  test("a blank line between the doc and the item still attaches the doc", async () => {
    // rustc attaches an outer doc comment to the next item whatever the blank lines between.
    const [f] = await symbols("/// Runs it.\n\npub fn f() {}\n");
    expect(f?.hasDoc).toBe(true);
  });

  test("parameters: a tuple pattern binds its names, and self is skipped", async () => {
    const all = await symbols(
      "pub struct S;\nimpl S {\n  pub fn m(&mut self, (a, b): (i32, i32), mut c: i32, _: u8) {}\n}\n",
    );
    expect(byName(all, "m").params).toEqual(["a", "b", "c"]);
  });

  test("an argument under # Arguments that names no parameter is M3", async () => {
    const [f] = await symbols(
      "/// Runs it.\n///\n/// # Arguments\n///\n/// * `a` - The first.\n/// - `gone` - Old.\n" +
        "pub fn f(a: i32) {}\n",
    );
    expect(f?.docParams).toEqual(["a", "gone"]);
    expect(f?.issues.filter((i) => i.tier === "MUST")).toEqual([
      {
        rule: "M3",
        tier: "MUST",
        detail: "documents parameter 'gone' which is not in the signature",
      },
    ]);
  });

  test("a section heading marks the rustdoc dialect; a plain doc is neutral", async () => {
    const marked = await analyseRust(
      "a.rs",
      "/// Runs it.\n///\n/// # Panics\n///\n/// Never.\npub fn f() {}\n",
    );
    expect(marked.symbols[0]?.dialect).toBe("rustdoc");
    expect([...marked.dialects]).toEqual(["rustdoc"]);
    const plain = await analyseRust("a.rs", "/// Runs it.\npub fn f() {}\n");
    expect(plain.symbols[0]?.dialect).toBe("");
  });

  test("a file with a syntax error is unparsed", async () => {
    const report = await analyseRust("a.rs", "pub fn f( {}\n");
    expect(report.error).toMatch(/^parse error/);
    expect(report.symbols).toEqual([]);
  });
});

describe("the rustdoc stub", () => {
  test("goes above the attributes, lists each argument, and the file still parses", async () => {
    const src =
      "pub struct S;\nimpl S {\n    #[inline]\n    pub fn m(&self, a: i32) -> i32 { a }\n}\n";
    const report = await analyseRust("a.rs", src);
    const lines = splitLines(src);
    const plans = report.symbols
      .map((s) => planTypeScript(s, lines, "rustdoc"))
      .filter((p): p is Insertion => p !== null);
    const done = applyInsertions(src, plans, (text) => parsesAsRust("a.rs", text));
    expect(done.ok).toBe(true);
    expect(done.text).toContain(
      [
        "    /// TODO: state what this does, in one active-voice sentence.",
        "    ///",
        "    /// # Arguments",
        "    ///",
        "    /// * `a` - TODO: state what it is. Do not repeat the type.",
        "    ///",
        "    /// # Returns",
        "    ///",
        "    /// TODO: state what the caller gets back.",
        "    #[inline]",
      ].join("\n"),
    );
    const after = await analyseRust("a.rs", done.text);
    for (const sym of after.symbols.filter((s) => s.exported)) {
      const rules = sym.issues.map((i) => i.rule);
      expect(rules).not.toContain("M1");
      expect(rules).not.toContain("M3");
      expect(rules).toContain("M4");
    }
  });

  test("a function with no return type gets no # Returns section", async () => {
    const src = "pub fn f(a: i32) {}\n";
    const [f] = (await analyseRust("a.rs", src)).symbols;
    const plan = planTypeScript(f as DocSymbol, splitLines(src), "rustdoc");
    expect(plan?.text).not.toContain("# Returns");
    expect(plan?.text).toContain("# Arguments");
  });
});
