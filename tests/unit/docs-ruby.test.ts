import { describe, expect, it } from "bun:test";
import { analyseRuby, parsesAsRuby } from "../../src/docs/ruby.ts";
import { applyInsertions, planTypeScript, splitLines } from "../../src/docs/stub.ts";

/** Returns the report for the given Ruby source. */
async function reportOf(source: string) {
  return analyseRuby("a.rb", source);
}

/** Returns symbols for the given Ruby source. */
async function symbols(source: string) {
  return (await reportOf(source)).symbols;
}

/** Returns the named symbol or throws when absent. */
async function byName(source: string, name: string) {
  const symbol = (await symbols(source)).find((item) => item.name === name);
  if (!symbol) throw new Error(`Missing symbol: ${name}`);
  return symbol;
}

describe("Ruby analyser", () => {
  it("assigns kinds at each scope", async () => {
    const source =
      "def top; end\nmodule Shapes\n  class Circle\n    def area; end\n    def self.unit; end\n    def ==(other); end\n    def radius=(v); end\n  end\nend\n";

    expect((await byName(source, "top")).kind).toBe("function");
    expect((await byName(source, "Shapes")).kind).toBe("module");
    expect((await byName(source, "Circle")).kind).toBe("class");
    expect((await byName(source, "area")).kind).toBe("method");
    expect((await byName(source, "unit")).kind).toBe("method");
    expect((await byName(source, "==")).kind).toBe("method");
    expect((await byName(source, "radius=")).kind).toBe("method");
  });

  it("reports one symbol for each class and module, not one for its keyword", async () => {
    const report = await reportOf("# Doc.\nclass A\nend\n\nmodule M\nend\n");
    expect(report.symbols.map((symbol) => `${symbol.name}:${symbol.kind}`)).toEqual([
      "A:class",
      "M:module",
    ]);
  });

  it("hoists documentation before the first body statement", async () => {
    const source =
      "module Outer\n  # First.\n  class First\n    # first method\n    def m1; end\n\n    # second\n    def m2; end\n  end\nend\n";

    expect((await byName(source, "First")).summary).toBe("First.");
    expect((await byName(source, "m1")).summary).toBe("first method");
    expect((await byName(source, "m2")).summary).toBe("second");
  });

  it("requires adjacent documentation", async () => {
    const detached = "# Blank\n\ndef detached; end\n";
    expect((await byName(detached, "detached")).hasDoc).toBe(false);

    const run = "# a\n# b\ndef runned; end\n";
    expect((await byName(run, "runned")).summary).toBe("a");

    const trailing = "x = 1 # trailing\ndef after; end\n";
    expect((await byName(trailing, "after")).hasDoc).toBe(false);

    const directive = "# frozen_string_literal: true\ndef m; end\n";
    expect((await byName(directive, "m")).hasDoc).toBe(false);

    const block = "=begin\nBlock doc.\n=end\ndef blk; end\n";
    expect((await byName(block, "blk")).summary).toBe("Block doc.");
  });

  it("tracks Ruby visibility", async () => {
    const source =
      "class V\n  def pub; end\n  private\n  def secret; end\n  def self.still_public; end\n  public\n  def again; end\n  private def inline_private; end\n  def listed; end\n  private :listed\nend\n";

    expect((await byName(source, "pub")).exported).toBe(true);
    expect((await byName(source, "secret")).exported).toBe(false);
    expect((await byName(source, "still_public")).exported).toBe(true);
    expect((await byName(source, "again")).exported).toBe(true);
    expect((await byName(source, "inline_private")).exported).toBe(false);
    expect((await byName(source, "listed")).exported).toBe(false);

    const nested = "def a\n  def b; end\nend\n";
    expect((await byName(nested, "b")).exported).toBe(false);
  });

  it("reads method parameters", async () => {
    const source = "def f(radius, extra = {}, *rest, key:, opt: 1, **kw, &blk); end\n";
    expect((await byName(source, "f")).params).toEqual([
      "radius",
      "extra",
      "rest",
      "key",
      "opt",
      "kw",
      "blk",
    ]);
  });

  it("reports one M3 issue for a stale documented parameter", async () => {
    const source =
      "# Does.\n# @param radius [Float] r\n# @param gone [Hash] g\ndef f(radius); end\n";
    const issues = (await byName(source, "f")).issues.filter((issue) => issue.rule === "M3");

    expect(issues).toHaveLength(1);
    const issue = issues[0];
    if (!issue) throw new Error("Missing M3 issue");
    expect(issue.detail).toContain("gone");
  });

  it("detects the Yard dialect", async () => {
    const yard = "# @param x\n# Does.\ndef p; end\n";
    expect((await byName(yard, "p")).dialect).toBe("yard");

    const plain = "# Plain.\ndef p; end\n";
    expect((await byName(plain, "p")).dialect).toBe("");
  });

  it("plans and applies a Yard stub", async () => {
    const source = "def area(a)\n  a\nend\n";
    const area = await byName(source, "area");
    const insertion = planTypeScript(area, splitLines(source), "yard");
    expect(insertion).not.toBeNull();
    if (!insertion) throw new Error("Missing insertion");

    const expected =
      "# TODO: state what this does, in one active-voice sentence.\n# @param a TODO: state what it is. Do not repeat the type.\n# @return TODO: state what the caller gets back.\n";
    expect(insertion.text).toBe(expected);

    const applied = applyInsertions(source, [insertion], (text) => parsesAsRuby("a.rb", text));
    expect(applied.ok).toBe(true);

    const updated = await byName(applied.text, "area");
    expect(updated.issues.some((issue) => issue.rule === "M1")).toBe(false);
    expect(updated.issues.some((issue) => issue.rule === "M4")).toBe(true);
    expect(updated.dialect).toBe("yard");
    expect(updated.returnsValue).toBeUndefined();
  });

  it("ignores methods inside heredocs", async () => {
    const source = "s = <<~EOT\n  def fake_in_heredoc; end\nEOT\n";
    const report = await reportOf(source);

    expect(report.symbols.some((symbol) => symbol.name === "fake_in_heredoc")).toBe(false);
    expect(report.error).toBe("");
  });

  it("reports parse errors", async () => {
    const report = await reportOf("def f(; end\n");

    expect(report.error).toMatch(/^parse error/);
    expect(report.symbols).toEqual([]);
  });
});
