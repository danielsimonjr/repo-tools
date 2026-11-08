/**
 * Go analyser of `repo-tools docs`, built on tree-sitter.
 * The doc rule follows go/doc: a comment run directly above a declaration gives the doc text.
 * A blank line separates a comment from its declaration and removes the doc.
 * Directive comments join the doc walk but give no text.
 * The export rule is an upper-case first letter.
 * A method is exported by its own name.
 */
import type { Node } from "web-tree-sitter";
import { parserFor } from "../map/grammars.ts";
import { proseOf } from "../ste/prose.ts";
import { analyseWith, type DocText, firstProse, parsesClean, type Reader } from "./comments.ts";
import type { FileReport, Kind } from "./model.ts";

/** Default kind of each Go declaration node. */
const DECLARATIONS: Readonly<Record<string, Kind>> = {
  function_declaration: "function",
  method_declaration: "method",
  type_spec: "type",
  type_alias: "type",
  const_spec: "const",
  var_spec: "const",
};
const DECLARATION_TYPES = Object.keys(DECLARATIONS);

/** True when `text` is a Go directive comment, such as `//go:noinline`. */
function isDirective(text: string): boolean {
  return /^\/\/(?:go:|line |export |extern |[a-z0-9]+:[a-z0-9])/.test(text);
}

/** True when `node` is a Go comment that carries doc text. */
function isDocComment(node: Node): boolean {
  return node.type === "comment" && !isDirective(node.text);
}

/** True when the doc walk steps over `node` without taking text. */
function isSkipped(node: Node): boolean {
  return node.type === "comment" && isDirective(node.text);
}

/** True when `comment` sits directly above `below`, with no blank row between them. */
function adjacentDoc(comment: Node, below: Node): boolean {
  return comment.endPosition.row >= below.startPosition.row - 1;
}

/** Node whose previous siblings hold the doc and above which the stub goes. */
function siteOf(node: Node): Node {
  switch (node.type) {
    case "type_spec":
    case "type_alias":
    case "const_spec":
    case "var_spec": {
      const parent = node.parent;
      if (parent && !parent.children.some((child) => child.type === "(")) {
        return parent;
      }
      return node;
    }
    default:
      return node;
  }
}

/** True when `node` sits inside a function body. */
function insideBlock(node: Node): boolean {
  let parent: Node | null = node.parent;
  while (parent) {
    if (parent.type === "block") return true;
    parent = parent.parent;
  }
  return false;
}

/** Kind of a Go declaration node. */
function kindOf(node: Node): Kind {
  if (node.type === "type_spec") {
    const inner = node.childForFieldName("type");
    if (inner?.type === "struct_type") return "struct";
    if (inner?.type === "interface_type") return "interface";
  }
  return DECLARATIONS[node.type] ?? "type";
}

/** True when `node` sits at top level and its name starts with an upper-case letter. */
function isExported(node: Node): boolean {
  if (insideBlock(node)) return false;
  const name = node.childForFieldName("name");
  if (!name) return false;
  return /^\p{Lu}/u.test(name.text);
}

/** Names of the parameters of a Go function or method declaration. */
function paramsOf(node: Node): string[] {
  if (node.type !== "function_declaration" && node.type !== "method_declaration") {
    return [];
  }
  const params = node.childForFieldName("parameters");
  if (!params) return [];
  const names: string[] = [];
  for (const param of params.namedChildren) {
    if (param.type === "parameter_declaration") {
      for (const name of param.childrenForFieldName("name")) {
        if (name.text !== "_") names.push(name.text);
      }
    } else if (param.type === "variadic_parameter_declaration") {
      const name = param.childForFieldName("name");
      if (name && name.text !== "_") names.push(name.text);
    }
  }
  return names;
}

/** True when a Go function or method declares a result, false when it does not. */
function returnsValueOf(node: Node): boolean | undefined {
  if (node.type !== "function_declaration" && node.type !== "method_declaration") {
    return undefined;
  }
  return node.childForFieldName("result") !== null;
}

/** Lines of one Go comment, with the comment markers removed. */
function commentLines(text: string): string[] {
  if (text.startsWith("//")) return [text.replace(/^\/\/ ?/, "")];
  const body = text.startsWith("/*") ? text.slice(2, -2) : text;
  return body.split("\n").map((line) => line.replace(/^\s*\*?\s?/, "").trimEnd());
}

/** `godoc` when the summary opens with the symbol name, an empty string otherwise. */
function dialectOf(summary: string, name: string): string {
  if (!summary || !name) return "";
  const pattern = new RegExp(`^(?:(?:A|An|The)\\s+)?${escapeRegex(name)}(?![\\p{L}\\p{N}_])`, "u");
  return pattern.test(summary) ? "godoc" : "";
}

/** Escapes `text` for literal use inside a regular expression. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Doc text of a Go comment run. */
function readDoc(run: Node[], node: Node): DocText {
  const lines = run
    .filter((comment) => !isDirective(comment.text))
    .flatMap((comment) => commentLines(comment.text));
  const summary = firstProse(lines);
  const name = node.childForFieldName("name")?.text ?? "";
  return {
    docParams: [],
    summary,
    dialect: dialectOf(summary, name),
    prose: proseOf(lines.join("\n")),
  };
}

/** True when `text` parses as Go. The grammar must be loaded (`analyseGo` loads it). */
export function parsesAsGo(_path: string, text: string): boolean {
  return parsesClean(parserFor("go"), text);
}

const GO: Reader = {
  language: "go",
  grammar: "go",
  declarations: DECLARATION_TYPES,
  isDoc: isDocComment,
  isSkipped,
  docSiteOf: siteOf,
  adjacentDoc,
  anchorOf: siteOf,
  kindOf,
  isExported,
  paramsOf,
  returnsValueOf,
  read: readDoc,
};

/** Analyses one Go source file and returns its report. */
export function analyseGo(path: string, source: string): Promise<FileReport> {
  return analyseWith(GO, path, source);
}
