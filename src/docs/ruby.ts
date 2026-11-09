/**
 * Analyse Ruby sources for the `repo-tools docs` command.
 */
import type { Node } from "web-tree-sitter";
import { parserFor } from "../map/grammars.ts";
import { proseOf } from "../ste/prose.ts";
import { analyseWith, type DocText, firstProse, parsesClean, type Reader } from "./comments.ts";
import type { FileReport, Kind } from "./model.ts";

const DOC_DIRECTIVE =
  /^#\s*(?:frozen_string_literal|encoding|coding|warn_indent|shareable_constant_value|typed|rubocop:|-\*-)/;
const YARD_DIRECTIVE =
  /^\s*@(?:param|return|option|raise|yield|yieldparam|yieldreturn|example|see|since|deprecated|api|note|todo|overload|abstract|private|attr(?:_reader|_writer)?)\b/m;
const PARAM_DIRECTIVE = /@param\s+(?:\[[^\]]*\]\s+)?(\w+)/g;
const DECLARATIONS = ["class", "module", "method", "singleton_method"] as const;
const METHOD_ANCESTORS = new Set(["method", "singleton_method"]);
const NESTED_METHOD_ANCESTORS = new Set(["method", "singleton_method", "block", "do_block"]);
const SINGLETON_CLASS = new Set(["singleton_class"]);
const VISIBILITY = new Set(["private", "protected", "public", "module_function"]);
const INLINE_VISIBILITY = new Set(["private", "protected", "private_class_method"]);
const METHOD_HIDERS = new Set(["private", "protected"]);
const SINGLETON_HIDERS = new Set(["private_class_method"]);
const CONSTANT_HIDERS = new Set(["private_constant"]);
/** The rows of each tree that carry a `:nodoc:` mark, filled on the first lookup. */
const NODOC_ROWS = new WeakMap<object, Map<number, "nodoc" | "all">>();
const KIND_CONTAINERS = new Set([
  "class",
  "module",
  "singleton_class",
  "block",
  "do_block",
  "method",
  "singleton_method",
  "program",
]);
const PARAMETER_TYPES = new Set([
  "optional_parameter",
  "splat_parameter",
  "keyword_parameter",
  "hash_splat_parameter",
  "block_parameter",
]);

/** Returns true when the node is a Ruby comment. */
function isComment(node: Node): boolean {
  return node.type === "comment";
}

/** Returns true when the comment is a file directive. */
function isDirective(text: string): boolean {
  return DOC_DIRECTIVE.test(text);
}

/** Returns true when the comment starts its source line. */
function startsLine(comment: Node): boolean {
  const previous = comment.previousSibling;
  return !previous || previous.endPosition.row < comment.startPosition.row;
}

/** Returns the documentation site for a declaration. */
function docSiteOf(node: Node): Node {
  const parent = node.parent;
  if (parent?.type === "body_statement" && parent.firstNamedChild?.id === node.id) {
    return parent;
  }
  return node;
}

/** Returns the anchor node for a declaration. */
function anchorOf(node: Node): Node {
  return node;
}

/** Returns true when the comment is documentation. */
function isDoc(node: Node): boolean {
  return isComment(node) && startsLine(node) && !isDirective(node.text);
}

/** Returns true when the comment is a skipped directive. */
function isSkipped(node: Node): boolean {
  return isComment(node) && startsLine(node) && isDirective(node.text);
}

/** Returns true when the comment is adjacent to the node below. */
function adjacentDoc(comment: Node, below: Node): boolean {
  return comment.endPosition.row >= below.startPosition.row - 1;
}

/** Returns true when an ancestor has one of the given types. */
function hasAncestorType(node: Node, types: ReadonlySet<string>): boolean {
  let current = node.parent;
  while (current) {
    if (types.has(current.type)) return true;
    current = current.parent;
  }
  return false;
}

/** Returns the documentation kind for a Ruby declaration. */
function kindOf(node: Node): Kind {
  if (node.type === "class") return "class";
  if (node.type === "module") return "module";
  let current = node.parent;
  while (current) {
    if (KIND_CONTAINERS.has(current.type)) {
      return current.type === "program" ? "function" : "method";
    }
    current = current.parent;
  }
  return "function";
}

