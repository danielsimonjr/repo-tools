/**
 * The source readers of the map engine: one per language, each giving the same language-neutral
 * `ParsedModule`. Ported from `repo_map/parsing.py` of the architecture-docs skill.
 *
 * TypeScript and JavaScript use tree-sitter-typescript, the grammar that the Python tool uses, for
 * every TS and JS file (the Python tool also reads `.tsx` with the typescript grammar). Call
 * `loadGrammar` for the language before a reader runs.
 */
import type { Node } from "web-tree-sitter";
import { S, W } from "../py.ts";
import { parserFor } from "./grammars.ts";

/** One import of a module: its specifier, the names it binds, and whether it is type-only. */
export interface RawImport {
  specifier: string;
  names: string[];
  typeOnly: boolean;
  /** True for an `export ... from` statement. */
  reExport?: boolean;
  /** True for a bare side-effect import (`import './x.js';`), which binds no name. */
  sideEffect?: boolean;
}

/** The facts of one parsed source file. */
export interface ParsedModule {
  imports: RawImport[];
  /** The named exports (a default export is not one). */
  exports: string[];
  /** The namespaces this file declares (C#), or the child modules it declares (Rust `mod`). */
  provides: string[];
  /** "default" when the module has a default export, else null. */
  defaultExport: string | null;
  /** The local name of a named default declaration (`export default class Foo`), else null. */
  defaultExportLocal: string | null;
  /** The kind of each export: class, interface, type, function, const, enum or unknown. */
  exportKinds: Record<string, string>;
  /**
   * What each `export ... from` statement re-exports (depgraph's meaning): the exported names of a
   * clause, the name of `* as ns`, or `* from <spec>` and `type * from <spec>`.
   */
  reExports: string[];
  /**
   * The relative specifiers of the `import(...)` calls with a literal argument (TypeScript). The
   * graph has no edge for them (D1); test coverage counts them as loads.
   */
  dynamicImports: string[];
}

/** An empty module. */
export function emptyModule(): ParsedModule {
  return {
    imports: [],
    exports: [],
    provides: [],
    defaultExport: null,
    defaultExportLocal: null,
    exportKinds: {},
    reExports: [],
    dynamicImports: [],
  };
}

const VARIABLE_DECLARATIONS = new Set(["lexical_declaration", "variable_declaration"]);
const KIND_BY_DECLARATION: Readonly<Record<string, string>> = {
  function_declaration: "function",
  class_declaration: "class",
  interface_declaration: "interface",
  type_alias_declaration: "type",
  enum_declaration: "enum",
};
const DEFAULT_EXPORT_KIND_NODES: Readonly<Record<string, string>> = {
  class_declaration: "class",
  class: "class",
  function_declaration: "function",
  function_expression: "function",
};

/** The names that a (possibly destructuring) binding pattern binds. */
function patternNames(node: Node): string[] {
  if (node.type === "identifier" || node.type === "shorthand_property_identifier_pattern") {
    return [node.text];
  }
  if (node.type === "object_pattern" || node.type === "array_pattern") {
    const names: string[] = [];
    for (const child of node.children) {
      if (child.type === "pair_pattern") {
        const value = child.childForFieldName("value");
        if (value) names.push(...patternNames(value));
      } else if (!["{", "}", "[", "]", ","].includes(child.type)) {
        names.push(...patternNames(child));
      }
    }
    return names;
  }
  return [];
}

/** The source names that an import clause binds ("default", "*", or a named import). */
function importClauseNames(clause: Node): string[] {
  const names: string[] = [];
  for (const child of clause.children) {
    if (child.type === "identifier") names.push("default");
    else if (child.type === "namespace_import") names.push("*");
    else if (child.type === "named_imports") {
      for (const spec of child.children) {
        if (spec.type !== "import_specifier") continue;
        const name = spec.childForFieldName("name");
        if (name) names.push(name.text);
      }
    }
  }
  return names;
}

/** True when a child of `node` has the type `type`. */
const hasChild = (node: Node, type: string): boolean => node.children.some((c) => c.type === type);

