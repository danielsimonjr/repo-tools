/**
 * The Python analyser of `repo-tools docs` (design section 16). The cases port `test_code_docs.py`
 * of the code-docs skill. Then they add the places where tree-sitter must do what `ast` did: the
 * decoding of a docstring literal, `inspect.cleandoc`, and the order of the parameter names.
 */
import { describe, expect, test } from "bun:test";
import { STUB_MARKER } from "../../src/docs/model.ts";
import {
  analysePython,
  cleandoc,
  detectDialect,
  documentedParams,
  parsesAsPython,
} from "../../src/docs/python.ts";
import { only } from "./docs-helpers.ts";

/** The symbols of a Python source. */
async function symbols(source: string, path = "a.py") {
  return (await analysePython(path, source)).symbols;
}

const rulesOf = (sym: { issues: { rule: string }[] }): string[] => sym.issues.map((i) => i.rule);

describe("python: the public surface and rule M1", () => {
  test("an exported function with no docstring is M1", async () => {
    const sym = only(await symbols("def visible(x):\n    return x\n"));
    expect(sym.exported).toBe(true);
    expect(sym.hasDoc).toBe(false);
    expect(rulesOf(sym)).toEqual(["M1"]);
  });

  test("a private function with no docstring is not gated", async () => {
    const sym = only(await symbols("def _hidden(x):\n    return x\n"));
    expect(sym.issues).toEqual([]);
  });

  test("a dunder method is public", async () => {
    const found = await symbols("class C:\n    def __init__(self):\n        pass\n");
    expect(found.find((s) => s.name === "__init__")?.exported).toBe(true);
  });

  test("__all__ overrides the underscore convention", async () => {
    const src = '__all__ = ["_odd"]\n\ndef _odd():\n    return 1\n\ndef normal():\n    return 2\n';
    const by = new Map((await symbols(src)).map((s) => [s.name, s]));
    expect(by.get("_odd")?.exported).toBe(true);
    expect(by.get("normal")?.exported).toBe(false);
  });

  test("a __all__ that is not a literal list leaves the convention in force", async () => {
    const src = "__all__ = compute()\n\ndef _odd():\n    return 1\n\ndef normal():\n    return 2\n";
    const by = new Map((await symbols(src)).map((s) => [s.name, s]));
    expect(by.get("_odd")?.exported).toBe(false);
    expect(by.get("normal")?.exported).toBe(true);
  });

  test("a nested function, a method and an async function are all reported", async () => {
    const src = [
      "def outer():",
      "    def inner():",
      "        pass",
      "",
      "class K:",
      "    async def run(self):",
      "        pass",
      "",
    ].join("\n");
    const found = await symbols(src);
    expect(found.map((s) => `${s.name}:${s.kind}:${s.line}`)).toEqual([
      "outer:function:1",
      "inner:function:2",
      "K:class:5",
      "run:function:6",
    ]);
  });

  test("a decorated function reports the line of its def, not of its decorator", async () => {
    const found = await symbols("@decorator\ndef f():\n    pass\n");
    expect(only(found).line).toBe(2);
  });

  test("a test file is exempt from M1 and still fails on a stale doc", async () => {
    const undocumented = only(await symbols("def test_alpha():\n    pass\n", "tests/test_x.py"));
    expect(undocumented.issues).toEqual([]);
    const stale = only(
      await symbols(
        'def test_alpha(a):\n    """Do it.\n\n    Args:\n        gone: Not a parameter.\n    """\n',
        "tests/test_x.py",
      ),
    );
    expect(rulesOf(stale)).toContain("M3");
  });
});

describe("python: the names of the parameters", () => {
  test("self and cls are not parameters", async () => {
    const src =
      'class C:\n    def m(self, x):\n        """Do it.\n\n        Args:\n            x: A thing.\n        """\n';
    const m = (await symbols(src)).find((s) => s.name === "m");
    expect(m).toBeDefined();
    expect(m?.params).toEqual(["x"]);
    expect(m?.issues.map((i) => i.rule)).not.toContain("M3");
  });

  test("the order is the order of ast: the names, then *args, then **kwargs", async () => {
    const src = "def f(a, /, b, *args, c=1, **kw):\n    pass\n";
    expect(only(await symbols(src)).params).toEqual(["a", "b", "c", "args", "kw"]);
  });

  test("a typed or defaulted parameter and a keyword separator give their names", async () => {
    const src = "def f(a: int, b: str = 'x', *, c: float = 1.0, **kw: int) -> None:\n    pass\n";
    expect(only(await symbols(src)).params).toEqual(["a", "b", "c", "kw"]);
    expect(only(await symbols("def g(*args: int):\n    pass\n")).params).toEqual(["args"]);
  });

  test("a class has no parameters", async () => {
    expect(only(await symbols("class C(Base):\n    pass\n")).params).toEqual([]);
  });
});

