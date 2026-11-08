import { describe, expect, test } from "bun:test";
import { analyseGo, parsesAsGo } from "../../src/docs/go.ts";
import type { DocSymbol } from "../../src/docs/model.ts";
import {
  applyInsertions,
  type Insertion,
  planTypeScript,
  splitLines,
} from "../../src/docs/stub.ts";

const symbols = async (src: string): Promise<DocSymbol[]> => (await analyseGo("a.go", src)).symbols;
const byName = (all: DocSymbol[], name: string): DocSymbol => {
  const f = all.find((s) => s.name === name);
  if (!f) throw new Error(`no symbol '${name}'`);
  return f;
};

const PKG = "package p\n\n";
const withPackage = (body: string): string => `${PKG}${body}`;
const STYLE = "godoc";

describe("docs go", () => {
  test("reads declaration kinds in document order", async () => {
    const text = withPackage(
      [
        "func F() {}",
        "func (t *T) M() {}",
        "type T struct{}",
        "type I interface{}",
        "type C = int",
        "const K = 1",
        "var V int",
        "func Gen[X any](x X) {}",
        "",
      ].join("\n"),
    );
    const all = await symbols(text);
    expect(all.map((s) => [s.name, s.kind])).toEqual([
      ["F", "function"],
      ["M", "method"],
      ["T", "struct"],
      ["I", "interface"],
      ["C", "type"],
      ["K", "const"],
      ["V", "const"],
      ["Gen", "function"],
    ]);
  });

  test("marks export by the upper-case first letter of the name", async () => {
    const text = withPackage(
      [
        "// Exported does.",
        "func Exported() {}",
        "// hidden does.",
        "func hidden() {}",
        "type t struct{}",
        "// M does.",
        "func (r t) M() {}",
        "// m does.",
        "func (r t) m() {}",
        "const MaxN = 1",
        "const two = 2",
        "var V int",
        "var hidden2 int",
        "func Ünïcode() {}",
        "func Outer() {",
        "\tvar X int",
        "}",
        "",
      ].join("\n"),
    );
    const all = await symbols(text);
    expect(byName(all, "Exported").exported).toBe(true);
    expect(byName(all, "hidden").exported).toBe(false);
    expect(byName(all, "M").exported).toBe(true);
    expect(byName(all, "m").exported).toBe(false);
    expect(byName(all, "MaxN").exported).toBe(true);
    expect(byName(all, "two").exported).toBe(false);
    expect(byName(all, "V").exported).toBe(true);
    expect(byName(all, "hidden2").exported).toBe(false);
    expect(byName(all, "Ünïcode").exported).toBe(true);
    expect(byName(all, "X").exported).toBe(false);
  });

  test("reads a contiguous comment run and stops at a blank line", async () => {
    const two = await symbols(withPackage("// First line.\n// Second line.\nfunc A() {}\n"));
    expect(byName(two, "A").hasDoc).toBe(true);
    expect(byName(two, "A").summary).toBe("First line.");

    const block = await symbols(withPackage("/* Doc. */\nfunc B() {}\n"));
    expect(byName(block, "B").hasDoc).toBe(true);
    expect(byName(block, "B").summary).toBe("Doc.");

    const blank = await symbols(withPackage("// Doc.\n\nfunc C() {}\n"));
    expect(byName(blank, "C").hasDoc).toBe(false);

    const directive = await symbols(withPackage("// Doc.\n//go:noinline\nfunc D() {}\n"));
    expect(byName(directive, "D").hasDoc).toBe(true);
    expect(byName(directive, "D").summary).toBe("Doc.");

    const only = await symbols(withPackage("//go:noinline\nfunc E() {}\n"));
    expect(byName(only, "E").hasDoc).toBe(false);
  });

  test("anchors grouped specs at the spec and ungrouped types at the declaration", async () => {
    const grouped = await symbols(
      withPackage("type (\n\t// A is grouped.\n\tA struct{}\n\tB int\n)\n"),
    );
    expect(byName(grouped, "A").hasDoc).toBe(true);
    const b = byName(grouped, "B");
    expect(b.hasDoc).toBe(false);
    expect(b.anchorLine).toBe(6);
    expect(b.anchorColumn).toBe(1);

    const plain = await symbols(withPackage("type T struct{}\n"));
    const t = byName(plain, "T");
    expect(t.anchorLine).toBe(3);
    expect(t.anchorColumn).toBe(0);
  });

  test("lists Go parameter names and drops the blank identifier", async () => {
    const all = await symbols(
      withPackage("func F(a, b int, rest ...string, _ int) {}\nfunc G(int, string) {}\n"),
    );
    expect(byName(all, "F").params).toEqual(["a", "b", "rest"]);
    expect(byName(all, "G").params).toEqual([]);
  });

  test("reports no doc params and no M3 issue for Go", async () => {
    const f = byName(
      await symbols(withPackage("// F does.\nfunc F(a int) int { return a }\n")),
      "F",
    );
    expect(f.docParams).toEqual([]);
    expect(f.issues.some((i) => i.rule === "M3")).toBe(false);
  });

  test("sets the godoc dialect when the summary opens with the name", async () => {
    const send = byName(await symbols(withPackage("// Send sends.\nfunc Send() {}\n")), "Send");
    expect(send.dialect).toBe("godoc");

    const box = byName(await symbols(withPackage("// A Box holds.\ntype Box struct{}\n")), "Box");
    expect(box.dialect).toBe("godoc");

    const bad = byName(await symbols(withPackage("// Sends it.\nfunc Send() {}\n")), "Send");
    expect(bad.dialect).toBe("");
  });

  test("plans a stub above the anchor and clears the missing-doc issues", async () => {
    const text = withPackage("func Name() {}\n");
    const sym = byName(await symbols(text), "Name");
    expect(sym.exported).toBe(true);
    const plan = planTypeScript(sym, splitLines(text), STYLE);
    if (!plan) throw new Error("no plan for Name");
    expect(plan.text).toBe("// Name TODO: state what this does, in one active-voice sentence.\n");

    const plans: Insertion[] = [plan];
    const patched = applyInsertions(text, plans, (t) => parsesAsGo("a.go", t));
    expect(patched.ok).toBe(true);

    const after = await symbols(patched.text);
    const exported = after.filter((s) => s.exported);
    expect(exported.length).toBeGreaterThan(0);
    for (const s of exported) {
      expect(s.issues.some((i) => i.rule === "M1")).toBe(false);
      expect(s.issues.some((i) => i.rule === "M3")).toBe(false);
      expect(s.issues.some((i) => i.rule === "M4")).toBe(true);
    }

    const grouped = withPackage("type (\n\t// A is grouped.\n\tA struct{}\n\tB int\n)\n");
    const b = byName(await symbols(grouped), "B");
    const bPlan = planTypeScript(b, splitLines(grouped), STYLE);
    if (!bPlan) throw new Error("no plan for B");
    expect(bPlan.text.startsWith("\t// B TODO:")).toBe(true);

    const ret = byName(await symbols(withPackage("func F() int { return 1 }\n")), "F");
    expect(ret.returnsValue).toBe(true);
    const noRet = byName(await symbols(withPackage("func G() {}\n")), "G");
    expect(noRet.returnsValue).toBe(false);
  });

  test("reports a parse error and no symbols for a broken file", async () => {
    const report = await analyseGo("a.go", withPackage("func (t *T) Bad( {}\n"));
    expect(report.error).toMatch(/^parse error/);
    expect(report.symbols).toEqual([]);
  });
});

describe("go review findings", () => {
  test("sets the godoc dialect for a non-ASCII name", async () => {
    const list = await symbols("package p\n\n// \u00c4 does x.\nvar \u00c4 int\n");
    expect(byName(list, "\u00c4").dialect).toBe("godoc");
  });
});