/** True when the whole import produces no runtime code. */
function isTypeOnlyImport(stmt: Node, clause: Node | undefined): boolean {
  if (hasChild(stmt, "type")) return true;
  if (!clause) return false;
  const kids = clause.children.filter((c) => c.type !== ",");
  if (kids.length !== 1 || kids[0]?.type !== "named_imports") return false;
  const specifiers = kids[0].children.filter((c) => c.type === "import_specifier");
  if (specifiers.length === 0) return false;
  return specifiers.every((s) => hasChild(s, "type"));
}

/** The kind and the local name of an `export default` statement. */
function defaultExportKindAndLocal(stmt: Node): [string, string | null] {
  for (const c of stmt.children) {
    const kind = DEFAULT_EXPORT_KIND_NODES[c.type];
    if (kind !== undefined) {
      const name = c.childForFieldName("name");
      return [kind, name ? name.text : null];
    }
  }
  return ["unknown", null];
}

/** The (name, kind) pairs that an export statement binds as named exports. */
function exportEntries(stmt: Node): [string, string][] {
  const decl = stmt.childForFieldName("declaration");
  if (decl) {
    if (VARIABLE_DECLARATIONS.has(decl.type)) {
      const names: string[] = [];
      for (const declarator of decl.children) {
        if (declarator.type !== "variable_declarator") continue;
        const name = declarator.childForFieldName("name");
        if (name) names.push(...patternNames(name));
      }
      return names.map((n) => [n, "const"]);
    }
    const kind = KIND_BY_DECLARATION[decl.type];
    if (kind !== undefined) {
      const name = decl.childForFieldName("name");
      return name ? [[name.text, kind]] : [];
    }
    return [];
  }
  const entries: [string, string][] = [];
  for (const child of stmt.children) {
    if (child.type === "export_clause") {
      for (const spec of child.children) {
        if (spec.type !== "export_specifier") continue;
        const target = spec.childForFieldName("alias") ?? spec.childForFieldName("name");
        if (target) entries.push([target.text, "unknown"]);
      }
    } else if (child.type === "namespace_export") {
      const id = child.children.find((c) => c.type === "identifier");
      if (id) entries.push([id.text, "unknown"]);
    }
  }
  return entries;
}

/** The source names that an `export { ... } from` clause re-exports. */
function exportClauseSourceNames(clause: Node): string[] {
  const names: string[] = [];
  for (const spec of clause.children) {
    if (spec.type !== "export_specifier") continue;
    const name = spec.childForFieldName("name");
    if (name) names.push(name.text);
  }
  return names;
}

/** True for `export type { ... } from`, or when every specifier is inline-typed. */
function isTypeOnlyExport(stmt: Node, clause: Node): boolean {
  if (hasChild(stmt, "type")) return true;
  const specifiers = clause.children.filter((c) => c.type === "export_specifier");
  if (specifiers.length === 0) return false;
  return specifiers.every((s) => hasChild(s, "type"));
}

/** Python `str.strip(chars)`. */
function stripChars(text: string, chars: string): string {
  let a = 0;
  let b = text.length;
  while (a < b && chars.includes(text[a] as string)) a++;
  while (b > a && chars.includes(text[b - 1] as string)) b--;
  return text.slice(a, b);
}

/** The specifier text of a `source` field, without its quotes. */
const specifierOf = (node: Node): string => stripChars(node.text, "\"'`");

