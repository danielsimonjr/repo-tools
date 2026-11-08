/**
 * The Rust analyser of `repo-tools docs`, built on tree-sitter.
 *
 * The node kinds follow `server/parsing/languages/rust` of mintlify/writer (MIT). The doc rule
 * follows rustc: outer doc comments (`///`, not `////`, or `/** *\/`) document the next item, across
 * attributes, plain comments and blank lines. An attribute is a sibling of the item in this
 * grammar, so a stub goes above the first attribute of the item.
 *
 * The exported rule is the bare `pub`: `pub(crate)`, `pub(super)` and `pub(in path)` are not the
 * public surface. Each enclosing module must be `pub` too. An item of a trait has the visibility of
 * the trait. A method of an `impl Trait for T` block is not exported, because the doc of the
 * method is on the trait. An item inside a function body is not exported.
 */
import type { Node } from "web-tree-sitter";
import { parserFor } from "../map/grammars.ts";
import { proseOf } from "../ste/prose.ts";
import { analyseWith, type DocText, firstProse, parsesClean, type Reader } from "./comments.ts";
import type { FileReport, Kind } from "./model.ts";

/** The node types that the analyser reports, and the kind of each. */
const DECLARATIONS: Readonly<Record<string, Kind>> = {
  function_item: "function",
  function_signature_item: "method",
  struct_item: "struct",
  union_item: "struct",
  enum_item: "enum",
  trait_item: "trait",
  type_item: "type",
  const_item: "const",
  static_item: "const",
  mod_item: "module",
};

const DECLARATION_TYPES = Object.keys(DECLARATIONS);

/** The item that holds `node` as a member (`impl`, `trait`, `mod`), or null at file scope. */
const containerOf = (node: Node): Node | null =>
  node.parent?.type === "declaration_list" ? node.parent.parent : null;

/** The kind of `node`. A function in an `impl` or a `trait` block is a method. */
function kindOf(node: Node): Kind {
  const container = containerOf(node)?.type;
  if (node.type === "function_item" && (container === "impl_item" || container === "trait_item")) {
    return "method";
  }
  return DECLARATIONS[node.type] as Kind;
}

/** True when the item carries the bare `pub`. */
const isBarePub = (node: Node): boolean =>
  node.namedChildren.some((c) => c.type === "visibility_modifier" && c.text === "pub");

/** True when the item is on the public surface of its crate. */
function isExported(node: Node): boolean {
  const container = containerOf(node);
  if (container?.type === "trait_item") return isExported(container);
  if (!isBarePub(node)) return false;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === "block") return false;
    if (parent.type === "impl_item" && parent.childForFieldName("trait")) return false;
    if (parent.type === "mod_item" && !isBarePub(parent)) return false;
    if (parent.type === "trait_item") return isExported(parent);
  }
  return true;
}

/** The names that the parameters bind. `self` is not a parameter of the doc. */
function paramsOf(node: Node): string[] {
  const list = node.childForFieldName("parameters");
  if (!list) return [];
  return list.namedChildren.flatMap((param) => {
    if (param.type !== "parameter") return [];
    const pattern = param.childForFieldName("pattern");
    if (!pattern) return [];
    if (pattern.type === "identifier") return [pattern.text];
    return pattern.descendantsOfType("identifier").map((n) => n.text);
  });
}

/** True for an outer doc comment, the only comment that documents the next item. */
const isDocComment = (node: Node): boolean =>
  (node.type === "line_comment" || node.type === "block_comment") &&
  node.childForFieldName("outer") !== null;

/** True for a node that the doc walk steps over: an attribute, or a plain comment. */
const isSkipped = (node: Node): boolean =>
  node.type === "attribute_item" ||
  ((node.type === "line_comment" || node.type === "block_comment") &&
    node.childForFieldName("outer") === null &&
    node.childForFieldName("inner") === null);

/** The text lines of a run of doc comments, without the delimiters. */
function docLines(run: Node[]): string[] {
  return run.flatMap((comment) => {
    const lines = (comment.childForFieldName("doc")?.text ?? "")
      .replace(/\r?\n$/, "")
      .split(/\r?\n/);
    // A block comment can start each line with `*`. A `///` line keeps its text: `* x` is a bullet.
    return comment.type === "block_comment"
      ? lines.map((l) => l.replace(/^\s*\*(?!\/)/, ""))
      : lines;
  });
}

const HEADING = /^\s*#+\s+(.*?)\s*$/;
const SECTIONS = /^\s*#\s+(?:Arguments|Parameters|Examples|Panics|Errors|Safety|Returns)\b/m;
const BULLET = /^\s*[*-]\s+`([^`]+)`/;

/** The names that the bullets of the `# Arguments` or `# Parameters` section list. */
function docParamsOf(lines: string[]): string[] {
  const names: string[] = [];
  let inside = false;
  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading) {
      inside = /^(?:Arguments|Parameters)$/i.test(heading[1] ?? "");
      continue;
    }
    const bullet = inside ? BULLET.exec(line) : null;
    if (bullet) names.push(bullet[1] ?? "");
  }
  return names;
}

/** The node that `stub` writes above: the first attribute of the unbroken run above the item. */
function stubAnchor(node: Node): Node {
  let first = node;
  while (first.previousSibling?.type === "attribute_item") first = first.previousSibling;
  return first;
}

/** False when a function has no return type. Undefined for an item that is not a function. */
function returnsValueOf(node: Node): boolean | undefined {
  if (node.type !== "function_item" && node.type !== "function_signature_item") return undefined;
  const type = node.childForFieldName("return_type");
  return type !== null && type.text !== "()";
}

/** True when `text` parses as Rust. The grammar must be loaded (`analyseRust` loads it). */
export function parsesAsRust(_path: string, text: string): boolean {
  return parsesClean(parserFor("rust"), text);
}

/** Reads a run of Rust doc comments. */
function readDoc(run: Node[]): DocText {
  const lines = docLines(run);
  const text = lines.join("\n");
  return {
    docParams: docParamsOf(lines),
    summary: firstProse(lines.filter((l) => !HEADING.test(l))),
    dialect: SECTIONS.test(text) ? "rustdoc" : "",
    prose: proseOf(text),
  };
}

const RUST: Reader = {
  language: "rust",
  grammar: "rust",
  declarations: DECLARATION_TYPES,
  isDoc: isDocComment,
  isSkipped,
  anchorOf: stubAnchor,
  kindOf,
  isExported,
  paramsOf,
  returnsValueOf,
  read: readDoc,
};

/** Analyses one Rust source file and returns its report. */
export function analyseRust(path: string, source: string): Promise<FileReport> {
  return analyseWith(RUST, path, source);
}
