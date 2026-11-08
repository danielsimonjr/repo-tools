/**
 * Analyse C and C++ translation units for documentation coverage.
 *
 * The analyser hides `extern "C"` guard lines from the parser.
 * One shared reader factory serves both grammars.
 */

import type { Node } from "web-tree-sitter";
import { parserFor } from "../map/grammars.ts";
import { proseOf } from "../ste/prose.ts";
import { analyseWith, type DocText, firstProse, parsesClean, type Reader } from "./comments.ts";
import type { FileReport, Kind } from "./model.ts";

const DECLARATIONS: readonly string[] = [
  "function_definition",
  "declaration",
  "field_declaration",
  "struct_specifier",
  "union_specifier",
  "enum_specifier",
  "class_specifier",
  "type_definition",
  "alias_declaration",
  "concept_definition",
  "namespace_definition",
];

const LEAF_TYPES: ReadonlySet<string> = new Set([
  "identifier",
  "field_identifier",
  "type_identifier",
  "qualified_identifier",
  "destructor_name",
  "operator_name",
  "operator_cast",
  "template_function",
  "template_method",
]);

const GUARD_START = /^\s*#\s*(?:ifdef\s+__cplusplus|if\s+defined\s*\(?\s*__cplusplus\s*\)?)\s*$/;
const GUARD_INNER = /^\s*(?:extern\s+"C"\s*\{?|\{|\}\s*(?:\/\/.*|\/\*.*\*\/)?)?\s*$/;
const GUARD_END = /^\s*#\s*endif\b/;

const DOC_OPEN = /^(?:\/\*\*(?![/<*])|\/\*!(?!<)|\/\/\/(?![/<])|\/\/!(?!<))/;
const DOC_META = /(?:^|\s)[@\\](?:file|mainpage|page|defgroup|addtogroup|name)\b|[@\\][{}]/;
const DIALECT_TAG =
  /(?:^|\s)[@\\](?:brief|details|param|tparam|returns?|retval|throws?|exception|note|warning|see|sa|since|deprecated|pre|post|ingroup|def|var|fn|typedef|struct|enum|copydoc)\b/;
const PLAIN_TAG = /^\s*[@\\](?!brief\b|details\b)\w+/;
const BRIEF_TAG = /^\s*[@\\](?:brief|details)\s*/;

/**
 * Split the source into lines and keep every line ending.
 */
function splitKeepEnds(source: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      lines.push(source.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < source.length) {
    lines.push(source.slice(start));
  }
  return lines;
}

/**
 * Return the line without its line ending.
 */
function bodyOf(line: string): string {
  return line.replace(/\r?\n$/, "");
}

/**
 * Replace every character except CR and LF with a space.
 */
function blankLine(line: string): string {
  return line.replace(/[^\r\n]/g, " ");
}

/**
 * Blank out `extern "C"` guard regions so the parser sees plain C++.
 *
 * The function keeps the input length unchanged.
 */
export function sanitiseGuards(source: string): string {
  const lines = splitKeepEnds(source);
  const out = lines.slice();
  let index = 0;
  while (index < lines.length) {
    const startLine = lines[index];
    if (startLine === undefined || !GUARD_START.test(bodyOf(startLine))) {
      index += 1;
      continue;
    }
    let cursor = index + 1;
    while (cursor < lines.length) {
      const innerLine = lines[cursor];
      if (innerLine === undefined) {
        break;
      }
      if (!GUARD_INNER.test(bodyOf(innerLine))) {
        break;
      }
      cursor += 1;
    }
    const endLine = lines[cursor];
    if (endLine !== undefined && GUARD_END.test(bodyOf(endLine))) {
      for (let slot = index; slot <= cursor; slot += 1) {
        const line = lines[slot];
        if (line !== undefined) {
          out[slot] = blankLine(line);
        }
      }
      index = cursor + 1;
      continue;
    }
    index += 1;
  }
  return out.join("");
}

/**
 * Tell whether two nodes describe the same source range.
 */
function sameNode(left: Node, right: Node): boolean {
  return (
    left.type === right.type &&
    left.startPosition.row === right.startPosition.row &&
    left.startPosition.column === right.startPosition.column &&
    left.endPosition.row === right.endPosition.row &&
    left.endPosition.column === right.endPosition.column
  );
}

/**
 * Return the first named child that continues a declarator chain.
 */
function nextDeclaratorChild(node: Node): Node | null {
  for (const child of node.namedChildren) {
    if (child.type.endsWith("_declarator") || LEAF_TYPES.has(child.type)) {
      return child;
    }
  }
  return null;
}

/**
 * Follow the declarator chain to its identifier-like leaf.
 */
function leafOf(start: Node): Node {
  let node: Node = start;
  for (;;) {
    if (LEAF_TYPES.has(node.type)) {
      return node;
    }
    const inner = node.childForFieldName("declarator");
    if (inner) {
      node = inner;
      continue;
    }
    if (
      node.type === "parenthesized_declarator" ||
      node.type === "reference_declarator" ||
      node.type === "variadic_declarator"
    ) {
      const next = nextDeclaratorChild(node);
      if (next) {
        node = next;
        continue;
      }
    }
    return node;
  }
}

/**
 * Tell whether a function declarator names a pointer object, not a function.
 *
 * A pointer declarator between the function declarator and the leaf makes
 * the name a variable that holds a function pointer.
 */
function namesPointerObject(fn: Node): boolean {
  let sawPointer = false;
  let node: Node | null = fn.childForFieldName("declarator");
  while (node && !LEAF_TYPES.has(node.type)) {
    if (node.type === "function_declarator") {
      return false;
    }
    if (node.type === "pointer_declarator") {
      sawPointer = true;
    }
    node =
      node.type === "parenthesized_declarator"
        ? nextDeclaratorChild(node)
        : node.childForFieldName("declarator");
  }
  return sawPointer;
}

/**
 * Return the function declarator nested in the name part of another one.
 */
function innerFunctionOf(fn: Node): Node | null {
  let node: Node | null = fn.childForFieldName("declarator");
  while (node && !LEAF_TYPES.has(node.type)) {
    if (node.type === "function_declarator") {
      return node;
    }
    node =
      node.type === "parenthesized_declarator"
        ? nextDeclaratorChild(node)
        : node.childForFieldName("declarator");
  }
  return null;
}

/**
 * Find the function declarator that one declarator start names.
 */
function functionDeclaratorFrom(start: Node): Node | null {
  let node: Node | null = start;
  while (node) {
    if (node.type === "operator_cast") {
      return node;
    }
    if (node.type === "function_declarator") {
      const inner = innerFunctionOf(node);
      if (inner) {
        // A function that returns a function pointer: the inner declarator names it.
        node = inner;
        continue;
      }
      return namesPointerObject(node) ? null : node;
    }
    if (LEAF_TYPES.has(node.type)) {
      return null;
    }
    const inner: Node | null = node.childForFieldName("declarator");
    if (inner) {
      node = inner;
      continue;
    }
    node =
      node.type === "parenthesized_declarator" || node.type === "reference_declarator"
        ? nextDeclaratorChild(node)
        : null;
  }
  return null;
}

/**
 * Find the function declarator inside a declaration node.
 */
function functionDeclaratorOf(decl: Node): Node | null {
  for (const start of decl.childrenForFieldName("declarator") ?? []) {
    const found = functionDeclaratorFrom(start);
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * Count the declarators of a declaration that name a function.
 */
function functionDeclaratorCount(decl: Node): number {
  let count = 0;
  for (const start of decl.childrenForFieldName("declarator") ?? []) {
    if (functionDeclaratorFrom(start)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Tell whether a typedef declares more names than the report can keep.
 *
 * The report keeps one name per declaration. A typedef with several
 * declarators, or a named tag with a pointer declarator, has more names.
 */
function typedefLosesName(node: Node): boolean {
  const declarators = node.childrenForFieldName("declarator") ?? [];
  if (declarators.length > 1) {
    return true;
  }
  const inner = node.childForFieldName("type");
  const first = declarators[0];
  return (
    inner !== null &&
    inner.childForFieldName("body") !== null &&
    inner.childForFieldName("name") !== null &&
    first !== undefined &&
    first.type !== "type_identifier"
  );
}

/**
 * Descend a qualified identifier to its last name segment.
 */
function lastSegment(node: Node): Node {
  let current = node;
  while (current.type === "qualified_identifier") {
    const name = current.childForFieldName("name");
    if (!name) {
      return current;
    }
    current = name;
  }
  return current;
}

/**
 * Return the readable name of a declarator leaf.
 */
function leafName(leaf: Node): string {
  const node = lastSegment(leaf);
  if (node.type === "template_function" || node.type === "template_method") {
    const name = node.childForFieldName("name");
    return name ? leafName(name) : "<anonymous>";
  }
  if (node.type === "operator_cast") {
    const target = node.childForFieldName("type");
    return target ? `operator ${target.text.replace(/\s+/g, " ")}` : "operator";
  }
  if (node.type === "operator_name") {
    return node.text.replace(/\s+/g, " ");
  }
  return node.text;
}

/**
 * Return the node itself or its enclosing template declaration.
 */
function wrapperOf(node: Node): Node {
  const parent = node.parent;
  return parent && parent.type === "template_declaration" ? parent : node;
}

/**
 * Climb to the node that owns the documentation comment.
 */
function siteOf(node: Node): Node {
  let current = node;
  for (;;) {
    const parent = current.parent;
    if (!parent) {
      return current;
    }
    if (parent.type === "template_declaration" || parent.type === "linkage_specification") {
      current = parent;
      continue;
    }
    if (
      current.type.endsWith("_specifier") &&
      (parent.type === "declaration" || parent.type === "field_declaration")
    ) {
      current = parent;
      continue;
    }
    return current;
  }
}

/**
 * Tell whether a comment node carries API documentation.
 */
function isDoc(node: Node): boolean {
  if (node.type !== "comment") {
    return false;
  }
  const text = node.text;
  return DOC_OPEN.test(text) && !DOC_META.test(text);
}

/**
 * Tell whether a comment node is a plain comment.
 */
function isSkipped(node: Node): boolean {
  return node.type === "comment" && !isDoc(node);
}

/**
 * Tell whether the node declares a reportable symbol.
 */
function reports(node: Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === "compound_statement") {
      return false;
    }
  }
  const parent = node.parent;
  if (parent && (parent.type === "function_definition" || parent.type === "friend_declaration")) {
    return false;
  }
  const type = node.type;
  if (type === "declaration" || type === "field_declaration") {
    return functionDeclaratorOf(node) !== null;
  }
  if (
    type === "struct_specifier" ||
    type === "union_specifier" ||
    type === "enum_specifier" ||
    type === "class_specifier"
  ) {
    return (
      node.childForFieldName("body") !== null &&
      node.childForFieldName("name") !== null &&
      parent?.type !== "type_definition"
    );
  }
  if (type === "namespace_definition") {
    return node.childForFieldName("name") !== null;
  }
  return true;
}

/**
 * Return the symbol kind of a reported declaration.
 */
function kindOf(node: Node): Kind {
  const type = node.type;
  const inFieldList = wrapperOf(node).parent?.type === "field_declaration_list";
  if (type === "function_definition") {
    return inFieldList ? "method" : "function";
  }
  if (type === "declaration" || type === "field_declaration") {
    return inFieldList ? "method" : "function";
  }
  if (type === "class_specifier") {
    return "class";
  }
  if (type === "struct_specifier" || type === "union_specifier") {
    return "struct";
  }
  if (type === "enum_specifier") {
    return "enum";
  }
  if (type === "type_definition") {
    const inner = node.childForFieldName("type");
    if (inner && (inner.type === "struct_specifier" || inner.type === "union_specifier")) {
      return inner.childForFieldName("body") ? "struct" : "type";
    }
    if (inner && inner.type === "enum_specifier" && inner.childForFieldName("body")) {
      return "enum";
    }
    return "type";
  }
  if (type === "alias_declaration" || type === "concept_definition") {
    return "type";
  }
  if (type === "namespace_definition") {
    return "module";
  }
  return "function";
}

/**
 * Return the declared name of a reported symbol.
 */
function nameOf(node: Node): string {
  const type = node.type;
  if (type === "function_definition" || type === "declaration" || type === "field_declaration") {
    const declarator = functionDeclaratorOf(node);
    return declarator ? leafName(leafOf(declarator)) : "<anonymous>";
  }
  if (type === "type_definition") {
    const declarators = node.childrenForFieldName("declarator");
    const first = declarators?.[0];
    return first ? leafName(leafOf(first)) : "<anonymous>";
  }
  const name = node.childForFieldName("name");
  return name ? name.text : "<anonymous>";
}

/**
 * Return the ancestor-or-self that is a direct child of the list.
 */
function directChildOf(list: Node, node: Node): Node | null {
  let current: Node | null = node;
  while (current) {
    const parent: Node | null = current.parent;
    if (!parent) {
      return null;
    }
    if (sameNode(parent, list)) {
      return current;
    }
    current = parent;
  }
  return null;
}

/**
 * Tell whether a declaration is visible outside the translation unit.
 */
function isExported(node: Node, header: boolean): boolean {
  const type = node.type;
  if (type === "function_definition" || type === "declaration" || type === "field_declaration") {
    const declarator = functionDeclaratorOf(node);
    if (declarator && leafOf(declarator).type === "qualified_identifier") {
      return false;
    }
  }
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === "compound_statement") {
      return false;
    }
    if (parent.type === "namespace_definition" && !parent.childForFieldName("name")) {
      return false;
    }
    if (parent.type === "field_declaration_list") {
      const member = directChildOf(parent, node);
      if (!member) {
        continue;
      }
      let verdict: boolean | null = null;
      for (let sibling = member.previousSibling; sibling; sibling = sibling.previousSibling) {
        if (sibling.type === "access_specifier") {
          verdict = !sibling.text.startsWith("private");
          break;
        }
      }
      if (verdict === null) {
        verdict = parent.parent?.type !== "class_specifier";
      }
      if (!verdict) {
        return false;
      }
    }
  }
  if (wrapperOf(node).parent?.type !== "field_declaration_list") {
    for (const child of node.namedChildren) {
      if (child.type === "storage_class_specifier" && child.text === "static") {
        return false;
      }
    }
  }
  return header;
}

/**
 * Return the parameter names of a function declaration.
 */
function paramsOf(node: Node): string[] {
  const declarator = functionDeclaratorOf(node);
  if (!declarator) {
    return [];
  }
  const parameters = declarator.childForFieldName("parameters");
  if (!parameters) {
    return [];
  }
  const names: string[] = [];
  for (const child of parameters.namedChildren) {
    if (
      child.type === "parameter_declaration" ||
      child.type === "optional_parameter_declaration" ||
      child.type === "variadic_parameter_declaration"
    ) {
      const inner = child.childForFieldName("declarator");
      if (inner) {
        const leaf = leafOf(inner);
        if (leaf.type === "identifier") {
          names.push(leaf.text);
        }
      }
      continue;
    }
    if (child.type === "identifier") {
      names.push(child.text);
    }
  }
  return names;
}

/**
 * Find the first descendant node of the requested type.
 */
function findDescendant(root: Node, type: string): Node | null {
  const stack: Node[] = [...root.namedChildren];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.type === type) {
      return node;
    }
    for (const child of node.namedChildren) {
      stack.push(child);
    }
  }
  return null;
}