describe("python: rules M2, M3 and M4", () => {
  test("a stale documented parameter is M3, and a real one is not", async () => {
    const src = `def f(a):
    """Do a thing.

    Args:
        a: First.
        removed: No longer exists.
    """
    return a
`;
    const m3 = only(await symbols(src)).issues.filter((i) => i.rule === "M3");
    expect(m3.map((i) => i.detail)).toEqual([
      "documents parameter 'removed' which is not in the signature",
    ]);
  });

  test("a Returns section is not read as a parameter", async () => {
    const src = `def f(a):
    """Do a thing.

    Args:
        a: First.

    Returns:
        Something.
    """
    return a
`;
    expect(rulesOf(only(await symbols(src)))).not.toContain("M3");
  });

  test("a surviving stub marker is M4", async () => {
    const src = `def alpha(a):\n    """${STUB_MARKER} one-line summary."""\n    return a\n`;
    expect(rulesOf(only(await symbols(src)))).toContain("M4");
  });

  test("a docstring that holds only a tag line has no summary", async () => {
    const sym = only(await symbols('def f(a):\n    """\n    :param a: x\n    """\n'));
    expect(sym.summary).toBe(":param a: x");
    const blank = only(await symbols('def g():\n    """   """\n'));
    expect(blank.hasDoc).toBe(false);
    expect(rulesOf(blank)).toEqual(["M1"]);
  });
});

describe("python: a syntax error", () => {
  test("is reported on the file, not raised, and the file is not parsed", async () => {
    const report = await analysePython("bad.py", "def broken(:\n");
    expect(report.error).toContain("SyntaxError");
    expect(report.error).toContain("line 1");
    expect(report.symbols).toEqual([]);
  });

  test("a Python 2 print statement is a syntax error, as in Python 3", async () => {
    const report = await analysePython("old.py", 'print "x"\n');
    expect(report.error).toContain("SyntaxError");
  });

  // The grammar reads each of these without an error node, and `ast.parse` rejects each one.
  test("statements of one block at two columns are an IndentationError", async () => {
    const report = await analysePython("a.py", "def f():\n  x = 1\n   y = 2\n");
    expect(report.error).toBe("IndentationError: inconsistent indentation at line 3");
  });

  test("a statement at an indent in a module is an IndentationError", async () => {
    const report = await analysePython("a.py", "x = 1\n  y = 2\n");
    expect(report.error).toContain("Error");
    expect(report.symbols).toEqual([]);
  });

  test("a block with no statement is an IndentationError", async () => {
    const empty = await analysePython("a.py", "class A:\npass\n");
    expect(empty.error).toBe("IndentationError: expected an indented block at line 2");
    const comment = await analysePython("a.py", "def f():\n    # only a comment\nx = 1\n");
    expect(comment.error).toContain("IndentationError");
  });

  test("a decimal integer with a leading zero is a SyntaxError", async () => {
    const report = await analysePython("a.py", "x = 0777\n");
    expect(report.error).toBe(
      "SyntaxError: leading zeros in decimal integer literals are not permitted at line 1",
    );
    for (const ok of [
      "x = 0\n",
      "x = 00\n",
      "x = 0_0\n",
      "x = 0o17\n",
      "x = 0x1F\n",
      "x = 1_000\n",
    ]) {
      expect((await analysePython("a.py", ok)).error).toBe("");
    }
  });

  test("code that is valid Python 3 is not rejected", async () => {
    const valid = [
      "x = 1; y = 2\n",
      "def f(): a = 1; b = 2\n",
      "if x:\n    a = 1\n    # a comment at any column\n  # another\n    b = 2\n",
      "class K:\n    def m(self):\n        pass\n\n    def n(self):\n        pass\n",
      "x = (1,\n     2); y = 3\n",
      "import sys\nprint >>sys.stderr, 'text'\n",
    ];
    for (const src of valid) expect((await analysePython("a.py", src)).error).toBe("");
  });

  test("the line of a parse error is the innermost error, not the first line of the file", async () => {
    const report = await analysePython("a.py", "x = 1\n\n\ndef f(:\n    pass\n");
    expect(report.error).toBe("SyntaxError: invalid syntax at line 4");
  });

  test("parsesAsPython tells a valid text from an invalid one", async () => {
    await analysePython("a.py", "x = 1\n");
    expect(parsesAsPython("x = 1\n")).toBe(true);
    expect(parsesAsPython("def broken(:\n")).toBe(false);
    expect(parsesAsPython("\uFEFFx = 1\n")).toBe(true);
  });
});