/** Returns the nearest body or program ancestor. */
function bodyOf(node: Node): Node {
  let current = node.parent;
  while (current) {
    if (current.type === "body_statement" || current.type === "program") {
      return current;
    }
    current = current.parent;
  }
  return node;
}

/** Returns the ancestor-or-self that is a direct child of the body. */
function directChildOf(node: Node, body: Node): Node {
  if (node.id === body.id) return node;
  let current = node;
  while (current.parent && current.parent.id !== body.id) {
    current = current.parent;
  }
  return current;
}

/** Returns true when the call hides the named method. */
function hidesName(body: Node, name: string, methodNames: ReadonlySet<string>): boolean {
  for (let index = 0; index < body.childCount; index += 1) {
    const child = body.child(index);
    if (child?.type !== "call") continue;
    const method = child.childForFieldName("method");
    if (!method || !methodNames.has(method.text)) continue;
    const args = child.childForFieldName("arguments");
    if (!args) continue;
    for (let argIndex = 0; argIndex < args.childCount; argIndex += 1) {
      const arg = args.child(argIndex);
      if (arg?.type === "simple_symbol" && arg.text === `:${name}`) {
        return true;
      }
      if (arg?.type === "string" && plainStringText(arg) === name) {
        return true;
      }
    }
  }
  return false;
}

/** Returns the text of a string literal with no interpolation (`"K"`, `'K'`), or null. */
function plainStringText(node: Node): string | null {
  const parts = node.namedChildren;
  if (parts.length !== 1 || parts[0]?.type !== "string_content") return null;
  return parts[0].text;
}

/** Returns the declared name of a node. */
function nodeName(node: Node): string {
  return node.childForFieldName("name")?.text ?? "";
}

/** Returns the `:nodoc:` mark of a comment on the first line of the node. */
function nodocOf(node: Node): "" | "nodoc" | "all" {
  let rows = NODOC_ROWS.get(node.tree);
  if (!rows) {
    // One pass over the comments of the tree, so each declaration costs one lookup.
    rows = new Map();
    for (const comment of node.tree.rootNode.descendantsOfType(["comment"])) {
      // The mark opens the comment. A `:nodoc:` later in the text is prose.
      const match = comment.text.match(/^#\s*:nodoc:(\s+all\b)?/);
      if (match) rows.set(comment.startPosition.row, match[1] ? "all" : "nodoc");
    }
    NODOC_ROWS.set(node.tree, rows);
  }
  return rows.get(node.startPosition.row) ?? "";
}

/**
 * Returns true when a `:nodoc:` mark on a class or module above the node hides the node.
 *
 * RDoc rule: `:nodoc: all` hides everything under the container. A bare `:nodoc:` hides the
 * methods, constants and attributes directly in the container, but not a nested class or module.
 */
function hiddenByContainer(node: Node): boolean {
  const container = node.type === "class" || node.type === "module";
  let nearest = true;
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (ancestor.type !== "class" && ancestor.type !== "module") continue;
    const mark = nodocOf(ancestor);
    if (mark === "all") return true;
    if (mark === "nodoc" && nearest && !container) return true;
    nearest = false;
  }
  return false;
}