/** Reads one TypeScript or JavaScript file. */
export function parseTs(source: string): ParsedModule {
  const tree = parserFor("typescript").parse(source);
  if (!tree) throw new Error("tree-sitter returned no tree");
  const mod = emptyModule();
  // A pre-order walk (a node, then its children in order), as the recursive Python walk.
  const stack: Node[] = [tree.rootNode];
  while (stack.length > 0) {
    const node = stack.pop() as Node;
    if (node.type === "import_statement") {
      const spec = node.childForFieldName("source");
      if (spec) {
        const clause = node.children.find((c) => c.type === "import_clause");
        mod.imports.push({
          specifier: specifierOf(spec),
          names: clause ? importClauseNames(clause) : [],
          typeOnly: isTypeOnlyImport(node, clause),
          ...(clause ? {} : { sideEffect: true }),
        });
      }
    } else if (
      node.type === "call_expression" &&
      node.childForFieldName("function")?.type === "import"
    ) {
      const arg = node.childForFieldName("arguments")?.namedChildren[0];
      const literal =
        arg?.type === "string" ||
        (arg?.type === "template_string" && !hasChild(arg, "template_substitution"));
      if (arg && literal) {
        const spec = specifierOf(arg);
        if (spec.startsWith(".")) mod.dynamicImports.push(spec);
      }
    } else if (node.type === "export_statement") {
      if (hasChild(node, "default")) {
        const [kind, local] = defaultExportKindAndLocal(node);
        mod.defaultExport = "default";
        mod.defaultExportLocal = local;
        mod.exportKinds.default = kind;
      } else {
        for (const [name, kind] of exportEntries(node)) {
          mod.exports.push(name);
          mod.exportKinds[name] = kind;
        }
      }
      const spec = node.childForFieldName("source");
      if (spec) {
        const clause = node.children.find((c) => c.type === "export_clause");
        const nsExport = node.children.find((c) => c.type === "namespace_export");
        let names: string[] = [];
        let typeOnly = false;
        if (clause) {
          names = exportClauseSourceNames(clause);
          typeOnly = isTypeOnlyExport(node, clause);
          for (const [name] of exportEntries(node)) mod.reExports.push(name);
        } else if (nsExport) {
          names = ["*"];
          for (const [name] of exportEntries(node)) mod.reExports.push(name);
        } else {
          const typeStar = hasChild(node, "type") ? "type " : "";
          mod.reExports.push(`${typeStar}* from ${specifierOf(spec)}`);
        }
        mod.imports.push({ specifier: specifierOf(spec), names, typeOnly, reExport: true });
      }
    }
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i] as Node);
  }
  tree.delete();
  return mod;
}

/*
 * The C# and Rust readers are regex readers over source with its comments and strings blanked,
 * as in the Python tool. Two translation rules keep them identical to it:
 * - Python's MULTILINE `^` matches only after `\n`; `BOL` is that anchor (a JavaScript `m` flag
 *   would also match after `\r`, U+2028 and U+2029).
 * - Python's `.` excludes only `\n`, so it becomes `[^\n]`, and DOTALL `.` becomes `[\s\S]`.
 */
const BOL = "(?<=^|\\n)";
const ID = `[A-Za-z_]${W}*`;

/** Replaces each character of a match except `\n` with a space (one per code point). */
const blank = (m: string): string => m.replace(/[^\n]/gu, " ");

/** A named group of a match. Each name used here is a required group, so a match always has it. */
const group = (m: RegExpMatchArray, name: string): string =>
  (m.groups as Record<string, string>)[name] as string;

const CS_USING = new RegExp(
  `${BOL}[ \\t]*(?:global[ \\t]+)?using[ \\t]+(?:(?<st>static)[ \\t]+)?` +
    `(?:(?<alias>${ID})[ \\t]*=[ \\t]*)?` +
    `(?<ns>${ID}(?:[ \\t]*\\.[ \\t]*${ID})*)` +
    "(?<generic>[ \\t]*<[^;\\n]*>)?[ \\t]*;",
  "gu",
);
const CS_NAMESPACE = new RegExp(
  `${BOL}[ \\t]*namespace[ \\t]+(?<ns>${ID}(?:[ \\t]*\\.[ \\t]*${ID})*)[ \\t]*[;{\\r\\n]`,
  "gu",
);
const CS_PUBLIC_TYPE = new RegExp(
  `${BOL}[ \\t]*public[ \\t]+(?:(?:static|sealed|abstract|partial|readonly|unsafe|ref)[ \\t]+)*` +
    `(?:class|interface|record|struct|enum)[ \\t]+(?<name>${ID})`,
  "gu",
);
const CS_LINE_COMMENT = /\/\/[^\n]*/gu;
const CS_BLOCK_COMMENT = /\/\*[\s\S]*?\*\//gu;
// As in the Python source: `\.` is a literal dot, and the class excludes `"`, `\` and `n`.
const CS_STRING = /"(?:\.|[^"\\n])*"/gu;
const SPACES_TABS = /[ \t]+/g;