/**
 * Tell whether the declarator chain from top to target carries a pointer.
 */
function pathHasPointer(top: Node, target: Node): boolean {
  let node: Node | null = top;
  while (node) {
    if (node.type === "pointer_declarator" || node.type === "reference_declarator") {
      return true;
    }
    if (sameNode(node, target)) {
      return false;
    }
    const inner: Node | null = node.childForFieldName("declarator");
    if (inner) {
      node = inner;
      continue;
    }
    node = node.type === "parenthesized_declarator" ? nextDeclaratorChild(node) : null;
  }
  return false;
}

/**
 * Tell whether a function returns a value, or undefined for non-functions.
 */
function returnsValueOf(node: Node): boolean | undefined {
  const kind = kindOf(node);
  if (kind !== "function" && kind !== "method") {
    return undefined;
  }
  const declarator = functionDeclaratorOf(node);
  if (declarator?.type === "operator_cast") {
    return true;
  }
  const typeNode = node.childForFieldName("type");
  if (!typeNode) {
    return false;
  }
  if (!declarator) {
    return true;
  }
  const trailing = findDescendant(declarator, "trailing_return_type");
  if (trailing) {
    return trailing.text.replace(/^\s*->\s*/, "").trim() !== "void";
  }
  if (typeNode.text.trim() === "void") {
    const top = node.childrenForFieldName("declarator")?.[0] ?? null;
    if (!top || !pathHasPointer(top, declarator)) {
      return false;
    }
  }
  return true;
}

