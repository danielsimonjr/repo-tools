/**
 * The C# analyser of `repo-tools docs`, built on tree-sitter.
 *
 * The node kinds follow `server/parsing/languages/csharp` of mintlify/writer (MIT). The doc rule
 * follows the compiler: a run of `///` lines, or one `/** *\/` block, documents the declaration
 * after the comment. An attribute is a child of the declaration in this grammar. Thus the doc is
 * the sibling above the declaration, and a stub goes above the attributes.
 *
 * The exported rule is the accessibility of the declaration. `public` or `protected` (also
 * `protected internal`) is the public surface. Each enclosing type must be on the public surface
 * too. A member of an interface with no modifier is public. Any other declaration with no modifier
 * is `internal` (top level) or `private` (nested), and is not exported.
 */
import type { Node } from "web-tree-sitter";
import { parserFor } from "../map/grammars.ts";
import { proseOf } from "../ste/prose.ts";
import { analyseWith, type DocText, firstProse, parsesClean, type Reader } from "./comments.ts";
import type { FileReport, Kind } from "./model.ts";

/** The node types that the analyser reports, and the kind of each. */
const DECLARATIONS: Readonly<Record<string, Kind>> = {
  class_declaration: "class",
  struct_declaration: "struct",
  interface_declaration: "interface",
  enum_declaration: "enum",
  record_declaration: "class",
  delegate_declaration: "type",
  method_declaration: "method",
  constructor_declaration: "method",
  property_declaration: "property",
};

const DECLARATION_TYPES = Object.keys(DECLARATIONS);

/** The declarations that hold members. A member is exported only when each such holder is exported. */
const TYPES = new Set([
  "class_declaration",
  "struct_declaration",
  "interface_declaration",
  "record_declaration",
]);

/** The kind of `node`. A `record struct` is a struct; a plain `record` is a class. */
function kindOf(node: Node): Kind {
  if (node.type === "record_declaration" && node.children.some((c) => c.type === "struct")) {
    return "struct";
  }
  return DECLARATIONS[node.type] as Kind;
}

/** The accessibility words of a declaration: `public`, `protected`, `internal`, `private`. */
function modifiersOf(node: Node): Set<string> {
  return new Set(node.children.filter((c) => c.type === "modifier").map((c) => c.text));
}

/** True when the declaration itself is on the public surface, before its enclosing types. */
function isAccessible(node: Node): boolean {
  const mods = modifiersOf(node);
  if (mods.has("public")) return true;
  // `private protected` is visible to derived types of the same assembly only.
  if (mods.has("protected")) return !mods.has("private");
  if (mods.has("internal") || mods.has("private")) return false;
  // No accessibility word: a member of an interface is public, and anything else is not.
  return node.parent?.parent?.type === "interface_declaration";
}

/** True when the declaration and each type that encloses it are on the public surface. */
function isExported(node: Node): boolean {
  if (!isAccessible(node)) return false;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (TYPES.has(parent.type) && !isAccessible(parent)) return false;
  }
  return true;
}

/**
 * The parameter names of a declaration. Grammar 0.23 leaves a `params` parameter outside its
 * `parameter` node: its name is then a direct child of the list, in the field `name`.
 */
function paramsOf(node: Node): string[] {
  const list =
    node.childForFieldName("parameters") ??
    node.namedChildren.find((c) => c.type === "parameter_list") ??
    null;
  if (!list) return [];
  const names: string[] = [];
  for (let i = 0; i < list.childCount; i++) {
    const child = list.child(i);
    if (!child) continue;
    if (child.type === "parameter") {
      const name = child.childForFieldName("name");
      if (name) names.push(name.text);
    } else if (list.fieldNameForChild(i) === "name") {
      names.push(child.text);
    }
  }
  return names;
}

/** False when the declaration returns no value. Undefined for a declaration that has no result. */
function returnsValueOf(node: Node): boolean | undefined {
  if (node.type === "constructor_declaration") return false;
  if (node.type === "method_declaration" || node.type === "delegate_declaration") {
    return node.childForFieldName("returns")?.text !== "void";
  }
  return undefined;
}

/** True for a doc comment: `///` (not `////`) or `/**`. */
function isDocComment(node: Node): boolean {
  if (node.type !== "comment") return false;
  return /^\/\/\/(?!\/)/.test(node.text) || node.text.startsWith("/**");
}

/** The lines of a doc comment without the `///`, `/**`, `*\/` and leading `*` delimiters. */
function docLines(doc: string): string[] {
  return doc.split(/\r?\n/).map((line) =>
    line
      .trim()
      .replace(/^\/\/\//, "")
      .replace(/^\/\*\*/, "")
      .replace(/\*\/$/, "")
      .replace(/^\*(?!\/)/, ""),
  );
}

const TAG = /<[^>]*>/g;
const XML_PARAM = /<param\s+name\s*=\s*"([^"]+)"/g;
const XML_TAG = /<(?:summary|param|returns|remarks|typeparam|exception|value|example)\b/;

/** The first prose line: inside `<summary>` when the doc has one, else the first untagged line. */
function summaryOf(lines: string[]): string {
  const inner = lines.join("\n");
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(inner);
  if (summary) return firstProse((summary[1] ?? "").replace(TAG, "").split("\n"));
  return firstProse(lines.filter((l) => !l.trim().startsWith("<")).map((l) => l.replace(TAG, "")));
}

/** True when `text` parses as C#. The grammar must be loaded (`analyseCSharp` loads it). */
export function parsesAsCSharp(_path: string, text: string): boolean {
  return parsesClean(parserFor("csharp"), text);
}

/** Reads a run of C# doc comments. */
function readDoc(run: Node[]): DocText {
  const doc = run.map((n) => n.text).join("\n");
  const lines = docLines(doc);
  return {
    docParams: [...doc.matchAll(XML_PARAM)].map((m) => m[1] ?? ""),
    summary: summaryOf(lines),
    dialect: XML_TAG.test(doc) ? "xmldoc" : "",
    prose: proseOf(lines.map((l) => l.replace(TAG, "")).join("\n")),
  };
}

const CSHARP: Reader = {
  language: "csharp",
  grammar: "csharp",
  declarations: DECLARATION_TYPES,
  isDoc: isDocComment,
  isSkipped: (node) => node.type === "comment",
  // An attribute is a child of the declaration, so a stub above the declaration is above it too.
  anchorOf: (node) => node,
  kindOf,
  isExported,
  paramsOf,
  returnsValueOf,
  read: readDoc,
};

/** Analyses one C# source file and returns its report. */
export function analyseCSharp(path: string, source: string): Promise<FileReport> {
  return analyseWith(CSHARP, path, source);
}