/** C# source with comments and strings blanked (block comments first). */
function stripCsNoise(source: string): string {
  return source
    .replace(CS_BLOCK_COMMENT, blank)
    .replace(CS_LINE_COMMENT, blank)
    .replace(CS_STRING, blank);
}

/** Reads one C# file: its `using` directives, the namespaces it declares, its public types. */
export function parseCs(source: string): ParsedModule {
  const clean = stripCsNoise(source);
  const mod = emptyModule();
  for (const m of clean.matchAll(CS_USING)) {
    const g = m.groups as Record<string, string | undefined>;
    let ns = (g.ns as string).replace(SPACES_TABS, "");
    // `using static X.T;` and an alias to a generic type name a TYPE: keep its namespace.
    if (g.st !== undefined || g.generic !== undefined) {
      const dot = ns.lastIndexOf(".");
      ns = dot === -1 ? "" : ns.slice(0, dot);
      if (ns === "") continue;
    }
    mod.imports.push({ specifier: ns, names: [], typeOnly: false });
  }
  for (const m of clean.matchAll(CS_NAMESPACE)) {
    mod.provides.push(group(m, "ns").replace(SPACES_TABS, ""));
  }
  for (const m of clean.matchAll(CS_PUBLIC_TYPE)) mod.exports.push(group(m, "name"));
  return mod;
}

const RS_MOD = new RegExp(
  `${BOL}[ \\t]*(?:pub(?:\\([^)]*\\))?[ \\t]+)?mod[ \\t]+(?<name>${ID})[ \\t]*;`,
  "gu",
);
const RS_USE = new RegExp(
  `${BOL}[ \\t]*(?:pub(?:\\([^)]*\\))?[ \\t]+)?use[ \\t]+(?<path>[^;]+);`,
  "gu",
);
const RS_PUB_ITEM = new RegExp(
  `${BOL}[ \\t]*pub[ \\t]+(?:(?:async|unsafe|extern[ \\t]+"[^"]*"|const|default)[ \\t]+)*` +
    `(?:fn|struct|enum|trait|type|union|static|const|mod)[ \\t]+(?<name>${ID})`,
  "gu",
);
const RS_LINE_COMMENT = /\/\/[^\n]*/gu;
const RS_BLOCK_COMMENT = /\/\*[\s\S]*?\*\//gu;
const RS_RAW_STRING = /r(#*)"[\s\S]*?"\1/gu;
const RS_STRING = /"(?:\\[^\n]|[^"\\\n])*"/gu;

/** Rust source with comments and strings blanked (raw strings first: they can hold `//`). */
function stripRsNoise(source: string): string {
  return source
    .replace(RS_RAW_STRING, blank)
    .replace(RS_BLOCK_COMMENT, blank)
    .replace(RS_LINE_COMMENT, blank)
    .replace(RS_STRING, blank);
}

const WHITE_RUN = new RegExp(`${S}+`, "gu");
const BRACE_REST = /\{[^\n]*/u;

/** Python `str.rstrip(chars)`. */
function rstripChars(text: string, chars: string): string {
  let b = text.length;
  while (b > 0 && chars.includes(text[b - 1] as string)) b--;
  return text.slice(0, b);
}

/**
 * The module paths of one `use` body: `a::b::{c, d as e}` gives `a::b::c` and `a::b::d`. As in
 * the Python source, `as` splits wherever the two letters occur, and a nested brace group degrades
 * to its prefix.
 */
export function expandUsePath(raw: string): string[] {
  const path = raw.replace(WHITE_RUN, "");
  if (!path.includes("{")) return [rstripChars(path.split("as")[0] as string, ":") || path];
  const brace = path.indexOf("{");
  const prefix = path.slice(0, brace);
  const inner = rstripChars(path.slice(brace + 1), "}");
  const items: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of inner) {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      items.push(current);
      current = "";
    } else current += ch;
  }
  if (current) items.push(current);
  const expanded: string[] = [];
  for (const whole of items) {
    const item = stripChars((whole.split("as")[0] as string).replace(BRACE_REST, ""), ":");
    if (!item) continue;
    expanded.push(item !== "self" ? `${prefix}${item}` : rstripChars(prefix, ":"));
  }
  return expanded.filter((e) => e !== "");
}