/**
 * Find a subscript expression that indexes a call expression.
 */
function hasBadSubscript(root: Node): boolean {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.type === "subscript_expression") {
      const argument = node.childForFieldName("argument");
      if (argument && argument.type === "call_expression") {
        return true;
      }
    }
    for (const child of node.namedChildren) {
      stack.push(child);
    }
  }
  return false;
}

const MANY_NAMES =
  "parse error (a declaration declares several names, and the report keeps one name per declaration)";

/**
 * Detect a declaration that declares more names than the report can keep.
 */
function manyNames(root: Node): string | null {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.type === "type_definition" && typedefLosesName(node)) {
      return MANY_NAMES;
    }
    if (
      (node.type === "declaration" || node.type === "field_declaration") &&
      functionDeclaratorCount(node) > 1
    ) {
      return MANY_NAMES;
    }
    for (const child of node.namedChildren) {
      stack.push(child);
    }
  }
  return null;
}

/**
 * Detect a source that the C++ grammar reads wrongly, or a lost name.
 */
function misreadCpp(root: Node): string | null {
  return manyNames(root) ?? misread(root);
}

/**
 * Detect the known misparse of a function with an array-reference parameter.
 */
function misread(root: Node): string | null {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.type === "declaration") {
      const declarators = node.childrenForFieldName("declarator");
      for (const declarator of declarators ?? []) {
        if (declarator.type !== "init_declarator") {
          continue;
        }
        const value = declarator.childForFieldName("value");
        if (value?.type !== "argument_list") {
          continue;
        }
        if (hasBadSubscript(value)) {
          return "parse error (the grammar reads a function with an array-reference parameter as a variable)";
        }
      }
    }
    for (const child of node.namedChildren) {
      stack.push(child);
    }
  }
  return null;
}

