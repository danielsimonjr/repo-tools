/**
 * The Java analyser of `repo-tools docs`, built on tree-sitter.
 * The doc rule follows javadoc.
 * The export rule covers public, protected, and implicit interface members.
 */
import type { Node } from "web-tree-sitter";
import { parserFor } from "../map/grammars.ts";
import { proseOf } from "../ste/prose.ts";
import { analyseWith, type DocText, firstProse, parsesClean, type Reader } from "./comments.ts";
import type { FileReport, Kind } from "./model.ts";

const DECLARATIONS = [
  "class_declaration",
  "interface_declaration",
  "enum_declaration",
  "record_declaration",
  "annotation_type_declaration",
  "method_declaration",
  "constructor_declaration",
  "compact_constructor_declaration",
] as const;

const KIND_BY_DECLARATION: Record<string, Kind> = {
  class_declaration: "class",
  interface_declaration: "interface",
  enum_declaration: "enum",
  record_declaration: "class",
  annotation_type_declaration: "type",
  method_declaration: "method",
  constructor_declaration: "method",
  compact_constructor_declaration: "method",
};

const TYPE_DECLARATIONS: ReadonlySet<string> = new Set([
  "class_declaration",
  "interface_declaration",
  "enum_declaration",
  "record_declaration",
  "annotation_type_declaration",
]);

const JAVADOC_DIALECT_RE =
  /@(?:param|return|throws|exception|see|since|deprecated|author|version|inheritDoc)\b|\{@(?:link|linkplain|code|literal|value|inheritDoc)\b/;

const DOC_PARAM_RE = /^\s*\*?\s*@param\s+(?!<)([\w$]+)/gm;

const INLINE_TAG_RE = /\{@\w+(?:\s+([^}]*))?\}/g;

/** Return the Java kind for a declaration node. */
function kindOfDeclaration(node: Node): Kind {
  return KIND_BY_DECLARATION[node.type] ?? "class";
}

/** Return the anonymous modifier words of a declaration. */
function modifierWords(node: Node): string[] {
  const modifiers = node.children.find((child) => child.type === "modifiers");
  if (modifiers === undefined) {
    return [];
  }
  return modifiers.children.filter((child) => !child.isNamed).map((child) => child.type);
}

/** Test whether a declaration is accessible in its own right. */
function isAccessible(node: Node): boolean {
  const words = modifierWords(node);
  if (words.includes("public") || words.includes("protected")) {
    return true;
  }
  if (words.includes("private")) {
    return false;
  }
  const parentType = node.parent?.type;
  return parentType === "interface_body" || parentType === "annotation_type_body";
}

/** Test whether a node is a type declaration. */
function isTypeDeclaration(node: Node): boolean {
  return TYPE_DECLARATIONS.has(node.type);
}

/** Test whether a declaration is exported from the public surface. */
function isExportedDeclaration(node: Node): boolean {
  if (!isAccessible(node)) {
    return false;
  }
  let parent = node.parent;
  while (parent !== null) {
    if (
      parent.type === "block" ||
      parent.type === "constructor_body" ||
      parent.type === "object_creation_expression" ||
      parent.type === "enum_constant"
    ) {
      return false;
    }
    if (isTypeDeclaration(parent) && !isAccessible(parent)) {
      return false;
    }
    parent = parent.parent;
  }
  return true;
}

/** Return the name of a formal parameter node. */
function formalParameterName(node: Node): string | undefined {
  return node.childForFieldName("name")?.text;
}

/** Return the name of a spread parameter node. */
function spreadParameterName(node: Node): string | undefined {
  const declarator = node.children.find((child) => child.type === "variable_declarator");
  return declarator?.childForFieldName("name")?.text;
}

/** Return parameter names from a formal parameters node. */
function parameterNames(parameters: Node): string[] {
  const names: string[] = [];
  for (const child of parameters.children) {
    if (child.type === "formal_parameter") {
      const name = formalParameterName(child);
      if (name !== undefined) {
        names.push(name);
      }
    } else if (child.type === "spread_parameter") {
      const name = spreadParameterName(child);
      if (name !== undefined) {
        names.push(name);
      }
    }
  }
  return names;
}

/** Return the declared parameter names for a declaration node. */
function parametersOf(node: Node): string[] {
  if (
    node.type === "method_declaration" ||
    node.type === "constructor_declaration" ||
    node.type === "record_declaration"
  ) {
    const parameters = node.childForFieldName("parameters");
    return parameters === null ? [] : parameterNames(parameters);
  }
  if (node.type === "compact_constructor_declaration") {
    const record = node.parent?.parent;
    if (record?.type === "record_declaration") {
      return parametersOf(record);
    }
  }
  return [];
}

/** Test whether a node is a Javadoc block comment. */
function isJavadoc(node: Node): boolean {
  return node.type === "block_comment" && /^\/\*\*(?!\/)/.test(node.text);
}

/** Return the contents of a Javadoc comment as clean lines. */
function javadocLines(comment: Node): string[] {
  const body = comment.text.replace(/^\/\*\*/, "").replace(/\*\/$/, "");
  return body.split("\n").map((line) => line.replace(/^\s*\*/, ""));
}

/** Extract Javadoc parameter names from comment text. */
function docParameterNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(DOC_PARAM_RE)) {
    const name = match[1];
    if (name !== undefined) {
      names.push(name);
    }
  }
  return names;
}

/** Replace Javadoc inline tags with their display text. */
function replaceInlineTags(line: string): string {
  return line.replace(INLINE_TAG_RE, "$1");
}

/** Read a run of Javadoc comments into documentation text. */
function readJavadoc(run: Node[]): DocText {
  const lines = run.flatMap(javadocLines);
  const text = lines.join("\n");
  const docParams = docParameterNames(text);
  const dialect = JAVADOC_DIALECT_RE.test(text) ? "javadoc" : "";
  const proseLines = lines.filter((line) => !line.trim().startsWith("@")).map(replaceInlineTags);
  return {
    docParams,
    summary: firstProse(proseLines),
    dialect,
    prose: proseOf(proseLines.join("\n")),
  };
}

/** Return whether a callable returns a value, when known. */
function returnsValueOfDeclaration(node: Node): boolean | undefined {
  if (node.type === "method_declaration") {
    const type = node.childForFieldName("type");
    return type !== null && type.text !== "void";
  }
  if (node.type === "constructor_declaration" || node.type === "compact_constructor_declaration") {
    return false;
  }
  return undefined;
}

/** Reader for Java declarations and Javadoc comments. */
export const JAVA: Reader = {
  language: "java",
  grammar: "java",
  declarations: DECLARATIONS,
  isDoc: isJavadoc,
  isSkipped: (node) =>
    node.type === "line_comment" || (node.type === "block_comment" && !isJavadoc(node)),
  anchorOf: (node) => node,
  kindOf: kindOfDeclaration,
  isExported: isExportedDeclaration,
  paramsOf: parametersOf,
  returnsValueOf: returnsValueOfDeclaration,
  read: (run) => readJavadoc(run),
};

/** Analyse a Java source file for documentation symbols. */
export async function analyseJava(path: string, source: string): Promise<FileReport> {
  return analyseWith(JAVA, path, source);
}

/** Return true when the text parses as Java without errors. */
export function parsesAsJava(_path: string, text: string): boolean {
  return parsesClean(parserFor("java"), text);
}