/**
 * Reads one Rust file. `mod foo;` is the file edge and goes to `provides`; `use` paths are name
 * imports and go to `imports`; public items are exports.
 */
export function parseRs(source: string): ParsedModule {
  const clean = stripRsNoise(source);
  const mod = emptyModule();
  for (const m of clean.matchAll(RS_MOD)) mod.provides.push(group(m, "name"));
  for (const m of clean.matchAll(RS_USE)) {
    for (const spec of expandUsePath(group(m, "path"))) {
      mod.imports.push({ specifier: spec, names: [], typeOnly: false });
    }
  }
  for (const m of clean.matchAll(RS_PUB_ITEM)) mod.exports.push(group(m, "name"));
  return mod;
}

/*
 * The Python reader. The Python tool reads Python with CPython's `ast`; this port reads it with
 * tree-sitter-python and gives the same facts:
 * - The import order is `ast.walk` order: breadth first. Among import statements, that order is
 *   the order of (ast depth, source position), because every Python statement container lists
 *   its child fields in source order. The depth is counted in ast levels, not tree-sitter levels:
 *   an `elif` nests one level deeper than the one before it, an `except` body is two levels below
 *   its `try`, and a decorator adds no level.
 * - A module that does not parse raises `SyntaxError`, as `ast.parse` does.
 */

/** One import statement found in the tree, with its ast depth. */
interface PyImportSite {
  depth: number;
  start: number;
  node: Node;
}

/** The dotted name of a `dotted_name` node, with its identifiers joined by `.` (as `ast`). */
function dottedName(node: Node): string {
  return node.children
    .filter((c) => c.type === "identifier")
    .map((c) => c.text)
    .join(".");
}

/** The imported name of a `dotted_name` or `aliased_import` child. */
function importedName(node: Node): string {
  if (node.type === "aliased_import") {
    const name = node.childForFieldName("name");
    return name ? dottedName(name) : "";
  }
  return dottedName(node);
}

/** Visits the statements of a block (or a module) at ast depth `depth`. */
function visitPyBlock(block: Node, depth: number, sites: PyImportSite[]): void {
  for (const stmt of block.children) visitPyStatement(stmt, depth, sites);
}

/** The first `block` child of `node`, if any. */
const blockOf = (node: Node): Node | undefined => node.children.find((c) => c.type === "block");