/**
 * Read a doc comment run into prose, dialect and parameter data.
 */
function read(run: Node[]): DocText {
  const lines: string[] = [];
  for (const comment of run) {
    const text = comment.text;
    if (text.startsWith("///") || text.startsWith("//!")) {
      lines.push(text.replace(/^\/\/[/!] ?/, ""));
      continue;
    }
    const body = text.replace(/^\/\*[*!]/, "").replace(/\*\/$/, "");
    for (const raw of body.split("\n")) {
      lines.push(raw.replace(/\r$/, "").replace(/^\s*\* ?/, ""));
    }
  }
  const joined = lines.join("\n");
  const docParams: string[] = [];
  const paramRe = /[@\\]param(?:\s*\[[^\]]*\])?\s+(\w+)/g;
  let match = paramRe.exec(joined);
  while (match !== null) {
    const name = match[1];
    if (name) {
      docParams.push(name);
    }
    match = paramRe.exec(joined);
  }
  const kept: string[] = [];
  for (const line of lines) {
    if (PLAIN_TAG.test(line)) {
      continue;
    }
    const brief = line.match(BRIEF_TAG);
    if (brief) {
      kept.push(line.slice(brief[0].length));
      continue;
    }
    kept.push(line);
  }
  return {
    docParams,
    summary: firstProse(kept),
    dialect: DIALECT_TAG.test(joined) ? "doxygen" : "",
    prose: proseOf(kept.join("\n")),
  };
}

