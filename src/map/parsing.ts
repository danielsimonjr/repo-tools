/**
 * The source readers of the map engine: one per language, each giving the same language-neutral
 * `ParsedModule`. Ported from `repo_map/parsing.py` of the architecture-docs skill.
 *
 * TypeScript and JavaScript use tree-sitter-typescript, the grammar that the Python tool uses, for
 * every TS and JS file (the Python tool also reads `.tsx` with the typescript grammar). Call
 * `loadGrammar` for the language before a reader runs.
 */
import type { Node } from "web-tree-sitter";
import { parserFor } from "./grammars.ts";

/** One import of a module: its specifier, the names it binds, and whether it is type-only. */
export interface RawImport {
  specifier: string;
  names: string[];
  typeOnly: boolean;
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
        });
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
        } else if (nsExport) {
          names = ["*"];
        }
        mod.imports.push({ specifier: specifierOf(spec), names, typeOnly });
      }
    }
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i] as Node);
  }
  tree.delete();
  return mod;
}
