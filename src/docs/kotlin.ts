/**
 * The Kotlin analyser of `repo-tools docs` builds on tree-sitter.
 * The doc rule follows KDoc: the last doc block above, across annotations, plain comments and blank lines.
 * Declarations are public by default.
 * `private` or `internal` is not the public surface.
 * The grammar gives a parse error for a class body that closes on the line of its last member.
 * The grammar reads a class body after a delegation (`class A : B by c { }`) as a trailing lambda.
 * The analyser reports such a file as unparsed.
 */
import type { Node } from "web-tree-sitter";
import { parserFor } from "../map/grammars.ts";
import { proseOf } from "../ste/prose.ts";
import { analyseWith, type DocText, firstProse, parsesClean, type Reader } from "./comments.ts";
import type { FileReport, Kind } from "./model.ts";

const DECLARATIONS = [
  "class_declaration",
  "object_declaration",
  "function_declaration",
  "type_alias",
  "property_declaration",
] as const;

const RETURN_TYPES = new Set(["user_type", "nullable_type", "function_type", "parenthesized_type"]);

/**
 * Reports whether a node is a KDoc block comment.
 */
const isDocNode = (node: Node): boolean =>
  node.type === "block_comment" && /^\/\*\*(?!\/)/.test(node.text);

/**
 * Returns the direct child of a node with the given type.
 */
const directChildOfType = (node: Node, type: string): Node | undefined =>
  node.children.find((child) => child.type === type);

/**
 * Returns the text of the first direct identifier child.
 */
const directIdentifierOf = (node: Node): string | undefined =>
  directChildOfType(node, "identifier")?.text;

/**
 * Returns the name of a property declaration.
 */
const propertyNameOf = (node: Node): string | undefined => {
  const variable = directChildOfType(node, "variable_declaration");
  if (variable !== undefined) return directIdentifierOf(variable);
  const multiple = directChildOfType(node, "multi_variable_declaration");
  if (multiple === undefined) return undefined;
  const first = directChildOfType(multiple, "variable_declaration");
  return first === undefined ? undefined : directIdentifierOf(first);
};

/**
 * Returns the kind of a class declaration.
 */
const classKindOf = (node: Node): Kind => {
  if (node.children.some((child) => child.type === "interface")) return "interface";
  const modifiers = directChildOfType(node, "modifiers");
  const isEnum =
    true ===
    modifiers?.children.some((child) => child.type === "class_modifier" && child.text === "enum");
  return isEnum ? "enum" : "class";
};

/**
 * Returns the documented kind of a Kotlin declaration.
 */
const kindOfKotlin = (node: Node): Kind => {
  switch (node.type) {
    case "class_declaration":
      return classKindOf(node);
    case "object_declaration":
      return "class";
    case "function_declaration": {
      const parent = node.parent;
      return parent !== null && (parent.type === "class_body" || parent.type === "enum_class_body")
        ? "method"
        : "function";
    }
    case "type_alias":
      return "type";
    case "property_declaration":
      return "property";
    default:
      return "function";
  }
};

/**
 * Returns the declared name of a Kotlin declaration.
 */
const nameOfKotlin = (node: Node): string => {
  if (node.type === "type_alias") {
    const type = node.childForFieldName("type");
    return type?.text ?? "<anonymous>";
  }
  if (node.type === "property_declaration") {
    return propertyNameOf(node) ?? "<anonymous>";
  }
  const name = node.childForFieldName("name");
  return name?.text ?? "<anonymous>";
};

/**
 * Reports whether the declaration itself has accessible visibility.
 */
const hasAccessibleVisibility = (node: Node): boolean => {
  const modifiers = directChildOfType(node, "modifiers");
  if (modifiers === undefined) return true;
  const visibility = directChildOfType(modifiers, "visibility_modifier");
  if (visibility === undefined) return true;
  return visibility.text === "public" || visibility.text === "protected";
};

/**
 * Reports whether a declaration belongs to the public surface.
 */
const isExportedKotlin = (node: Node): boolean => {
  if (!hasAccessibleVisibility(node)) return false;
  let current = node.parent;
  while (current !== null) {
    switch (current.type) {
      case "function_body":
      case "block":
      case "lambda_literal":
      case "anonymous_function":
      case "object_literal":
        return false;
      case "class_declaration":
      case "object_declaration":
      case "companion_object":
        if (!hasAccessibleVisibility(current)) return false;
        break;
      default:
        break;
    }
    current = current.parent;
  }
  return true;
};

/**
 * Returns the parameter names of a function or class declaration.
 */
