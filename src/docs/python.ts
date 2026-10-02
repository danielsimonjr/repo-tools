/**
 * The Python analyser of `repo-tools docs`, built on the tree-sitter Python grammar.
 *
 * Ported from `python_lang.py` of the code-docs skill, which used the standard library `ast`. The
 * grammar gives the same declarations and the same positions. The docstring text needs two steps
 * that `ast` did for free: the decoding of the string literal, and `inspect.cleandoc`. Both follow
 * Python 3.13.
 */
import type { Node } from "web-tree-sitter";
import { loadGrammar, parserFor } from "../map/grammars.ts";
import { NON_SPACE, pySplitlines, pyStrip, S, W } from "../py.ts";
import { proseOf } from "../ste/prose.ts";
import { type DocSymbol, type FileReport, newReport } from "./model.ts";
import { applyRules } from "./rules.ts";

const GOOGLE = new RegExp(`^${S}*(Args|Arguments|Returns|Raises|Yields):${S}*$`, "mu");
const NUMPY = new RegExp(`^${S}*Parameters${S}*\\n${S}*-{3,}${S}*$`, "mu");
// A reST field may name a type before the name: `:param int x:` or `:param Dict[str, int] x:`. The
// optional group takes the type and the space after it, so the name is the last word before the
// colon. The type cannot hold a colon, so the first colon of the line ends the field.
const REST_TYPE = `(?:[^:\\n]*${S})?`;
const REST = new RegExp(`^${S}*:param${S}+${REST_TYPE}\\*{0,2}${W}+${S}*:`, "mu");

// The optional "(type)" group does not capture, so each match yields the name alone.
const GOOGLE_PARAM = new RegExp(`^${S}{1,8}(\\*{0,2}${W}+)${S}*(?:\\([^)]*\\))?${S}*:`, "gmu");
const NUMPY_PARAM = new RegExp(`^${S}*(\\*{0,2}${W}+)${S}*:${S}*${NON_SPACE}`, "gmu");
const REST_PARAM = new RegExp(`^${S}*:param${S}+${REST_TYPE}(\\*{0,2}${W}+)${S}*:`, "gmu");

/** The section headers that end an `Args` or `Parameters` block. */
const SECTION_HEADERS = new Set([
  "Args",
  "Arguments",
  "Returns",
  "Raises",
  "Yields",
  "Examples",
  "Attributes",
  "Note",
  "Notes",
  "Parameters",
  "See Also",
]);

/** Returns the docstring dialect (`numpy`, `google` or `rest`), or an empty string. */
export function detectDialect(doc: string): string {
  // NumPy goes first: a NumPy docstring can hold a bare "Returns:" line that reads as Google.
  if (NUMPY.test(doc)) return "numpy";
  if (GOOGLE.test(doc)) return "google";
  if (REST.test(doc)) return "rest";
  return "";
}

/** A line of dashes under a header: one or more `-` and nothing else. */
const isRule = (line: string): boolean => /^-+$/.test(pyStrip(line));

/**
 * Returns the body under `header`, up to the next section header. The block ends at a header on
 * purpose: without an end, a "Returns:" entry reads as a parameter and reports as stale.
 */
function section(doc: string, header: string): string {
  const lines = doc.split("\n");
  const out: string[] = [];
  let inside = false;
  for (let i = 0; i < lines.length; i++) {
    const stripped = pyStrip(lines[i] ?? "");
    const next = lines[i + 1];
    const underlined = next !== undefined && isRule(next);
    if (!inside) {
      if (stripped.replace(/:+$/, "") === header && stripped.endsWith(":")) inside = true;
      else if (stripped === header && underlined) inside = true;
      continue;
    }
    if (
      SECTION_HEADERS.has(stripped.replace(/:+$/, "")) &&
      (stripped.endsWith(":") || underlined)
    ) {
      break;
    }
    out.push(lines[i] ?? "");
  }
  return out.join("\n");
}

/** Returns the names in `doc` matching `pattern`, with a leading `*` or `**` removed. */
function namesOf(pattern: RegExp, block: string): string[] {
  return [...block.matchAll(pattern)].map((m) => (m[1] ?? "").replace(/^\*+/, ""));
}

/** Returns the parameter names that the docstring documents, for the stale-name rule (M3). */
export function documentedParams(doc: string, dialect: string): string[] {
  if (dialect === "rest") return namesOf(REST_PARAM, doc);
  if (dialect === "numpy") return namesOf(NUMPY_PARAM, section(doc, "Parameters"));
  if (dialect === "google") {
    return namesOf(GOOGLE_PARAM, section(doc, "Args") || section(doc, "Arguments"));
  }
  return [];
}

