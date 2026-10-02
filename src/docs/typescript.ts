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
import type { Node } from "web-tree-sitter";
import { type GrammarName, loadGrammar, parserFor } from "../map/grammars.ts";
import { B, NON_SPACE, pySplitlines, pyStrip, S, W } from "../py.ts";
import { proseOf } from "../ste/prose.ts";
import { type DocSymbol, type FileReport, type Kind, newReport } from "./model.ts";
import { applyRules } from "./rules.ts";

// The type in `@param {T} name` is optional, and the group `(?:\{...\}\s*)?` matches only when the
// braces exist. A looser form ate the name itself in `@param alpha - text`, and every untyped
// parameter was then compared with its own last letter.
const TSDOC_PARAM = new RegExp(`^${S}*\\*?${S}*@param${S}+(?:\\{[^}]*\\}${S}*)?(${W}+)`, "gmu");
const JSDOC_TYPED_PARAM = new RegExp(`@param${S}+\\{[^}]+\\}`, "u");

// The evidence of a dialect. JSDoc puts a `{type}` after a tag, and TSDoc never does. A comment with
// neither is neutral: if it counted as TSDoc, a JSDoc file with one member that has no parameter
// would read as mixed.
const JSDOC_TYPED_TAG = new RegExp(
  `@(?:param|returns?|type|typedef|property|prop|throws|this)${S}+\\{[^}]+\\}`,
  "u",
);
const TSDOC_TAG = new RegExp(
  `@param${S}+${W}+${S}+-${S}|@(?:returns?|throws)${S}+(?!\\{)${NON_SPACE}|@(?:remarks|typeParam|defaultValue)${B}`,
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
// the real source. It applies only to a property position (`abstract:` or `abstract?:`).
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

/** Returns the identifiers that one parameter node binds. */
function boundIdentifiers(node: Node): string[] {
  if (IDENTIFIERS.has(node.type)) return [node.text];
  const pattern = node.childForFieldName("pattern");
  if (pattern) return boundIdentifiers(pattern);
  if (["object_pattern", "array_pattern", "object_assignment_pattern"].includes(node.type)) {
    return node.namedChildren.flatMap(boundIdentifiers);
  }
  if (node.type === "rest_pattern" && node.namedChildren[0]) {
    return boundIdentifiers(node.namedChildren[0]);
  }
  const first = node.namedChildren.find((c) => IDENTIFIERS.has(c.type));
  return first ? [first.text] : [];
}

/** Returns the declared parameter names. A destructured or rest parameter gives its identifiers. */
function paramsOf(node: Node): string[] {
  const list = node.childForFieldName("parameters");
  return (list?.namedChildren ?? []).flatMap(boundIdentifiers);
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
function leadingDoc(anchor: Node): string {
  const prev = anchor.previousSibling;
  if (prev?.type !== "comment") return "";
  return prev.text.startsWith("/**") ? prev.text : "";
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

/**
 * True when `text` parses without an error node. The stub writer calls this on the changed file.
 * The grammar must be loaded (`analyseTypeScript` loads it).
 */
export function parsesAsTypeScript(path: string, text: string): boolean {
  const tree = parserFor(grammarFor(path)).parse(sanitise(text.replace(/^\uFEFF/, "")));
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
  const tree = parserFor(grammar).parse(sanitise(source));
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
    for (const node of tree.rootNode.descendantsOfType(DECLARATION_TYPES)) {
      const kind = DECLARATIONS[node.type] as Kind;
      const anchor = anchorOf(node);
      const doc = leadingDoc(anchor);
      const dialect = dialectOf(doc);
      const typeLike = kind === "class" || kind === "interface" || kind === "type";
      const line = node.startPosition.row + 1;
      const sym: DocSymbol = {
        file: path,
        line,
        anchorLine: anchor.startPosition.row + 1,
        name: node.childForFieldName("name")?.text ?? "<anonymous>",
        kind,
        exported: isExported(node),
        hasDoc: doc !== "",
        params: typeLike ? [] : paramsOf(node),
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