const paramsOfKotlin = (node: Node): string[] => {
  if (node.type === "function_declaration") {
    const parameters = directChildOfType(node, "function_value_parameters");
    if (parameters === undefined) return [];
    return parameters.children
      .filter((child) => child.type === "parameter")
      .map((child) => directIdentifierOf(child))
      .filter((name): name is string => name !== undefined);
  }
  if (node.type === "class_declaration") {
    const primary = directChildOfType(node, "primary_constructor");
    if (primary === undefined) return [];
    const parameters = directChildOfType(primary, "class_parameters");
    if (parameters === undefined) return [];
    return parameters.children
      .filter((child) => child.type === "class_parameter")
      .map((child) => directIdentifierOf(child))
      .filter((name): name is string => name !== undefined);
  }
  return [];
};

/**
 * Reports whether a function returns a value, or gives undefined for an expression body.
 */
const returnsValueOfKotlin = (node: Node): boolean | undefined => {
  if (node.type !== "function_declaration") return undefined;
  const children = node.children;
  const start = children.findIndex((child) => child.type === "function_value_parameters");
  const type = children.slice(start + 1).find((child) => RETURN_TYPES.has(child.type));
  if (type !== undefined) return type.text.replace(/^kotlin\./, "") !== "Unit";
  const body = directChildOfType(node, "function_body");
  if (body === undefined) return undefined;
  return body.children.some((child) => child.type === "block") ? false : undefined;
};

/**
 * Returns a parse error when a delegation holds a call with a trailing lambda, or null.
 * The grammar reads the class body after `B by c` as that lambda, so each member looks local.
 */
const misreadKotlin = (root: Node): string | null =>
  root
    .descendantsOfType("explicit_delegation")
    .some((delegation) =>
      delegation.children.some(
        (child) =>
          child.type === "call_expression" &&
          child.children.some((part) => part.type === "annotated_lambda"),
      ),
    )
    ? "parse error (the grammar reads the class body after a delegation as a lambda)"
    : null;

/**
 * Splits a KDoc comment into cleaned lines.
 */
const docLinesOf = (text: string): string[] => {
  const inner = text.replace(/^\/\*\*/, "").replace(/\*\/\s*$/, "");
  return inner.split("\n").map((line) => line.replace(/^\s*\*+\s?/, "").trim());
};

/**
 * Returns the documented parameter names in a set of KDoc lines.
 */
const docParamsOf = (lines: readonly string[]): string[] => {
  const names: string[] = [];
  for (const line of lines) {
    for (const match of line.matchAll(/@(?:param|property)(?=\s|\[)\s*\[?([\w$]+)\]?/g)) {
      const name = match[1];
      if (name !== undefined) names.push(name);
    }
  }
  return names;
};

/**
 * Returns "kdoc" when the lines contain a KDoc tag, or an empty string.
 */
const dialectOf = (lines: readonly string[]): string =>
  /@(?:param|return|property|constructor|receiver|throws|exception|sample|see|since|suppress|author)\b/.test(
    lines.join("\n"),
  )
    ? "kdoc"
    : "";

/**
 * Reads a run of KDoc comments into a document text.
 */
const readKotlin = (run: Node[], _node: Node): DocText => {
  const lines = run.flatMap((comment) => docLinesOf(comment.text));
  const content = lines.filter((line) => !line.startsWith("@"));
  return {
    docParams: docParamsOf(lines),
    summary: firstProse(content),
    dialect: dialectOf(lines),
    prose: proseOf(content.join("\n")),
  };
};

export const KOTLIN: Reader = {
  language: "kotlin",
  grammar: "kotlin",
  declarations: DECLARATIONS,
  isDoc: isDocNode,
  isSkipped: (node) =>
    node.type === "line_comment" || (node.type === "block_comment" && !isDocNode(node)),
  anchorOf: (node) => node,
  nameOf: nameOfKotlin,
  kindOf: kindOfKotlin,
  isExported: isExportedKotlin,
  paramsOf: paramsOfKotlin,
  returnsValueOf: returnsValueOfKotlin,
  read: readKotlin,
  misread: misreadKotlin,
};

/**
 * Analyses one Kotlin source file.
 */
export const analyseKotlin = (path: string, source: string): Promise<FileReport> =>
  analyseWith(KOTLIN, path, source);

/**
 * Reports whether the text parses without errors as Kotlin.
 */
export const parsesAsKotlin = (_path: string, text: string) =>
  parsesClean(parserFor("kotlin"), text);