/** Returns true when a Ruby declaration is public. */
function isExported(node: Node): boolean {
  if (nodocOf(node) !== "" || hiddenByContainer(node)) return false;
  if (node.type === "class" || node.type === "module") {
    if (hasAncestorType(node, METHOD_ANCESTORS)) return false;
    const name = nodeName(node).split("::").pop() ?? "";
    return !hidesName(bodyOf(node), name, CONSTANT_HIDERS);
  }

  if (hasAncestorType(node, NESTED_METHOD_ANCESTORS)) return false;

  const parent = node.parent;
  if (parent?.type === "argument_list") {
    const call = parent.parent;
    if (call?.type === "call") {
      const method = call.childForFieldName("method");
      if (method && INLINE_VISIBILITY.has(method.text)) return false;
    }
  }

  const body = bodyOf(node);
  const item = directChildOf(node, body);

  if (
    node.type === "method" ||
    (node.type === "singleton_method" && hasAncestorType(node, SINGLETON_CLASS))
  ) {
    let sibling = item.previousSibling;
    while (sibling) {
      if (sibling.type === "identifier" && VISIBILITY.has(sibling.text)) {
        if (sibling.text === "private" || sibling.text === "protected") {
          return false;
        }
        break;
      }
      sibling = sibling.previousSibling;
    }
  }

  if (node.type === "method") {
    if (hidesName(body, nodeName(node), METHOD_HIDERS)) return false;
  } else if (node.type === "singleton_method") {
    if (hidesName(body, nodeName(node), SINGLETON_HIDERS)) return false;
  }

  return true;
}

/** Appends identifier names from a destructured parameter. */
function collectIdentifiers(node: Node, names: string[]): void {
  if (node.type === "identifier") names.push(node.text);
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child) collectIdentifiers(child, names);
  }
}

/** Returns parameter names for a Ruby method. */
function paramsOf(node: Node): string[] {
  if (node.type !== "method" && node.type !== "singleton_method") return [];
  const parameters = node.childForFieldName("parameters");
  if (!parameters) return [];
  const names: string[] = [];
  for (let index = 0; index < parameters.childCount; index += 1) {
    const child = parameters.child(index);
    if (!child) continue;
    if (child.type === "identifier") {
      names.push(child.text);
    } else if (PARAMETER_TYPES.has(child.type)) {
      const name = child.childForFieldName("name");
      if (name) names.push(name.text);
    } else if (child.type === "destructured_parameter") {
      collectIdentifiers(child, names);
    }
  }
  return names;
}

/** Returns undefined because Ruby result inference is not requested. */
function returnsValueOf(_node: Node): boolean | undefined {
  return undefined;
}

/** Reads documentation comments into a documentation text. */
function read(run: Node[], _node: Node): DocText {
  const ordered = [...run].sort(
    (left, right) =>
      left.startPosition.row - right.startPosition.row ||
      left.startPosition.column - right.startPosition.column,
  );
  const lines: string[] = [];
  for (const comment of ordered) {
    if (comment.text.startsWith("=begin")) {
      const parts = comment.text.split(/\r?\n/);
      const body = parts.slice(1);
      if (body.at(-1)?.trim() === "") body.pop();
      body.pop();
      lines.push(...body);
    } else {
      lines.push(comment.text.replace(/^#\s?/, ""));
    }
  }

  const proseLines = lines.filter((line) => {
    const trimmed = line.trimStart();
    return !/^@\w/.test(trimmed) && !/^:[\w-]+:/.test(trimmed);
  });

  const docParams: string[] = [];
  for (const line of lines) {
    for (const match of line.matchAll(PARAM_DIRECTIVE)) {
      const name = match[1];
      if (name) docParams.push(name);
    }
  }

  const dialect = YARD_DIRECTIVE.test(lines.join("\n")) ? "yard" : "";
  const summary = firstProse(proseLines);
  const prose = proseOf(proseLines.join("\n"));

  return { docParams, summary, dialect, prose };
}

const RUBY: Reader = {
  language: "ruby",
  grammar: "ruby",
  declarations: DECLARATIONS,
  isDoc,
  isSkipped,
  docSiteOf,
  adjacentDoc,
  anchorOf,
  kindOf,
  // The keywords `class` and `module` are anonymous nodes of the same type as the declarations.
  reports: (node) => node.isNamed,
  isExported,
  paramsOf,
  returnsValueOf,
  read,
};

/** Analyses a Ruby source file and returns its report. */
export function analyseRuby(path: string, source: string): Promise<FileReport> {
  return analyseWith(RUBY, path, source);
}

/** Returns true when the text parses as Ruby. */
export function parsesAsRuby(_path: string, text: string): boolean {
  return parsesClean(parserFor("ruby"), text);
}
