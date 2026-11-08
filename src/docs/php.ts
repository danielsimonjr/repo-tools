/**
 * Analyse PHP sources for the `repo-tools docs` command.
 */

import type { Node } from "web-tree-sitter";
import { parserFor } from "../map/grammars.ts";
import { proseOf } from "../ste/prose.ts";
import { analyseWith, type DocText, firstProse, parsesClean, type Reader } from "./comments.ts";
import type { FileReport, Kind } from "./model.ts";

/** The declaration node types that become documentation symbols. */
const DECLARATIONS: readonly string[] = [
  "function_definition",
  "method_declaration",
  "class_declaration",
  "interface_declaration",
  "trait_declaration",
  "enum_declaration",
];

/** The type declaration node types that hold members. */
const TYPE_DECLARATIONS: readonly string[] = [
  "class_declaration",
  "interface_declaration",
  "trait_declaration",
  "enum_declaration",
];

/** The parameter node types that carry a variable name. */
const PARAMETER_TYPES: readonly string[] = [
  "simple_parameter",
  "variadic_parameter",
  "property_promotion_parameter",
];

/** A doc comment starts with exactly two stars. */
const DOC_COMMENT = /^\/\*\*(?!\/)/;

/** The PHPDoc tags that mark a doc block as phpdoc. */
const PHPDOC_TAG =
  /@(?:param|return|var|throws|method|property(?:-read|-write)?|deprecated|see|since|inheritdoc|template|api|internal|link|mixin|psalm-\w+|phpstan-\w+)\b|\{@inheritdoc\}/i;

/** An inline tag such as `{@link Foo}` or `{@inheritDoc}`. The text after the tag name stays. */
const INLINE_TAG = /\{@\w+(?:\s+([^}]*))?\}/g;

/** Collect the parent chain of one node, nearest first. */
function ancestorsOf(node: Node): Node[] {
  const chain: Node[] = [];
  let current: Node | null = node.parent;
  while (current !== null) {
    chain.push(current);
    current = current.parent;
  }
  return chain;
}

/** Return the first node of one type, or null when the subtree has none. */
function firstOfType(node: Node, type: string): Node | null {
  if (node.type === type) return node;
  for (const child of node.namedChildren) {
    const hit = firstOfType(child, type);
    if (hit !== null) return hit;
  }
  return null;
}

/** Return true when the node is a PHPDoc block comment. */
function isDoc(node: Node): boolean {
  return node.type === "comment" && DOC_COMMENT.test(node.text);
}

/** Return true when the node is a comment that carries no documentation. */
function isSkipped(node: Node): boolean {
  return node.type === "comment" && !DOC_COMMENT.test(node.text);
}

/** Return true when the upper comment still documents the lower node. */
function adjacentDoc(_comment: Node, below: Node): boolean {
  return !isDoc(below);
}

/** Return the node that carries the documentation anchor line. */
function anchorOf(node: Node): Node {
  return node;
}

/** Map one PHP declaration node to its documentation kind. */
function kindOf(node: Node): Kind {
  switch (node.type) {
    case "function_definition":
      return "function";
    case "method_declaration":
      return "method";
    case "class_declaration":
      return "class";
    case "interface_declaration":
      return "interface";
    case "trait_declaration":
      return "trait";
    case "enum_declaration":
      return "enum";
    default:
      return "function";
  }
}

/** Return true when the declaration is visible outside its own file. */
function isExported(node: Node): boolean {
  const ancestors = ancestorsOf(node);
  for (const ancestor of ancestors) {
    if (ancestor.type === "anonymous_class") return false;
    if (
      ancestor.type === "compound_statement" &&
      ancestor.parent?.type !== "namespace_definition"
    ) {
      return false;
    }
  }
  if (node.type === "method_declaration") {
    for (const child of node.namedChildren) {
      if (child.type === "visibility_modifier" && child.text === "private") return false;
    }
  }
  for (const ancestor of ancestors) {
    if (TYPE_DECLARATIONS.includes(ancestor.type) && !isExported(ancestor)) return false;
  }
  return true;
}

/** Return the parameter names of one function or method node. */
function paramsOf(node: Node): string[] {
  if (node.type !== "function_definition" && node.type !== "method_declaration") return [];
  const parameters = node.childForFieldName("parameters");
  if (parameters === null) return [];
  const names: string[] = [];
  for (const child of parameters.namedChildren) {
    if (!PARAMETER_TYPES.includes(child.type)) continue;
    const holder = child.childForFieldName("name");
    if (holder === null) continue;
    const hit = firstOfType(holder, "name");
    if (hit !== null) names.push(hit.text);
  }
  return names;
}

/** Return true when the function returns a value, or undefined when unsaid. */
function returnsValueOf(node: Node): boolean | undefined {
  if (node.type !== "function_definition" && node.type !== "method_declaration") return undefined;
  const returnType = node.childForFieldName("return_type");
  if (returnType === null) return undefined;
  if (returnType.type === "bottom_type") return false;
  const text = returnType.text.replace(/^:/, "").trim();
  if (text === "void" || text === "never") return false;
  return true;
}

/** Return the cleaned text lines of one doc comment run. */
function docLines(run: Node[]): string[] {
  const lines: string[] = [];
  for (const comment of run) {
    for (const raw of comment.text.split("\n")) {
      let line = raw.replace(/^\s*\/\*\*/, "");
      line = line.replace(/\*\/\s*$/, "");
      line = line.replace(/^\s*\* ?/, "");
      lines.push(line.trim());
    }
  }
  return lines;
}

/** Return the parameter names that the doc block tags mention. */
function docParamNames(text: string): string[] {
  const names: string[] = [];
  const pattern = /@param\b[^$\n]*\$(\w+)/g;
  let match = pattern.exec(text);
  while (match !== null) {
    const name = match[1];
    if (typeof name === "string") names.push(name);
    match = pattern.exec(text);
  }
  return names;
}

/** Read one doc comment run and return its documentation text. */
function read(run: Node[], _node: Node): DocText {
  const lines = docLines(run);
  const proseLines = lines
    .filter((line) => !line.startsWith("@"))
    .map((line) => line.replace(INLINE_TAG, "$1"));
  const text = lines.join("\n");
  return {
    docParams: docParamNames(text),
    summary: firstProse(proseLines),
    dialect: PHPDOC_TAG.test(text) ? "phpdoc" : "",
    prose: proseOf(proseLines.join("\n")),
  };
}

/** The reader that describes the PHP grammar to the docs driver. */
const PHP: Reader = {
  language: "php",
  grammar: "php",
  declarations: DECLARATIONS,
  isDoc,
  isSkipped,
  adjacentDoc,
  anchorOf,
  kindOf,
  isExported,
  paramsOf,
  returnsValueOf,
  read,
};

/** Analyse one PHP file and return its documentation report. */
export function analysePhp(path: string, source: string): Promise<FileReport> {
  return analyseWith(PHP, path, source);
}

/** Return true when the text parses with the PHP grammar. */
export function parsesAsPhp(_path: string, text: string): boolean {
  return parsesClean(parserFor("php"), text);
}
