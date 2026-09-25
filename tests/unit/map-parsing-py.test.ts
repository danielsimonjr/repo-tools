/**
 * The Python reader of the map engine: tree-sitter-python in place of CPython's `ast`.
 *
 * Ported from the architecture-docs skill (`test_parsing_python.py`). The order cases below are
 * new: the import order reaches the output, and CPython's `ast.walk` visits the tree breadth
 * first. Each expected value is the output of the Python tool (`parse_py`, CPython 3.13) on the
 * same source.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { loadGrammar } from "../../src/map/grammars.ts";
import { parsePy } from "../../src/map/parsing.ts";

beforeAll(async () => {
  await loadGrammar("python");
});

const imports = (src: string) => parsePy(src).imports.map((i) => [i.specifier, i.names]);

describe("parsePy: the source tests", () => {
  test("records absolute and relative imports", () => {
    const mod = parsePy(
      "import os\nimport numpy as np\nfrom .types import Foo, Bar\nfrom remember.system import RememberSystem\n",
    );
    expect(new Set(mod.imports.map((i) => i.specifier))).toEqual(
      new Set(["os", "numpy", ".types", "remember.system"]),
    );
  });

  test("a relative import keeps its level as dots", () => {
    expect(parsePy("from ..pkg.mod import thing\n").imports.map((i) => i.specifier)).toEqual([
      "..pkg.mod",
    ]);
  });

  test("a bare relative import is a single dot", () => {
    expect(parsePy("from . import sibling\n").imports.map((i) => i.specifier)).toEqual(["."]);
  });

  test("records the imported names", () => {
    expect(parsePy("from .types import Foo, Bar\n").imports[0]?.names).toEqual(["Foo", "Bar"]);
  });

  test("exports are the public top-level definitions", () => {
    const mod = parsePy(
      "def public():\n    pass\n\ndef _private():\n    pass\n\nclass Thing:\n    pass\n\nCONSTANT = 1\n_hidden = 2\n",
    );
    expect(new Set(mod.exports)).toEqual(new Set(["public", "Thing", "CONSTANT"]));
  });

  test("__all__ overrides inference", () => {
    const mod = parsePy(
      "__all__ = ['only_this']\n\ndef only_this():\n    pass\n\ndef also_public():\n    pass\n",
    );
    expect(mod.exports).toEqual(["only_this"]);
  });

  test("nested definitions are not exports", () => {
    expect(new Set(parsePy("class Thing:\n    def method(self):\n        pass\n").exports)).toEqual(
      new Set(["Thing"]),
    );
  });

  test("an async def is an export", () => {
    expect(parsePy("async def handler():\n    pass\n").exports).toEqual(["handler"]);
  });

  test("a syntax error is raised, not swallowed", () => {
    expect(() => parsePy("def broken(:\n")).toThrow(SyntaxError);
  });
});

describe("parsePy: the import order is CPython's breadth-first ast.walk order", () => {
  test("a nested import comes after a top-level one", () => {
    expect(imports("def f():\n    import inner\nimport top\n")).toEqual([
      ["top", []],
      ["inner", []],
    ]);
  });

  test("each elif nests one level deeper", () => {
    const src =
      "if a:\n    import i1\nelif b:\n    import i2\nelif c:\n    import i3\nelse:\n    import i4\n" +
      "def g():\n    import g1\n";
    expect(imports(src)).toEqual([
      ["i1", []],
      ["g1", []],
      ["i2", []],
      ["i3", []],
      ["i4", []],
    ]);
  });

  test("an except body is two levels below its try", () => {
    const src =
      "try:\n    import t1\nexcept E:\n    import t2\nelse:\n    import t3\nfinally:\n    import t4\n" +
      "class K:\n    import k1\n    def m(self):\n        import k2\n";
    expect(imports(src)).toEqual([
      ["t1", []],
      ["t3", []],
      ["t4", []],
      ["k1", []],
      ["t2", []],
      ["k2", []],
    ]);
  });

  test("__future__, parenthesised names, dotted aliases and a star import", () => {
    const src =
      "from __future__ import annotations\nfrom a import (b,\n    c as d)\nimport x.y as z, w\nfrom . import *\n";
    expect(imports(src)).toEqual([
      ["__future__", ["annotations"]],
      ["a", ["b", "c"]],
      ["x.y", []],
      ["w", []],
      [".", ["*"]],
    ]);
  });
});

describe("parsePy: the export forms", () => {
  test("chained, annotated, tuple, attribute, decorated and repeated names", () => {
    const mod = parsePy(
      "a = b = 1\nc: int = 2\nd: str\ne, f = 1, 2\nobj.attr = 3\n_x = 4\n" +
        "@dec\ndef decorated():\n    pass\n@dec\nclass DC:\n    pass\n" +
        "def dup():\n    pass\ndef dup():\n    pass\n",
    );
    expect(mod.exports).toEqual(["a", "b", "c", "d", "decorated", "DC", "dup", "dup"]);
    expect(mod.exportKinds).toEqual({
      a: "const",
      b: "const",
      c: "const",
      d: "const",
      decorated: "function",
      DC: "class",
      dup: "function",
    });
  });

  test("__all__ keeps string constants only, with implicit concatenation folded", () => {
    const mod = parsePy(`__all__ = ['a' 'b', "c", 1, f'x', b'y']\nx = 1\n`);
    expect(mod.exports).toEqual(["ab", "c"]);
    expect(mod.exportKinds).toEqual({ ab: "unknown", c: "unknown" });
  });

  test("__all__ forms: a bare tuple, a later list, a chained target, an annotation", () => {
    expect(parsePy("__all__ = 'p', 'q'\n").exports).toEqual(["p", "q"]);
    expect(parsePy("__all__ = make()\n__all__ = ['later']\n").exports).toEqual(["later"]);
    expect(parsePy("__all__ = other = ['chained']\n").exports).toEqual(["chained"]);
    expect(parsePy("__all__: list = ['ann']\ndef visible():\n    pass\n").exports).toEqual([
      "visible",
    ]);
  });

  test("__all__ string escapes decode as Python decodes them", () => {
    const src = String.raw`__all__ = ['tab\\x', r'raw\\y', 'q\'s']` + "\n";
    expect(parsePy(src).exports).toEqual([String.raw`tab\x`, String.raw`raw\\y`, "q's"]);
  });
});
