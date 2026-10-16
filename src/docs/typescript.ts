/**
 * The TypeScript and JavaScript analyser of `repo-tools docs`, built on tree-sitter.
 *
 * Ported from `ts_lang.py` of the code-docs skill. A regex cannot tell an exported declaration from
 * the word "export" in a string, and it cannot attach a doc comment to the declaration that it
 * precedes. Both distinctions are the measurement.
 *
 * The grammar must match the file. A `.tsx` or `.jsx` file needs the TSX grammar, and another file
 * needs the TypeScript grammar. The wrong grammar gives a tree full of error nodes, not an
 * exception, and a broken parse that finds no symbol looks like a clean file. Thus the analyser
 * reports a parse error when the root node holds one.
 */
import type { Node, Parser, Tree } from "web-tree-sitter";
import { type GrammarName, loadGrammar, parserFor } from "../map/grammars.ts";
import { B, NON_SPACE, pySplitlines, pyStrip, S } from "../py.ts";
import { proseOf } from "../ste/prose.ts";
import { type DocSymbol, type FileReport, type Kind, newReport } from "./model.ts";
import { applyRules } from "./rules.ts";

// A JavaScript name may hold `$`, and JSDoc writes an optional parameter in brackets: `[name]` or
// `[name=default]`. The name is the part after the bracket.
const NAME = "[\\p{L}\\p{N}_$]";

// The type in `@param {T} name` is optional, and the group `(?:\{...\}\s*)?` matches only when the
// braces exist. A looser form ate the name itself in `@param alpha - text`, and every untyped
// parameter was then compared with its own last letter.
const TSDOC_PARAM = new RegExp(
  `^${S}*\\*?${S}*@param${S}+(?:\\{[^}]*\\}${S}*)?\\[?(${NAME}+)`,
  "gmu",
);
const JSDOC_TYPED_PARAM = new RegExp(`@param${S}+\\{[^}]+\\}`, "u");

// The evidence of a dialect. JSDoc puts a `{type}` after a tag, and TSDoc never does. A comment with
// neither is neutral: if it counted as TSDoc, a JSDoc file with one member that has no parameter
// would read as mixed.
const JSDOC_TYPED_TAG = new RegExp(
  `@(?:param|returns?|type|typedef|property|prop|throws|this)${S}+\\{[^}]+\\}`,
  "u",
);
const TSDOC_TAG = new RegExp(
  `@param${S}+${NAME}+${S}+-${S}|@(?:returns?|throws)${S}+(?!\\{)${NON_SPACE}|@(?:remarks|typeParam|defaultValue)${B}`,
  "u",
);

/** Returns `jsdoc`, `tsdoc`, or an empty string when the comment holds no evidence of a dialect. */
function dialectOf(doc: string): string {
  if (!doc) return "";
  if (JSDOC_TYPED_TAG.test(doc)) return "jsdoc";
  if (TSDOC_TAG.test(doc)) return "tsdoc";
  return "";
}

/** The node types that the analyser reports, and the kind of each. */
const DECLARATIONS: Readonly<Record<string, Kind>> = {
  function_declaration: "function",
  generator_function_declaration: "function",
  class_declaration: "class",
  // An abstract class is exported API as a concrete class is. Its node type differs, so a match on
  // `class_declaration` alone would not see it.
  abstract_class_declaration: "class",
  interface_declaration: "interface",
  type_alias_declaration: "type",
  method_definition: "method",
};

const DECLARATION_TYPES = Object.keys(DECLARATIONS);

/** The grammar for a path: TSX reads JSX, which the TypeScript grammar cannot. */
function grammarFor(path: string): GrammarName {
  return path.endsWith(".tsx") || path.endsWith(".jsx") ? "tsx" : "typescript";
}

const SPACE_CLASS = "[ \\t\\n\\r\\f\\v]";