/** Python `str.expandtabs()`: a tab moves to the next column that is a multiple of 8. */
function expandTabs(text: string): string {
  let out = "";
  let column = 0;
  for (const ch of text) {
    if (ch === "\t") {
      const width = 8 - (column % 8);
      out += " ".repeat(width);
      column += width;
    } else {
      out += ch;
      column = ch === "\n" || ch === "\r" ? 0 : column + 1;
    }
  }
  return out;
}

/** `inspect.cleandoc` of Python 3.13: removes the common indent, and the blank edge lines. */
export function cleandoc(doc: string): string {
  const lines = expandTabs(doc).split("\n");
  const stripSpaces = (line: string): string => line.replace(/^ +/, "");
  let margin = Number.POSITIVE_INFINITY;
  for (const line of lines.slice(1)) {
    const content = stripSpaces(line).length;
    if (content > 0) margin = Math.min(margin, line.length - content);
  }
  lines[0] = stripSpaces(lines[0] ?? "");
  if (margin < Number.POSITIVE_INFINITY) {
    for (let i = 1; i < lines.length; i++) lines[i] = (lines[i] ?? "").slice(margin);
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  while (lines.length > 0 && lines[0] === "") lines.shift();
  return lines.join("\n");
}

const ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\",
  "'": "'",
  '"': '"',
  a: "\x07",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

/**
 * The escape sequences of a Python string literal that is not raw. An unknown escape keeps its
 * backslash, as Python does. `\N{name}` stays as written, because the tool has no table of
 * Unicode names.
 */
function decodeEscapes(body: string): string {
  return body.replace(
    /\\(\r\n|[\n\r]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[0-7]{1,3}|N\{[^}]*\}|[\s\S])/g,
    (whole, seq: string) => {
      if (seq === "\n" || seq === "\r" || seq === "\r\n") return "";
      const simple = ESCAPES[seq];
      if (simple !== undefined) return simple;
      if (/^[0-7]+$/.test(seq)) return String.fromCharCode(Number.parseInt(seq, 8));
      if (/^[xuU][0-9a-fA-F]+$/.test(seq)) {
        const code = Number.parseInt(seq.slice(1), 16);
        return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return whole;
    },
  );
}

/**
 * The value of a `string` node, or null when it is not a plain `str` constant: a bytes literal
 * (prefix `b`), an f-string or a template string (prefix `f` or `t`) is not a docstring.
 */
function stringValue(node: Node): string | null {
  const m = /^([A-Za-z]*)('''|"""|'|")/.exec(node.text);
  if (!m) return null;
  const prefix = (m[1] ?? "").toLowerCase();
  const quote = m[2] ?? "";
  if (/[bft]/.test(prefix)) return null;
  const body = node.text.slice(prefix.length + quote.length, node.text.length - quote.length);
  return prefix.includes("r") ? body : decodeEscapes(body);
}

/** The value of a string expression: one literal, adjacent literals, or one in parentheses. */
function constantString(node: Node): string | null {
  if (node.type === "string") return stringValue(node);
  if (node.type === "concatenated_string") {
    let joined = "";
    for (const part of node.namedChildren) {
      if (part.type !== "string") return null;
      const value = stringValue(part);
      if (value === null) return null;
      joined += value;
    }
    return joined;
  }
  if (node.type === "parenthesized_expression" && node.namedChildren.length === 1) {
    const inner = node.namedChildren[0];
    return inner ? constantString(inner) : null;
  }
  return null;
}

/** The docstring of a function or class, cleaned as `ast.get_docstring` cleans it, or "". */
function docstringOf(def: Node): string {
  const body = def.childForFieldName("body");
  const first = body?.namedChildren.find((c) => c.type !== "comment");
  if (first?.type !== "expression_statement") return "";
  const value = first.namedChildren[0];
  if (!value || first.namedChildren.length !== 1) return "";
  const text = constantString(value);
  return text === null ? "" : cleandoc(text);
}

/** The name that a parameter node binds, with its kind: a plain name, `*name` or `**name`. */
function parameterName(param: Node): { name: string; star: "" | "*" | "**" } | null {
  switch (param.type) {
    case "identifier":
      return { name: param.text, star: "" };
    case "typed_parameter": {
      const first = param.namedChildren[0];
      return first ? parameterName(first) : null;
    }
    case "default_parameter":
    case "typed_default_parameter": {
      const name = param.childForFieldName("name");
      return name?.type === "identifier" ? { name: name.text, star: "" } : null;
    }
    case "list_splat_pattern":
    case "dictionary_splat_pattern": {
      const inner = param.namedChildren.find((c) => c.type === "identifier");
      return inner
        ? { name: inner.text, star: param.type === "list_splat_pattern" ? "*" : "**" }
        : null;
    }
    default:
      return null;
  }
}

/**
 * The parameter names of a signature, in the order of `ast`: the positional and keyword names,
 * then `*args`, then `**kwargs`. `self` and `cls` are not parameters.
 */
function paramsOf(def: Node): string[] {
  const list = def.childForFieldName("parameters");
  const plain: string[] = [];
  let vararg: string | undefined;
  let kwarg: string | undefined;
  for (const param of list?.namedChildren ?? []) {
    const found = parameterName(param);
    if (!found) continue;
    if (found.star === "*") vararg = found.name;
    else if (found.star === "**") kwarg = found.name;
    else plain.push(found.name);
  }
  const names = [...plain, ...(vararg ? [vararg] : []), ...(kwarg ? [kwarg] : [])];
  return names.filter((n) => n !== "self" && n !== "cls");
}

/**
 * True when `name` is part of the public surface of its module. `__all__` wins when it exists. If
 * not, a leading underscore marks a private name, and a dunder name is public (it implements a
 * protocol).
 */
function isExported(name: string, moduleAll: Set<string> | null): boolean {
  if (moduleAll !== null) return moduleAll.has(name);
  if (name.startsWith("__") && name.endsWith("__")) return true;
  return !name.startsWith("_");
}

/**
 * The names of a literal list, tuple or set of strings, or null. The tool reads only the form
 * `__all__ = [...]` at the top of a module, as `ast.literal_eval` of the value did.
 */
function literalNames(value: Node): Set<string> | null {
  if (!["list", "tuple", "set"].includes(value.type)) return null;
  const names = new Set<string>();
  for (const item of value.namedChildren) {
    if (item.type === "comment") continue;
    const text = constantString(item);
    if (text === null) return null;
    names.add(text);
  }
  return names;
}

/** The value of `__all__` at the top of the module, or null when it is absent or not a literal. */
function moduleAllOf(root: Node): Set<string> | null {
  let found: Set<string> | null = null;
  for (const stmt of root.namedChildren) {
    const assign = stmt.type === "expression_statement" ? stmt.namedChildren[0] : undefined;
    if (assign?.type !== "assignment" || assign.childForFieldName("type")) continue;
    const left = assign.childForFieldName("left");
    const right = assign.childForFieldName("right");
    if (left?.type !== "identifier" || left.text !== "__all__" || !right) continue;
    found = literalNames(right);
  }
  return found;
}

/**
 * The line of the first innermost node that the grammar marks as an error or as missing. The
 * grammar can wrap a whole file in one error node, so the search goes down to the first child that
 * holds an error, and stops at a node with no such child.
 */
function firstErrorLine(root: Node): number {
  let node = root;
  for (;;) {
    const inner = node.children.find((c) => c.hasError || c.isMissing);
    if (!inner) return node.startPosition.row + 1;
    node = inner;
  }
}

/** The nodes of a Python 2 statement. Python 3 does not parse them, and `ast.parse` rejects them. */
const PYTHON_2_STATEMENTS = ["print_statement", "exec_statement"];

/**
 * The first Python 2 statement of the tree, or undefined. The form `print >>stream, text` has a
 * `chevron` child and is valid Python 3: it shifts the name `print` by `stream`, and it fails at
 * run time, not at parse time. So it is not a Python 2 statement here.
 */
function legacyStatement(root: Node): Node | undefined {
  return root
    .descendantsOfType(PYTHON_2_STATEMENTS)
    .find((n) => !n.namedChildren.some((c) => c.type === "chevron"));
}

/**
 * The first indentation error that `ast.parse` rejects and the grammar accepts, or null. The
 * grammar reads a block with no statement, and statements of one block at different columns,
 * without an error node. A statement that starts after another statement on the same line (after a
 * semicolon) has no column of its own, and a comment has no rule.
 */
function indentationError(root: Node): string | null {
  for (const scope of [root, ...root.descendantsOfType(["block"])]) {
    const isBlock = scope.type === "block";
    const statements = scope.namedChildren.filter((c) => c.type !== "comment");
    if (isBlock && statements.length === 0) {
      return `IndentationError: expected an indented block at line ${scope.startPosition.row + 2}`;
    }
    // A block on the line of its header (`def f(): pass`) holds statements of that one line.
    const inline = isBlock && scope.previousSibling?.endPosition.row === scope.startPosition.row;
    let expected = isBlock ? -1 : 0;
    let previousEnd = inline ? scope.startPosition.row : -1;
    for (const stmt of statements) {
      const { row, column } = stmt.startPosition;
      if (row !== previousEnd) {
        if (expected < 0) expected = column;
        else if (column !== expected) {
          const kind = isBlock ? "inconsistent indentation" : "unexpected indent";
          return `IndentationError: ${kind} at line ${row + 1}`;
        }
      }
      previousEnd = stmt.endPosition.row;
    }
  }
  return null;
}

/** An integer such as `0777`: Python 3 rejects a leading zero in a decimal integer. */
const LEADING_ZERO = /^0[0-9_]*[1-9][0-9_]*$/;

/** The first syntax error of a parsed tree as a message, or null when the tree is clean. */
function syntaxError(root: Node): string | null {
  if (root.hasError) return `SyntaxError: invalid syntax at line ${firstErrorLine(root)}`;
  const legacy = legacyStatement(root);
  if (legacy) return `SyntaxError: Python 2 statement at line ${legacy.startPosition.row + 1}`;
  const indent = indentationError(root);
  if (indent) return indent;
  const octal = root.descendantsOfType(["integer"]).find((n) => LEADING_ZERO.test(n.text));
  if (octal) {
    const line = octal.startPosition.row + 1;
    return `SyntaxError: leading zeros in decimal integer literals are not permitted at line ${line}`;
  }
  return null;
}

/**
 * True when `text` is valid Python. The stub writer calls this on the changed file. The Python
 * grammar must be loaded (`analysePython` loads it).
 */
export function parsesAsPython(text: string): boolean {
  const tree = parserFor("python").parse(text.replace(/^\uFEFF/, ""));
  if (!tree) return false;
  try {
    return syntaxError(tree.rootNode) === null;
  } finally {
    tree.delete();
  }
}

/** The first line of a docstring after the edges are stripped, or "" when it holds no text. */
function summaryOf(doc: string): string {
  return pySplitlines(pyStrip(doc))[0] ?? "";
}

/** True when the docstring puts types in its `Args` block, which the signature already holds. */
function restatesTypes(doc: string): boolean {
  const header = new RegExp(`^${S}*(Args|Parameters):?${S}*$`, "mu");
  const typed = new RegExp(`^${S}{1,8}\\*{0,2}${W}+${S}*\\([^)]+\\)${S}*:`, "mu");
  return header.test(doc) && doc.includes("(") && typed.test(doc);
}

/**
 * Analyses one Python source file. A syntax error is a field of the report, not an exception: one
 * file that does not parse must not stop a scan of the repository, and it must not count as clean.
 */
export async function analysePython(path: string, source: string): Promise<FileReport> {
  const report = newReport(path, "python");
  await loadGrammar("python");
  const tree = parserFor("python").parse(source);
  if (!tree) {
    report.error = "SyntaxError: the parser returned no tree";
    return report;
  }
  try {
    const root = tree.rootNode;
    const failure = syntaxError(root);
    if (failure) {
      report.error = failure;
      return report;
    }
    const moduleAll = moduleAllOf(root);
    for (const def of root.descendantsOfType(["function_definition", "class_definition"])) {
      const doc = docstringOf(def);
      const dialect = detectDialect(doc);
      const isClass = def.type === "class_definition";
      const name = def.childForFieldName("name")?.text ?? "<anonymous>";
      const line = def.startPosition.row + 1;
      const sym: DocSymbol = {
        file: path,
        line,
        anchorLine: line,
        anchorColumn: 0,
        name,
        kind: isClass ? "class" : "function",
        exported: isExported(name, moduleAll),
        hasDoc: pyStrip(doc) !== "",
        params: isClass ? [] : paramsOf(def),
        docParams: doc ? documentedParams(doc, dialect) : [],
        summary: summaryOf(doc),
        dialect,
        issues: [],
      };
      applyRules(sym, doc, path, {
        noun: "docstring",
        restatesType: restatesTypes(doc)
          ? "docstring restates types already in the signature"
          : null,
        prose: proseOf(doc),
      });
      report.symbols.push(sym);
      if (dialect) report.dialects.add(dialect);
    }
  } finally {
    tree.delete();
  }
  return report;
}