/**
 * Return the scope chain of a node, outermost first, joined by "::".
 *
 * The chain holds the enclosing namespace and class names, and the
 * qualifier of a qualified declarator name.
 */
function scopeOf(node: Node): string {
  const names: string[] = [];
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      parent.type === "namespace_definition" ||
      parent.type === "class_specifier" ||
      parent.type === "struct_specifier" ||
      parent.type === "union_specifier"
    ) {
      names.unshift(parent.childForFieldName("name")?.text ?? "<anonymous>");
    }
  }
  const declarator = functionDeclaratorOf(node);
  if (declarator) {
    // `S::Inner::in` nests: the scope `S` holds the name `Inner::in`. Walk every level.
    let leaf: Node | null = leafOf(declarator);
    while (leaf?.type === "qualified_identifier") {
      const scope = leaf.childForFieldName("scope");
      if (scope) {
        names.push(scope.text.replace(/\s+/g, ""));
      }
      leaf = leaf.childForFieldName("name");
    }
  }
  return names.join("::");
}

/**
 * Return the identity key of a free function, or null for other symbols.
 *
 * Two declarations of one function share the key. The driver clears the
 * export flag on an undocumented copy of a documented function.
 */
function shadowKeyOf(node: Node): string | null {
  if (kindOf(node) !== "function") {
    return null;
  }
  return JSON.stringify([scopeOf(node), nameOf(node), paramsOf(node)]);
}

