/**
 * The function units of one parsed file (design section 17.3). A unit is a function with a name
 * and a body of at least `minNodes` labels.
 */
import { createHash } from "node:crypto";
import type { Node } from "web-tree-sitter";
import { normalise } from "./normalise.ts";

/** The kind of a unit (design section 17.3). */
export type UnitKind = "function" | "local" | "method" | "ctor" | "get" | "set" | "field" | "prop";

/** One function of the source. */
export interface Unit {
  file: string;
  name: string;
  /** The name of the nearest class, or an empty string. */
  container: string;
  kind: UnitKind;
  exported: boolean;
  /** The first line of the declaration, with its `export` keyword. */
  startLine: number;
  /** The last line of the function. */
  endLine: number;
  loc: number;
  params: number;
  async: boolean;
  /** The number of labels of the body. */
  nodes: number;
  /** The JSDoc text before the first tag, cut to `DOC_LIMIT` characters. */
  doc: string;
  /** The hash of the label sequence. */
  exactHash: string;
  /** The hash of the body text without white space. */
  textHash: string;
  /** The offsets of the function in the file. The nesting test uses them. */
  startIndex: number;
  endIndex: number;
  /** The label sequence of the body. */
  labels: string[];
  /** The lower-case identifier names of the body. */
  names: Set<string>;
}

/** The most characters of the `doc` field. */
export const DOC_LIMIT = 160;

/** The node types of a function value. */
const FUNCTION_VALUES = new Set([
  "arrow_function",
  "function_expression",
  "function",
  "generator_function",
]);

/** The node types of a class. */
const CLASSES = new Set(["class_declaration", "abstract_class_declaration", "class"]);

/** The name given to a class that has none. */
const ANONYMOUS_CLASS = "(class)";

/** A function that a node declares: the function node, its name, its kind and its first node. */
interface Declared {
  fn: Node;
  name: string;
  kind: UnitKind;
  anchor: Node;
}

/** A short hash of `text`. */
function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

/** The name that a key node gives: a string key loses its quotes. */
function keyName(key: Node | null): string | null {
  if (!key) return null;
  return key.type === "string" ? key.text.slice(1, -1) : key.text;
}

/** True when `node` has an unnamed child of type `token` (for example `async`, `get`). */
function hasToken(node: Node, token: string): boolean {
  return node.children.some((c) => !c.isNamed && c.type === token);
}

/** The first node of a declaration: the node itself, or the statement that holds it. */
function anchorOf(node: Node): Node {
  let anchor = node;
  if (node.type === "variable_declarator" && node.parent) anchor = node.parent;
  if (anchor.parent?.type === "export_statement") anchor = anchor.parent;
  return anchor;
}

/** The function that `node` declares, or null. */
function declared(node: Node, container: string): Declared | null {
  switch (node.type) {
    case "function_declaration":
    case "generator_function_declaration": {
      const name = keyName(node.childForFieldName("name"));
      if (!name) return null;
      return { fn: node, name, kind: container ? "local" : "function", anchor: anchorOf(node) };
    }
    case "method_definition": {
      const name = keyName(node.childForFieldName("name"));
      if (!name) return null;
      const inClass = node.parent?.type === "class_body";
      let kind: UnitKind = "prop";
      if (inClass) {
        if (name === "constructor") kind = "ctor";
        else if (hasToken(node, "get")) kind = "get";
        else if (hasToken(node, "set")) kind = "set";
        else kind = "method";
      }
      return { fn: node, name, kind, anchor: node };
    }
    case "public_field_definition": {
      const value = node.childForFieldName("value");
      const name = keyName(node.childForFieldName("name"));
      if (!value || !name || !FUNCTION_VALUES.has(value.type)) return null;
      return { fn: value, name, kind: "field", anchor: node };
    }
    case "variable_declarator": {
      const value = node.childForFieldName("value");
      const id = node.childForFieldName("name");
      if (!value || !id || id.type !== "identifier" || !FUNCTION_VALUES.has(value.type)) {
        return null;
      }
      return {
        fn: value,
        name: id.text,
        kind: container ? "local" : "function",
        anchor: anchorOf(node),
      };
    }
    case "pair": {
      const value = node.childForFieldName("value");
      const name = keyName(node.childForFieldName("key"));
      if (!value || !name || !FUNCTION_VALUES.has(value.type)) return null;
      return { fn: value, name, kind: "prop", anchor: node };
    }
    default:
      return null;
  }
}

/** The number of parameters of the function `fn`. */
function paramCount(fn: Node): number {
  const list = fn.childForFieldName("parameters");
  if (list) return list.namedChildren.filter((c) => c.type !== "comment").length;
  return fn.childForFieldName("parameter") ? 1 : 0;
}

/**
 * The JSDoc text directly above `anchor`.
 * The text is the comment before the first tag, joined to one line and cut to `DOC_LIMIT` characters.
 * Only white space may stand between the end of the comment and the declaration.
 */
function docOf(anchor: Node, source: string): string {
  const comment = anchor.previousSibling;
  if (comment?.type !== "comment" || !comment.text.startsWith("/**")) return "";
  if (source.slice(comment.endIndex, anchor.startIndex).trim() !== "") return "";
  const lines = comment.text
    .slice(3, -2)
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim());
  const tag = lines.findIndex((line) => line.startsWith("@"));
  const text = (tag === -1 ? lines : lines.slice(0, tag)).filter((line) => line !== "");
  return text.join(" ").slice(0, DOC_LIMIT);
}

/** Builds the unit of `d`, or returns null when its body is missing or has too few labels. */
function buildUnit(
  d: Declared,
  container: string,
  source: string,
  file: string,
  minNodes: number,
): Unit | null {
  const body = d.fn.childForFieldName("body");
  if (!body) return null;
  const { labels, names } = normalise(body);
  if (labels.length < minNodes) return null;
  const startLine = d.anchor.startPosition.row + 1;
  const endLine = d.fn.endPosition.row + 1;
  return {
    file,
    name: d.name,
    container,
    kind: d.kind,
    exported: d.anchor.type === "export_statement",
    startLine,
    endLine,
    loc: endLine - startLine + 1,
    params: paramCount(d.fn),
    async: hasToken(d.fn, "async"),
    nodes: labels.length,
    doc: docOf(d.anchor, source),
    exactHash: sha1(labels.join(" ")),
    textHash: sha1(source.slice(body.startIndex, body.endIndex).replace(/\s+/g, "")),
    startIndex: d.fn.startIndex,
    endIndex: d.fn.endIndex,
    labels,
    names,
  };
}

/**
 * The units of the parsed file `root`, in document order. `source` is the text that was parsed.
 * `file` is the POSIX path that the units carry.
 */
export function unitsOf(root: Node, source: string, file: string, minNodes: number): Unit[] {
  const units: Unit[] = [];
  const visit = (node: Node, container: string): void => {
    const found = declared(node, container);
    if (found) {
      const unit = buildUnit(found, container, source, file, minNodes);
      if (unit) units.push(unit);
    }
    let inner = container;
    if (CLASSES.has(node.type)) {
      inner = keyName(node.childForFieldName("name")) ?? (container || ANONYMOUS_CLASS);
    }
    for (const child of node.namedChildren) visit(child, inner);
  };
  visit(root, "");
  return units;
}