/** Visits one statement at ast depth `depth` and records each import statement in it. */
function visitPyStatement(stmt: Node, depth: number, sites: PyImportSite[]): void {
  switch (stmt.type) {
    case "import_statement":
    case "import_from_statement":
    case "future_import_statement":
      sites.push({ depth, start: stmt.startIndex, node: stmt });
      return;
    case "decorated_definition": {
      const def = stmt.childForFieldName("definition");
      if (def) visitPyStatement(def, depth, sites);
      return;
    }
    case "function_definition":
    case "class_definition":
    case "with_statement": {
      const body = stmt.childForFieldName("body");
      if (body) visitPyBlock(body, depth + 1, sites);
      return;
    }
    case "if_statement": {
      const consequence = stmt.childForFieldName("consequence");
      if (consequence) visitPyBlock(consequence, depth + 1, sites);
      let elifs = 0;
      for (const alt of stmt.children) {
        if (alt.type === "elif_clause") {
          elifs += 1;
          const body = alt.childForFieldName("consequence");
          if (body) visitPyBlock(body, depth + 1 + elifs, sites);
        } else if (alt.type === "else_clause") {
          const body = alt.childForFieldName("body");
          if (body) visitPyBlock(body, depth + 1 + elifs, sites);
        }
      }
      return;
    }
    case "for_statement":
    case "while_statement": {
      const body = stmt.childForFieldName("body");
      if (body) visitPyBlock(body, depth + 1, sites);
      for (const alt of stmt.children) {
        if (alt.type !== "else_clause") continue;
        const elseBody = alt.childForFieldName("body");
        if (elseBody) visitPyBlock(elseBody, depth + 1, sites);
      }
      return;
    }
    case "try_statement": {
      const body = stmt.childForFieldName("body");
      if (body) visitPyBlock(body, depth + 1, sites);
      for (const part of stmt.children) {
        if (part.type === "except_clause" || part.type === "except_group_clause") {
          const handler = blockOf(part);
          if (handler) visitPyBlock(handler, depth + 2, sites);
        } else if (part.type === "else_clause") {
          const elseBody = part.childForFieldName("body");
          if (elseBody) visitPyBlock(elseBody, depth + 1, sites);
        } else if (part.type === "finally_clause") {
          const fin = blockOf(part);
          if (fin) visitPyBlock(fin, depth + 1, sites);
        }
      }
      return;
    }
    case "match_statement": {
      const body = stmt.childForFieldName("body");
      for (const clause of body?.children ?? []) {
        if (clause.type !== "case_clause") continue;
        const consequence = clause.childForFieldName("consequence");
        if (consequence) visitPyBlock(consequence, depth + 2, sites);
      }
      return;
    }
    default:
      return;
  }
}

/** The RawImports of one import statement, in the order `ast` lists its aliases. */
function pyImportsOf(stmt: Node): RawImport[] {
  const names = stmt.childrenForFieldName("name").map(importedName);
  if (stmt.type === "import_statement") {
    return names.map((specifier) => ({ specifier, names: [], typeOnly: false }));
  }
  if (stmt.type === "future_import_statement") {
    return [{ specifier: "__future__", names, typeOnly: false }];
  }
  const module = stmt.childForFieldName("module_name");
  let specifier = "";
  if (module?.type === "relative_import") {
    const prefix = module.children.find((c) => c.type === "import_prefix");
    const dotted = module.children.find((c) => c.type === "dotted_name");
    specifier = (prefix?.text.replace(/[^.]/g, "") ?? "") + (dotted ? dottedName(dotted) : "");
  } else if (module) {
    specifier = dottedName(module);
  }
  const wildcard = stmt.children.some((c) => c.type === "wildcard_import");
  return [{ specifier, names: wildcard ? ["*"] : names, typeOnly: false }];
}

/** The single-character escapes of a Python str literal. */
const PY_ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\",
  "'": "'",
  '"': '"',
  a: "\x07",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