/**
 * Build a reader for the given grammar and header flag.
 */
function cFamilyReader(grammar: "c" | "cpp", header: boolean): Reader {
  const reader: Reader = {
    language: "cpp",
    grammar,
    declarations: DECLARATIONS,
    isDoc,
    isSkipped,
    reports,
    docSiteOf: siteOf,
    anchorOf: siteOf,
    kindOf,
    isExported: (node) => isExported(node, header),
    nameOf,
    paramsOf,
    returnsValueOf,
    read,
    misread: grammar === "cpp" ? misreadCpp : manyNames,
    shadowKeyOf,
  };
  return reader;
}

const C_SOURCE = cFamilyReader("c", false);
const CPP_HEADER = cFamilyReader("cpp", true);
const CPP_SOURCE = cFamilyReader("cpp", false);

/**
 * Return the grammar name for a C or C++ file path.
 */
function grammarOf(path: string): "c" | "cpp" {
  return path.endsWith(".c") ? "c" : "cpp";
}

/**
 * Pick the reader that matches the file suffix.
 */
function readerFor(path: string): Reader {
  if (path.endsWith(".c")) {
    return C_SOURCE;
  }
  if (
    path.endsWith(".h") ||
    path.endsWith(".hpp") ||
    path.endsWith(".hh") ||
    path.endsWith(".hxx")
  ) {
    return CPP_HEADER;
  }
  return CPP_SOURCE;
}

/**
 * Analyse one C or C++ file and return its documentation report.
 */
export function analyseCFamily(path: string, source: string): Promise<FileReport> {
  return analyseWith(readerFor(path), path, sanitiseGuards(source));
}

/**
 * Tell whether the text parses with the grammar for the given path.
 */
export function parsesAsCFamily(path: string, text: string): boolean {
  return parsesClean(parserFor(grammarOf(path)), sanitiseGuards(text));
}