describe("python: which string is a docstring", () => {
  const doc = async (literal: string) =>
    only(await symbols(`def f():\n    ${literal}\n    return 1\n`));

  test("a single-quoted, a raw and a unicode string are docstrings", async () => {
    expect((await doc('"One."')).summary).toBe("One.");
    expect((await doc("'One.'")).summary).toBe("One.");
    expect((await doc('r"""Raw \\d."""')).summary).toBe("Raw \\d.");
    expect((await doc('u"""Uni."""')).summary).toBe("Uni.");
  });

  test("adjacent strings and a string in parentheses are one docstring", async () => {
    expect((await doc('"One. " "Two."')).summary).toBe("One. Two.");
    expect((await doc('("One.")')).summary).toBe("One.");
  });

  test("an f-string and a bytes literal are not docstrings", async () => {
    expect((await doc('f"""Has {1} hole."""')).hasDoc).toBe(false);
    expect((await doc('b"""Bytes."""')).hasDoc).toBe(false);
    expect((await doc('"a" f"b"')).hasDoc).toBe(false);
  });

  test("an expression that is not a string is not a docstring", async () => {
    expect((await doc("42")).hasDoc).toBe(false);
    expect((await doc("'a', 'b'")).hasDoc).toBe(false);
  });

  test("a comment before the docstring does not hide it", async () => {
    const src = 'def f():\n    # note\n    """After a comment."""\n';
    expect(only(await symbols(src)).summary).toBe("After a comment.");
  });

  test("an escape in a plain string is decoded, and in a raw string it is not", async () => {
    const plain = await doc('"""First\\nSecond."""');
    expect(plain.summary).toBe("First");
    const raw = await doc('r"""First\\nSecond."""');
    expect(raw.summary).toBe("First\\nSecond.");
    const tab = await doc('"""A\\tB."""');
    expect(tab.summary).toBe("A       B.");
    const hex = await doc('"""\\x41\\u0042\\103 end."""');
    expect(hex.summary).toBe("ABC end.");
  });

  test("a named escape stays as written, because the tool has no table of Unicode names", async () => {
    expect((await doc('"""\\N{BULLET} item."""')).summary).toBe("\\N{BULLET} item.");
  });

  test("a backslash before a line end joins the lines, and an unknown escape stays", async () => {
    const joined = await doc('"""One \\\ntwo."""');
    expect(joined.summary).toBe("One two.");
    const unknown = await doc('"""Path \\d here."""');
    expect(unknown.summary).toBe("Path \\d here.");
  });
});

/** The expected values below come from `inspect.cleandoc` of Python 3.13.15. */
describe("python: cleandoc follows Python 3.13", () => {
  test("removes the common indent of the lines after the first", () => {
    expect(cleandoc("  First\n    a\n  b\n")).toBe("First\n  a\nb");
  });

  test("removes the blank lines at both ends and expands a tab to the next multiple of 8", () => {
    expect(cleandoc("\n\n  A\n\tB\n\n")).toBe("A\n      B");
    expect(cleandoc("\t\n  a\n  b")).toBe("a\nb");
  });

  test("keeps a line of spaces that is the last line, as Python does", () => {
    expect(cleandoc("x")).toBe("x");
    expect(cleandoc("")).toBe("");
    expect(cleandoc("   \n   ")).toBe("   ");
  });
});

describe("python: the dialect and the documented names", () => {
  const cases: [string, string][] = [
    ['"""S.\n\nArgs:\n    a: x\n"""', "google"],
    ['"""S.\n\nParameters\n----------\na : int\n"""', "numpy"],
    ['"""S.\n\n:param a: x\n"""', "rest"],
    ['"""Just a summary."""', ""],
  ];
  for (const [text, expected] of cases) {
    test(`detects ${expected || "no dialect"}`, () => {
      expect(detectDialect(text)).toBe(expected);
    });
  }

  test("the Google names have no star, and a type in brackets is allowed", () => {
    const doc = "S.\n\nArgs:\n    a (int): First.\n    *args: Rest.\n\nReturns:\n    x: y\n";
    expect(documentedParams(doc, "google")).toEqual(["a", "args"]);
  });

  test("the NumPy names come from the Parameters block only", () => {
    const doc =
      "S.\n\nParameters\n----------\na : int\n    Desc.\nb : str\n\nReturns\n-------\nx : int\n";
    expect(documentedParams(doc, "numpy")).toEqual(["a", "b"]);
  });

  test("the reST names come from the :param lines", () => {
    expect(documentedParams(":param a: x\n:param b: y\n", "rest")).toEqual(["a", "b"]);
    expect(documentedParams("S.", "")).toEqual([]);
  });

  test("a file with two dialects reports both", async () => {
    const src =
      'def a(x):\n    """S.\n\n    Args:\n        x: y\n    """\n\ndef b(x):\n    """S.\n\n    :param x: y\n    """\n';
    const report = await analysePython("m.py", src);
    expect([...report.dialects].sort()).toEqual(["google", "rest"]);
  });
});

describe("python: the SHOULD rules", () => {
  test("S2 flags a summary with no full stop, and S5 flags a type in the Args block", async () => {
    const src = 'def f(a):\n    """Do it\n\n    Args:\n        a (int): First.\n    """\n';
    const rules = rulesOf(only(await symbols(src)));
    expect(rules).toContain("S2");
    expect(rules).toContain("S5");
  });

  test("S6 reports the Simplified Technical English findings and none gates", async () => {
    const src = 'def f():\n    """Call it in order to reset the state."""\n';
    const sym = only(await symbols(src));
    expect(sym.issues.map((i) => i.rule)).toEqual(["S6/STE-WORD"]);
    expect(sym.issues.every((i) => i.tier === "SHOULD")).toBe(true);
  });

  test("a clean docstring has no issue", async () => {
    const src = 'def f(a):\n    """Return a.\n\n    Args:\n        a: A thing.\n    """\n';
    expect(only(await symbols(src)).issues).toEqual([]);
  });
});
