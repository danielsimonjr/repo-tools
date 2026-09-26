/**
 * The C# and Rust readers of the map engine: regex readers over source with its comments and
 * strings blanked.
 *
 * Ported from the architecture-docs skill: `test_parsing_csharp.py`, and the parser part of
 * `test_rust.py` (its resolver and end-to-end parts are ported with the resolvers).
 */
import { describe, expect, test } from "bun:test";
import { parseCs, parseRs } from "../../src/map/parsing.ts";

const specs = (src: string) => parseCs(src).imports.map((i) => i.specifier);

describe("parseCs: using directives", () => {
  test("a plain using is an import", () => {
    expect(specs("using System.Text.Json;\n")).toEqual(["System.Text.Json"]);
  });

  test("several usings keep their order", () => {
    expect(specs("using System;\nusing UiMcp.Abstractions;\nusing UiMcp.Tools;\n")).toEqual([
      "System",
      "UiMcp.Abstractions",
      "UiMcp.Tools",
    ]);
  });

  test("a global using is an import", () => {
    expect(specs("global using System.Linq;\n")).toEqual(["System.Linq"]);
  });

  test("using static records the containing namespace", () => {
    expect(specs("using static System.Math;\n")).toEqual(["System"]);
  });

  test("an alias records the target, not the alias", () => {
    expect(specs("using Json = System.Text.Json;\n")).toEqual(["System.Text.Json"]);
  });

  test("an alias to a generic type keeps the namespace only", () => {
    expect(specs("using Map = System.Collections.Generic.Dictionary<string, int>;\n")).toEqual([
      "System.Collections.Generic",
    ]);
  });
});

describe("parseCs: the declared namespace", () => {
  test("a file-scoped namespace is provided", () => {
    expect(parseCs("namespace UiMcp.Tools;\n\npublic class Foo { }\n").provides).toEqual([
      "UiMcp.Tools",
    ]);
  });

  test("a block-scoped namespace is provided", () => {
    expect(parseCs("namespace UiMcp.Hosting\n{\n    public class Bar { }\n}\n").provides).toEqual([
      "UiMcp.Hosting",
    ]);
  });

  test("a file with no namespace provides nothing", () => {
    expect(parseCs("public class Loose { }\n").provides).toEqual([]);
  });
});

describe("parseCs: the public surface", () => {
  test("public types are exports", () => {
    const src =
      "namespace N;\npublic class Alpha { }\npublic interface IBeta { }\n" +
      "public record Gamma(int X);\npublic struct Delta { }\npublic enum Epsilon { A, B }\n";
    expect([...parseCs(src).exports].sort()).toEqual([
      "Alpha",
      "Delta",
      "Epsilon",
      "Gamma",
      "IBeta",
    ]);
  });

  test("non-public types are not exports", () => {
    const src =
      "namespace N;\ninternal class Hidden { }\nclass AlsoHidden { }\npublic class Shown { }\n";
    expect(parseCs(src).exports).toEqual(["Shown"]);
  });

  test("static, sealed, abstract and partial do not hide a public type", () => {
    const src =
      "namespace N;\npublic static class Helpers { }\npublic sealed class Sealed { }\n" +
      "public abstract partial class Partial { }\n";
    expect([...parseCs(src).exports].sort()).toEqual(["Helpers", "Partial", "Sealed"]);
  });
});

describe("parseCs: where a regex could lie", () => {
  test("a using in a line comment is not an import", () => {
    expect(specs("// using System.Evil;\nusing System.Text;\n")).toEqual(["System.Text"]);
  });

  test("a using in a block comment is not an import", () => {
    expect(specs("/*\nusing System.Evil;\n*/\nusing System.Text;\n")).toEqual(["System.Text"]);
  });

  test("a using STATEMENT is not a using DIRECTIVE", () => {
    const src =
      "namespace N;\npublic class C {\n  void M() {\n    using (var s = Open()) { }\n" +
      "    using var t = Open();\n  }\n}\n";
    expect(specs(src)).toEqual([]);
  });

  test("the word namespace in a string does not become a provided namespace", () => {
    expect(
      parseCs('namespace Real;\npublic class C { string s = "namespace Fake;"; }\n').provides,
    ).toEqual(["Real"]);
  });
});

describe("parseRs", () => {
  test("mod declarations are provides", () => {
    expect(new Set(parseRs("pub mod engine;\nmod internal;\n").provides)).toEqual(
      new Set(["engine", "internal"]),
    );
  });

  test("an inline mod declares no file", () => {
    expect(parseRs("mod inline { pub fn f() {} }\nmod real;\n").provides).toEqual(["real"]);
  });

  test("use paths are imports", () => {
    expect(
      parseRs("use crate::engine::Runner;\nuse std::fmt;\n").imports.map((i) => i.specifier),
    ).toEqual(["crate::engine::Runner", "std::fmt"]);
  });

  test("a brace group expands", () => {
    expect(
      parseRs("use crate::a::{b, c as d};\n")
        .imports.map((i) => i.specifier)
        .sort(),
    ).toEqual(["crate::a::b", "crate::a::c"]);
  });

  test("a name that holds the letters `as` keeps them (a whole-word alias only)", () => {
    // The Python tool split on the letters `as` after it removed the white space, so
    // `HashMap` became `H`, `hash_map` became `h` and `class` became `cl`.
    const src =
      "use std::collections::HashMap;\nuse std::collections::hash_map::Entry;\n" +
      "use crate::class::Base as B;\nuse crate::a::{HashSet, Alias as Al, basic};\n";
    expect(parseRs(src).imports.map((i) => i.specifier)).toEqual([
      "std::collections::HashMap",
      "std::collections::hash_map::Entry",
      "crate::class::Base",
      "crate::a::HashSet",
      "crate::a::Alias",
      "crate::a::basic",
    ]);
  });

  test("pub items are exports and private ones are not", () => {
    const src =
      "pub fn run() {}\npub struct Config;\npub async fn go() {}\nfn helper() {}\n" +
      "struct Hidden;\npub(crate) fn scoped() {}\n";
    expect(new Set(parseRs(src).exports)).toEqual(new Set(["run", "Config", "go"]));
  });

  test("comments and raw strings do not create imports", () => {
    const src =
      "// use crate::commented::Thing;\n/* use crate::block::Thing; */\n" +
      'let url = r"http://example.com/not::a::use";\nuse crate::real::Thing;\n';
    expect(parseRs(src).imports.map((i) => i.specifier)).toEqual(["crate::real::Thing"]);
  });
});