// A property named `abstract` is valid TypeScript, and `tsc` compiles it. The grammar reads the
// word as the class modifier and gives error nodes, so the whole file would not parse. The rewrite
// has equal length (`abstract` becomes `abstrac_`), so every position of the tree still points at
// the real source. It applies to the text `abstract:` or `abstract?:` wherever it stands, also in a
// parameter name or a comment, so the analyser reads every name and every comment from the original
// source and uses the rewritten text for the parse only.
const ABSTRACT_PROPERTY = new RegExp(`\\babstract(${SPACE_CLASS}*\\??${SPACE_CLASS}*:)`, "g");

// `export type * from 'm'` is TypeScript 5.0 syntax, and grammar 0.23.2 does not know it. Four
// spaces replace `type`, which leaves `export     * from 'm'`. The star re-export declares no
// local symbol, so dropping the type-only flag changes no finding.
const EXPORT_TYPE_STAR = new RegExp(`(\\bexport${SPACE_CLASS}+)type(${SPACE_CLASS}*\\*)`, "g");

/** Rewrites the constructs that the grammar cannot read. The result has the length of the input. */
export function sanitise(source: string): string {
  return source.replace(ABSTRACT_PROPERTY, "abstrac_$1").replace(EXPORT_TYPE_STAR, "$1    $2");
}

/** The identifiers that a pattern binds. An object pattern binds shorthand identifiers. */
const IDENTIFIERS = new Set(["identifier", "shorthand_property_identifier_pattern"]);

/**
 * The text of a node, read from the source as written. The tree comes from `sanitise(source)`, which
 * rewrites a few words, so `node.text` can differ from the file. The rewrite keeps the length, so
 * the offsets of the tree are the offsets of the source.
 */
type TextOf = (node: Node) => string;

/**
 * Returns the identifiers that one parameter node binds. A default value binds nothing, so only the
 * left side of an assignment pattern counts. A pair pattern (`{ key: value }`) binds its value.
 */
function boundIdentifiers(node: Node, text: TextOf): string[] {
  if (IDENTIFIERS.has(node.type)) return [text(node)];
  const pattern = node.childForFieldName("pattern");
  if (pattern) return boundIdentifiers(pattern, text);
  const into = (child: Node | null): string[] => (child ? boundIdentifiers(child, text) : []);
  switch (node.type) {
    case "object_pattern":
    case "array_pattern":
      return node.namedChildren.flatMap((child) => boundIdentifiers(child, text));
    case "assignment_pattern":
    case "object_assignment_pattern":
      return into(node.childForFieldName("left"));
    case "pair_pattern":
      return into(node.childForFieldName("value"));
    case "rest_pattern":
      return into(node.namedChildren[0] ?? null);
    default: {
      const first = node.namedChildren.find((c) => IDENTIFIERS.has(c.type));
      return first ? [text(first)] : [];
    }
  }
}

/** Returns the declared parameter names. A destructured or rest parameter gives its identifiers. */
function paramsOf(node: Node, text: TextOf): string[] {
  const list = node.childForFieldName("parameters");
  return (list?.namedChildren ?? []).flatMap((param) => boundIdentifiers(param, text));
}

/** The outermost `export` statement that wraps a declaration, or the declaration itself. */
function anchorOf(node: Node): Node {
  let target = node;
  while (target.parent?.type === "export_statement") target = target.parent;
  return target;
}

/**
 * Returns the doc comment that directly precedes `anchor`, or "". Only a block comment that opens
 * with two stars counts. A plain block comment or a line comment is a comment, not documentation,
 * and counting it would inflate the coverage.
 */
function docBefore(anchor: Node, text: TextOf): string {
  const prev = anchor.previousSibling;
  if (prev?.type !== "comment") return "";
  const comment = text(prev);
  return comment.startsWith("/**") ? comment : "";
}

// The grammar gives an overload signature (a declaration with no body) its own node type: a
// function has `function_signature` and a class member has `method_signature`.
const SIGNATURES = new Set(["function_signature", "method_signature"]);

/** The name of an overload signature that `sibling` is, or wraps in an `export` statement. */
function signatureName(sibling: Node, text: TextOf): string | null {
  const inner =
    sibling.type === "export_statement" ? sibling.childForFieldName("declaration") : sibling;
  if (!inner || !SIGNATURES.has(inner.type)) return null;
  const name = inner.childForFieldName("name");
  return name ? text(name) : null;
}

