/**
 * The normal form of a function body (design section 17.4) is a pre-order sequence of node labels.
 * A name or a literal gives a label without its text. A type, a comment or a parenthesis gives no
 * label. Two bodies that differ only in names, literals, types, comments or parentheses give the
 * same sequence.
 */
import type { Node } from "web-tree-sitter";

/** The result of `normalise`. */
export interface Normal {
  /** One label for each kept node, in pre-order. */
  labels: string[];
  /** The lower-case names of the identifiers of the body. */
  names: Set<string>;
}

/** The node types that name something. Each one gives the label `ID`. */
const IDENTIFIERS = new Set([
  "identifier",
  "property_identifier",
  "shorthand_property_identifier",
  "shorthand_property_identifier_pattern",
  "private_property_identifier",
  "statement_identifier",
  "undefined",
]);

/** The node types of a literal value. Each one gives the label `LIT`. */
const LITERALS = new Set(["string", "number", "regex", "true", "false", "null"]);

/** The node types that hold type syntax, and the other parts with no label. The walk skips the subtree. */
const TYPE_SYNTAX = new Set([
  "type_annotation",
  "type_arguments",
  "type_parameters",
  "type_alias_declaration",
  "interface_declaration",
  "enum_declaration",
  "ambient_declaration",
  "asserts_annotation",
  "opting_type_annotation",
  "omitting_type_annotation",
  "type_predicate_annotation",
  "accessibility_modifier",
  "override_modifier",
  "decorator",
  "comment",
]);

/**
 * The node types that wrap an expression. They give no label, and the walk goes on with the
 * wrapped expression only. A parenthesis changes the tree shape and never the meaning.
 */
const TRANSPARENT = new Set([
  "parenthesized_expression",
  "as_expression",
  "satisfies_expression",
  "non_null_expression",
  "type_assertion",
  "instantiation_expression",
]);

/** The node types of a text fragment of a template string. Each one gives the label `TPL`. */
const TEMPLATE_TEXT = new Set(["string_fragment", "escape_sequence"]);

/**
 * The wrapped expression of a transparent node. `<T>expr` writes the type first, so its expression
 * is the last named child. In every other wrapper the expression is the first named child.
 */
function wrapped(node: Node): Node | null {
  const children = node.namedChildren;
  return (node.type === "type_assertion" ? children[children.length - 1] : children[0]) ?? null;
}

/**
 * Walks `node` and appends its labels. A node whose type is in `TYPE_SYNTAX` gives nothing.
 */
function walk(node: Node, out: Normal): void {
  if (!node.isNamed) return;
  const type = node.type;
  if (TYPE_SYNTAX.has(type)) return;
  if (TRANSPARENT.has(type)) {
    const inner = wrapped(node);
    if (inner) walk(inner, out);
    return;
  }
  if (IDENTIFIERS.has(type)) {
    out.labels.push("ID");
    out.names.add(node.text.toLowerCase());
    return;
  }
  if (LITERALS.has(type)) {
    out.labels.push("LIT");
    return;
  }
  if (TEMPLATE_TEXT.has(type)) {
    out.labels.push("TPL");
    return;
  }
  // A template substitution is only a wrapper of its expression.
  if (type !== "template_substitution") {
    const operator = node.childForFieldName("operator");
    out.labels.push(operator ? `${type}:${operator.type}` : type);
  }
  for (const child of node.children) walk(child, out);
}

/** The normal form of the function body `body`. */
export function normalise(body: Node): Normal {
  const out: Normal = { labels: [], names: new Set() };
  walk(body, out);
  return out;
}
