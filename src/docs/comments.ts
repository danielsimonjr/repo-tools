/**
 * The driver that the tree-sitter analysers share. A grammar keeps a comment as a
 * sibling node of the declaration after the comment. Thus the doc of a declaration is a run of
 * sibling nodes above the declaration. Each language gives a `Reader`: its node types and its
 * rules. The driver parses the file, walks the declarations and applies the rules of the spec.
 */
import type { Node, Parser } from "web-tree-sitter";
import { type GrammarName, loadGrammar } from "../map/grammars.ts";
import { type DocSymbol, type FileReport, type Kind, newReport } from "./model.ts";
import { applyRules } from "./rules.ts";

/** What a doc comment says, as one language reads the comment. */
export interface DocText {
  docParams: string[];
  summary: string;
  dialect: string;
  /** The prose of the doc, without delimiters and tags, for the STE check (S6). */
  prose: string;
}

/** The rules of one language. */
export interface Reader {
  /** The registry id of the language. */
  language: string;
  grammar: GrammarName;
  /** The node types that the analyser reports. */
  declarations: readonly string[];
  /** True for a doc comment, which joins the run above a declaration. */
  isDoc: (node: Node) => boolean;
  /** True for a node that the doc walk steps over: an attribute, or a comment that is not a doc. */
  isSkipped: (node: Node) => boolean;
  /**
   * The node whose previous siblings hold the doc. The default is the declaration. A Go type spec
   * with no group takes its doc from the `type_declaration` above it.
   */
  docSiteOf?: (node: Node) => Node;
  /**
   * True when `comment` belongs to `below`, the node under it: the declaration, or the comment
   * that the walk accepted before. The walk stops at the first false. The default is true, and the
   * doc then crosses blank lines. Go asks for a comment with no blank line below it.
   */
  adjacentDoc?: (comment: Node, below: Node) => boolean;
  /**
   * Finds a tree that parses with no error node but that the grammar reads wrongly. The
   * result is the parse error text, or null for a correct tree. The file is then unparsed.
   */
  misread?: (root: Node) => string | null;
  /**
   * False for a node of a declaration type that is not a symbol: a C variable, a struct without a
   * body. The driver skips the node. The default is true for every node.
   */
  reports?: (node: Node) => boolean;
  /** The name of the symbol. The default is the field `name` of the declaration. */
  nameOf?: (node: Node) => string;
  /**
   * The declarators of a declaration that declares several names (`int a, b;`), or an empty list.
   * Each declarator gives its own symbol, with the name that `nameOf` gives for the declarator.
   * The symbols share the doc, the anchor and the other fields of the declaration. The default is
   * one symbol per declaration.
   */
  declaratorsOf?: (node: Node) => Node[];
  /**
   * The identity key of a symbol that the file can declare twice, or null. When a documented
   * symbol and an undocumented symbol share a key, the driver clears the export flag and the
   * issues of the undocumented one. The default is no key.
   */
  shadowKeyOf?: (node: Node) => string | null;
  /** The node that `stub` writes above. */
  anchorOf: (node: Node) => Node;
  kindOf: (node: Node) => Kind;
  isExported: (node: Node) => boolean;
  paramsOf: (node: Node) => string[];
  /** False when the declaration returns no value. Undefined for a declaration that has no result. */
  returnsValueOf: (node: Node) => boolean | undefined;
  /** Reads a run of doc comments above `node`. The run is not empty. */
  read: (run: Node[], node: Node) => DocText;
}

/**
 * The doc comments above `node`, in source order. The walk goes up the siblings. The walk steps over
 * the skipped nodes, collects the doc comments, and stops at the first other node. The compilers of
 * C# and Rust attach a doc comment to the next declaration across blank lines. Thus a blank line
 * does not stop the walk, unless the reader gives `adjacentDoc`.
 */
function docRunAbove(node: Node, reader: Reader): Node[] {
  const run: Node[] = [];
  let below = node;
  for (let prev = node.previousSibling; prev; prev = prev.previousSibling) {
    if (reader.adjacentDoc && !reader.adjacentDoc(prev, below)) break;
    if (reader.isDoc(prev)) run.unshift(prev);
    else if (!reader.isSkipped(prev)) break;
    below = prev;
  }
  return run;
}

/** True when `text` parses with `parser` and the tree holds no error node. */
export function parsesClean(parser: Parser, text: string): boolean {
  const tree = parser.parse(text.replace(/^\uFEFF/, ""));
  if (!tree) return false;
  try {
    return !tree.rootNode.hasError;
  } finally {
    tree.delete();
  }
}

/** The first line of `lines` with text, trimmed, or "". */
export function firstProse(lines: readonly string[]): string {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed !== "") return trimmed;
  }
  return "";
}

/** Clears the export flag and the issues of an undocumented symbol that a documented one shadows. */
function dropShadowed(keys: ReadonlyMap<DocSymbol, string>): void {
  const documented = new Set<string>();
  for (const [sym, key] of keys) if (sym.hasDoc) documented.add(key);
  for (const [sym, key] of keys) {
    if (!sym.exported || sym.hasDoc || !documented.has(key)) continue;
    sym.exported = false;
    sym.issues = [];
  }
}

const NO_DOC: DocText = { docParams: [], summary: "", dialect: "", prose: "" };

/** Analyses one source file with the rules of `reader`, and returns its report. */
export async function analyseWith(
  reader: Reader,
  path: string,
  source: string,
): Promise<FileReport> {
  const report = newReport(path, reader.language);
  const tree = (await loadGrammar(reader.grammar)).parse(source.replace(/^\uFEFF/, ""));
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
    const misread = reader.misread?.(tree.rootNode) ?? null;
    if (misread !== null) {
      report.error = misread;
      return report;
    }
    const keys = new Map<DocSymbol, string>();
    for (const node of tree.rootNode.descendantsOfType([...reader.declarations])) {
      if (reader.reports && !reader.reports(node)) continue;
      const run = docRunAbove(reader.docSiteOf?.(node) ?? node, reader);
      const doc = run.map((n) => n.text).join("\n");
      const text = run.length > 0 ? reader.read(run, node) : NO_DOC;
      const anchor = reader.anchorOf(node);
      const parts = reader.declaratorsOf?.(node) ?? [];
      const nameNodes = parts.length > 0 ? parts : [node];
      for (const nameNode of nameNodes) {
        const sym: DocSymbol = {
          file: path,
          line: node.startPosition.row + 1,
          anchorLine: anchor.startPosition.row + 1,
          anchorColumn: anchor.startPosition.column,
          name:
            reader.nameOf?.(nameNode) ?? nameNode.childForFieldName("name")?.text ?? "<anonymous>",
          kind: reader.kindOf(node),
          exported: reader.isExported(node),
          hasDoc: run.length > 0,
          params: reader.paramsOf(node),
          docParams: text.docParams,
          summary: text.summary,
          dialect: text.dialect,
          issues: [],
        };
        const returnsValue = reader.returnsValueOf(node);
        if (returnsValue !== undefined) sym.returnsValue = returnsValue;
        applyRules(sym, doc, path, { noun: "doc comment", restatesType: null, prose: text.prose });
        report.symbols.push(sym);
        if (sym.dialect) report.dialects.add(sym.dialect);
        const key = reader.shadowKeyOf?.(node) ?? null;
        if (key !== null) keys.set(sym, key);
      }
    }
    dropShadowed(keys);
  } finally {
    tree.delete();
  }
  // Document order. A stable sort keeps two symbols of one line in that order.
  report.symbols.sort((a, b) => a.line - b.line);
  return report;
}