/**
 * Returns the doc comment of a declaration, or "". The comment that directly precedes the
 * declaration wins. An implementation signature has no such comment when it follows overload
 * signatures: a caller sees only the overloads, so the set has one documentation, on the first
 * overload. The walk goes back over the overloads of the same name, and over the comments between
 * them, and reads the comment before the first one.
 */
function leadingDoc(anchor: Node, node: Node, text: TextOf): string {
  const own = docBefore(anchor, text);
  if (own || (node.type !== "function_declaration" && node.type !== "method_definition")) {
    return own;
  }
  const name = node.childForFieldName("name");
  if (!name) return "";
  const implementation = text(name);
  let first: Node | null = null;
  for (let sibling = anchor.previousSibling; sibling; sibling = sibling.previousSibling) {
    // A class body holds the `;` that ends a member signature as a sibling node of its own.
    if (sibling.type === "comment" || sibling.type === ";") continue;
    if (signatureName(sibling, text) !== implementation) break;
    first = sibling;
  }
  return first ? docBefore(first, text) : "";
}

/** True when the declaration is exported from its module. */
function isExported(node: Node): boolean {
  let parent = node.parent;
  while (parent) {
    if (parent.type === "export_statement") return true;
    if (["program", "statement_block", "class_body"].includes(parent.type)) break;
    parent = parent.parent;
  }
  return false;
}