/** Decodes the body of a non-raw Python str literal as CPython does. */
function decodePyEscapes(body: string): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch !== "\\" || i === body.length - 1) {
      out += ch;
      continue;
    }
    const next = body[i + 1] as string;
    if (next === "\n") {
      i += 1;
      continue;
    }
    const simple = PY_ESCAPES[next];
    if (simple !== undefined) {
      out += simple;
      i += 1;
      continue;
    }
    const hexLen = next === "x" ? 2 : next === "u" ? 4 : next === "U" ? 8 : 0;
    if (
      hexLen > 0 &&
      /^[0-9a-fA-F]+$/.test(body.slice(i + 2, i + 2 + hexLen)) &&
      body.length >= i + 2 + hexLen
    ) {
      out += String.fromCodePoint(Number.parseInt(body.slice(i + 2, i + 2 + hexLen), 16));
      i += 1 + hexLen;
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(body.slice(i + 1));
    if (octal) {
      out += String.fromCodePoint(Number.parseInt(octal[0], 8));
      i += octal[0].length;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * The value of a `string` node as a Python str constant, or undefined when the literal is not a
 * str constant (an f-string or a bytes literal).
 */
function pyStringValue(node: Node): string | undefined {
  const start = node.children.find((c) => c.type === "string_start");
  const end = node.children.find((c) => c.type === "string_end");
  if (!start || !end) return undefined;
  const prefix = start.text.replace(/['"]+$/, "").toLowerCase();
  if (prefix.includes("f") || prefix.includes("b") || prefix.includes("t")) return undefined;
  const body = node.text.slice(start.text.length, node.text.length - end.text.length);
  return prefix.includes("r") ? body : decodePyEscapes(body);
}

/** The str value of a `string` or `concatenated_string` element, or undefined. */
function pyConstantString(node: Node): string | undefined {
  if (node.type === "string") return pyStringValue(node);
  if (node.type === "concatenated_string") {
    const parts = node.children.filter((c) => c.type === "string").map(pyStringValue);
    return parts.every((p) => p !== undefined) ? parts.join("") : undefined;
  }
  return undefined;
}

/** The targets of a plain (not annotated) assignment chain and its final value. */
function assignChain(node: Node): { targets: Node[]; value: Node | null } {
  const targets: Node[] = [];
  let cur: Node | null = node;
  while (cur && cur.type === "assignment" && !cur.childForFieldName("type")) {
    const left = cur.childForFieldName("left");
    if (left) targets.push(left);
    const right: Node | null = cur.childForFieldName("right");
    if (right?.type !== "assignment") return { targets, value: right };
    cur = right;
  }
  return { targets, value: null };
}

/** The assignment inside a top-level expression statement, if it has one. */
const assignmentOf = (stmt: Node): Node | undefined =>
  stmt.type === "expression_statement"
    ? stmt.children.find((c) => c.type === "assignment")
    : undefined;

/** The string constants of a top-level `__all__` list or tuple, or null when there is none. */
function dunderAll(module: Node): string[] | null {
  for (const stmt of module.children) {
    const assign = assignmentOf(stmt);
    if (!assign || assign.childForFieldName("type")) continue;
    const { targets, value } = assignChain(assign);
    for (const target of targets) {
      if (target.type !== "identifier" || target.text !== "__all__") continue;
      if (value && ["list", "tuple", "expression_list"].includes(value.type)) {
        return value.children.map(pyConstantString).filter((s): s is string => s !== undefined);
      }
    }
  }
  return null;
}

/** Reads one Python file: its imports in `ast.walk` order, and its exports. */
export function parsePy(source: string): ParsedModule {
  const tree = parserFor("python").parse(source);
  if (!tree) throw new Error("tree-sitter returned no tree");
  const root = tree.rootNode;
  try {
    if (root.hasError) throw new SyntaxError("the Python source does not parse");
    const mod = emptyModule();
    const sites: PyImportSite[] = [];
    visitPyBlock(root, 1, sites);
    sites.sort((a, b) => a.depth - b.depth || a.start - b.start);
    for (const site of sites) mod.imports.push(...pyImportsOf(site.node));

    const explicit = dunderAll(root);
    if (explicit !== null) {
      mod.exports = explicit;
      for (const name of explicit) mod.exportKinds[name] = "unknown";
      return mod;
    }
    const add = (name: string, kind: string): void => {
      if (name.startsWith("_")) return;
      mod.exports.push(name);
      mod.exportKinds[name] = kind;
    };
    for (const stmt of root.children) {
      const def =
        stmt.type === "decorated_definition" ? stmt.childForFieldName("definition") : stmt;
      if (def?.type === "function_definition" || def?.type === "class_definition") {
        const name = def.childForFieldName("name");
        if (name) add(name.text, def.type === "function_definition" ? "function" : "class");
        continue;
      }
      const assign = assignmentOf(stmt);
      if (!assign) continue;
      if (assign.childForFieldName("type")) {
        const left = assign.childForFieldName("left");
        if (left?.type === "identifier") add(left.text, "const");
        continue;
      }
      for (const target of assignChain(assign).targets) {
        if (target.type === "identifier") add(target.text, "const");
      }
    }
    return mod;
  } finally {
    tree.delete();
  }
}