/** The first prose line of a block comment: the delimiters and the tag lines are not prose. */
function summaryOf(doc: string): string {
  for (const raw of pySplitlines(doc)) {
    const line = pyStrip(
      pyStrip(pyStrip(raw.replace(/\*+\/\s*$/, "")).replace(/^[/*]+/, "")).replace(/^\*+/, ""),
    );
    if (line === "" || line.startsWith("@")) continue;
    return line;
  }
  return "";
}

/** The comment without its opening and closing delimiters, for the STE check of the prose. */
function proseOfComment(doc: string): string {
  const lines = pySplitlines(doc).map((l) => l.replace(/^\s*\/\*+/, "").replace(/\*+\/\s*$/, ""));
  return proseOf(lines.join("\n"));
}

// The element types whose text can hold a bare `&`.
const JSX_PARENTS = new Set(["jsx_element", "jsx_fragment"]);

// Each pass can expose one more `&` of the same text, so the repair repeats. A file with this many
// rounds of bare ampersands in one parse is not a case worth a longer loop.
const MAX_REPAIRS = 16;

// An import type: `import("fs").Dirent[]` and `typeof import("m")`. The grammar reads the call as a
// member expression of a value, so it cannot take `[]` after it, and it reads `f<typeof import("m")>()`
// as a comparison. Both give error nodes. Only a call with a string literal is matched.
const IMPORT_CALL = new RegExp(
  `\\bimport${SPACE_CLASS}*\\(${SPACE_CLASS}*(?:"[^"\\n]*"|'[^'\\n]*')${SPACE_CLASS}*\\)`,
  "g",
);

/**
 * Writes an identifier of equal length over each `import("m")` call of `text`. The first run of
 * characters of a call becomes underscores, which is a type name that the grammar reads. The rest
 * of the call becomes spaces and keeps its line breaks, so every position and every line of the
 * tree still points at the real source.
 */
function blankImportCalls(text: string): string {
  return text.replace(IMPORT_CALL, (call) => {
    let name = true;
    let out = "";
    for (const ch of call) {
      if (/\s/u.test(ch)) {
        name = false;
        out += ch;
      } else {
        // One code unit of the source is one character of the result, also for an astral character.
        out += (name ? "_" : " ").repeat(ch.length);
      }
    }
    return out;
  });
}

/**
 * Parses `text`, and repairs the two cases that `tsc` accepts and the grammar cannot read.
 *
 * The first is a bare `&` in JSX text: React and `tsc` accept `<h3>Review & Start</h3>`, and the
 * grammar reads the `&` as an error node. The repair takes an error node that is a direct child of
 * a JSX element and starts with `&`, and writes a space over that one character.
 *
 * The second is an `import("m")` type. A file that parses is never rewritten. When the first parse
 * has an error, the repair writes an identifier over each `import("m")` call once, and the parser
 * runs again.
 *
 * Both repairs keep the length of the text, so each position of the tree still points at the real
 * source. Any other error stays an error, so a file with a real syntax error is still an unparsed
 * file.
 */
function parseSource(parser: Parser, text: string): Tree | null {
  let current = sanitise(text);
  let tree = parser.parse(current);
  let importsBlanked = false;
  for (let pass = 0; tree?.rootNode.hasError && pass < MAX_REPAIRS; pass++) {
    const marks: number[] = [];
    for (const node of tree.rootNode.descendantsOfType("ERROR")) {
      const start = node.startIndex;
      if (current[start] === "&" && node.parent && JSX_PARENTS.has(node.parent.type)) {
        marks.push(start);
      }
    }
    // Offsets are code units of the string, so a slice by index keeps every position.
    let next = current;
    for (const at of marks) next = `${next.slice(0, at)} ${next.slice(at + 1)}`;
    if (!importsBlanked) {
      importsBlanked = true;
      next = blankImportCalls(next);
    }
    if (next === current) break;
    tree.delete();
    current = next;
    tree = parser.parse(current);
  }
  return tree;
}

/**
 * True when `text` parses without an error node. The stub writer calls this on the changed file.
 * The grammar must be loaded (`analyseTypeScript` loads it).
 */
export function parsesAsTypeScript(path: string, text: string): boolean {
  const tree = parseSource(parserFor(grammarFor(path)), text.replace(/^\uFEFF/, ""));
  if (!tree) return false;
  try {
    return !tree.rootNode.hasError;
  } finally {
    tree.delete();
  }
}

/** Analyses one TypeScript or JavaScript source file and returns its report. */
export async function analyseTypeScript(path: string, source: string): Promise<FileReport> {
  const report = newReport(path, "typescript");
  const grammar = grammarFor(path);
  await loadGrammar(grammar);
  const tree = parseSource(parserFor(grammar), source);
  if (!tree) {
    report.error = "parse error (the parser returned no tree)";
    return report;
  }
  try {
    if (tree.rootNode.hasError) {
      // The error is a field of the report. The file is unknown, and it does not count as clean.
      report.error = "parse error (tree-sitter reported ERROR nodes)";
      return report;
    }
    const text: TextOf = (node) => source.slice(node.startIndex, node.endIndex);
    for (const node of tree.rootNode.descendantsOfType(DECLARATION_TYPES)) {
      const kind = DECLARATIONS[node.type] as Kind;
      const anchor = anchorOf(node);
      const doc = leadingDoc(anchor, node, text);
      const dialect = dialectOf(doc);
      const typeLike = kind === "class" || kind === "interface" || kind === "type";
      const line = node.startPosition.row + 1;
      const nameNode = node.childForFieldName("name");
      const sym: DocSymbol = {
        file: path,
        line,
        anchorLine: anchor.startPosition.row + 1,
        anchorColumn: anchor.startPosition.column,
        name: nameNode ? text(nameNode) : "<anonymous>",
        kind,
        exported: isExported(node),
        hasDoc: doc !== "",
        params: typeLike ? [] : paramsOf(node, text),
        docParams: doc ? [...doc.matchAll(TSDOC_PARAM)].map((m) => m[1] ?? "") : [],
        summary: summaryOf(doc),
        dialect,
        issues: [],
      };
      // In TypeScript the annotation carries the type, so a `{type}` brace is a second source of
      // truth. In plain JavaScript the brace is correct JSDoc.
      const typed = /\.tsx?$/.test(path) && JSDOC_TYPED_PARAM.test(doc);
      applyRules(sym, doc, path, {
        noun: "doc comment",
        restatesType: typed ? "@param restates a type already in the TypeScript signature" : null,
        prose: proseOfComment(doc),
      });
      report.symbols.push(sym);
      if (dialect) report.dialects.add(dialect);
    }
  } finally {
    tree.delete();
  }
  // Document order. A stable sort keeps two symbols of one line in that order.
  report.symbols.sort((a, b) => a.line - b.line);
  return report;
}
