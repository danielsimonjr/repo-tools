/**
 * Compares and summarises `docs scan` reports, for the parity record in `docs/parity-docs.md`.
 *
 *   bun scripts/docs-compare.ts diff    <base/coverage.json> <new/coverage.json> [--json]
 *   bun scripts/docs-compare.ts summary <coverage.json> [--name=<repo>] [--commit=<sha>]
 *   bun scripts/docs-compare.ts triage  <coverage.json> --root=<clone> [--json]
 *
 * `diff` exits 1 on any difference. Every mode exits 2 on a bad argument or a bad report.
 * The rewrites of `triage` are measurement heuristics. They change no report.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Node } from "web-tree-sitter";
import { parsesAsCFamily } from "../src/docs/cfamily.ts";
import { parsesAsKotlin } from "../src/docs/kotlin.ts";
import { loadGrammar } from "../src/map/grammars.ts";

const GENERIC = "parse error (tree-sitter reported ERROR nodes)";
const MANY =
  "parse error (a declaration declares several names, and the report keeps one name per declaration)";
const ARRAY =
  "parse error (the grammar reads a function with an array-reference parameter as a variable)";
const DELEG = "parse error (the grammar reads the class body after a delegation as a lambda)";

const C_FAMILY_SUFFIXES = [".h", ".hpp", ".hh", ".hxx", ".c", ".cpp", ".cc", ".cxx"];
const HEADER_SUFFIXES = [".h", ".hpp", ".hh", ".hxx"];
const SYMBOL_FIELDS = [
  "exported",
  "has_doc",
  "params",
  "doc_params",
  "summary",
  "dialect",
  "issues",
] as const;

/** The cause that `triage` gives to an unparsed file. */
export type Cause =
  | "kotlin-one-line-body"
  | "delegation-valid-lambda"
  | "delegation-misread-body"
  | "cpp-export-macro"
  | "cpp-many-names"
  | "cpp-array-reference"
  | "other";

const CAUSES: Cause[] = [
  "kotlin-one-line-body",
  "delegation-valid-lambda",
  "delegation-misread-body",
  "cpp-export-macro",
  "cpp-many-names",
  "cpp-array-reference",
  "other",
];

/** The `summary` object of `coverage.json`. */
export interface CoverageSummary {
  files_scanned: number;
  files_parsed: number;
  files_unparsed: number;
  symbols: number;
  exported_symbols: number;
  exported_documented: number;
  exported_documented_pct: number;
  must_issues: number;
  should_issues: number;
  files_mixed_dialect: number;
}

/** One symbol of `coverage.json`. */
export interface CoverageSymbol {
  file: string;
  line: number;
  name: string;
  kind: string;
  exported: boolean;
  has_doc: boolean;
  params: string[];
  doc_params: string[];
  summary: string;
  dialect: string;
  issues: unknown[];
}

/** One file record of `coverage.json`. */
export interface CoverageFile {
  path: string;
  language: string;
  /** The parse error text. An empty text marks a parsed file. */
  error: string;
  dialects: string[];
  symbols: CoverageSymbol[];
}

/** The whole `coverage.json` report. */
export interface Coverage {
  summary: CoverageSummary;
  provenance: string;
  files: CoverageFile[];
}

/** The differences between two reports. Each list is sorted. */
export interface Diff {
  filesAdded: string[];
  filesRemoved: string[];
  symbolsAdded: string[];
  symbolsRemoved: string[];
  fieldChanges: string[];
  fileChanges: string[];
}

/** The options of one command line. */
export interface ParsedArgs {
  mode: "diff" | "summary" | "triage";
  files: string[];
  json: boolean;
  name?: string;
  commit?: string;
  root?: string;
}

function isMode(value: string | undefined): value is ParsedArgs["mode"] {
  return value === "diff" || value === "summary" || value === "triage";
}

/** Parses the command line, and returns the options or an error. */
export function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  const [mode, ...rest] = argv;
  if (!isMode(mode)) return { error: `unknown mode: ${mode ?? ""}` };
  const result: ParsedArgs = { mode, files: [], json: false };
  for (const arg of rest) {
    if (arg === "--json") result.json = true;
    else if (arg.startsWith("--name=")) result.name = arg.slice("--name=".length);
    else if (arg.startsWith("--commit=")) result.commit = arg.slice("--commit=".length);
    else if (arg.startsWith("--root=")) result.root = arg.slice("--root=".length);
    else if (arg.startsWith("--")) return { error: `unknown flag: ${arg}` };
    else result.files.push(arg);
  }
  const expected = mode === "diff" ? 2 : 1;
  if (result.files.length !== expected) return { error: `${mode} takes ${expected} file(s)` };
  if (mode === "triage" && !result.root) return { error: "triage needs --root=<clone>" };
  return result;
}

function symbolKey(s: CoverageSymbol): string {
  return `${s.file}:${s.line} ${s.name} ${s.kind}`;
}

function symbolsByKey(coverage: Coverage): Map<string, CoverageSymbol> {
  const map = new Map<string, CoverageSymbol>();
  for (const file of coverage.files) for (const s of file.symbols) map.set(symbolKey(s), s);
  return map;
}

function onlyIn<T>(a: Map<string, T>, b: Map<string, T>): string[] {
  return [...a.keys()].filter((k) => !b.has(k)).sort();
}

/** Compares two reports, and returns every difference. Order of files and symbols does not count. */
export function diffCoverage(base: Coverage, next: Coverage): Diff {
  const baseFiles = new Map(base.files.map((f) => [f.path, f] as const));
  const nextFiles = new Map(next.files.map((f) => [f.path, f] as const));
  const baseSymbols = symbolsByKey(base);
  const nextSymbols = symbolsByKey(next);
  const fieldChanges: string[] = [];
  for (const [key, a] of baseSymbols) {
    const b = nextSymbols.get(key);
    if (!b) continue;
    for (const field of SYMBOL_FIELDS) {
      const av = JSON.stringify(a[field]);
      const bv = JSON.stringify(b[field]);
      if (av !== bv) fieldChanges.push(`${key} ${field}: ${av} -> ${bv}`);
    }
  }
  const fileChanges: string[] = [];
  for (const [path, a] of baseFiles) {
    const b = nextFiles.get(path);
    if (!b) continue;
    for (const field of ["error", "dialects"] as const) {
      const av = JSON.stringify(a[field]);
      const bv = JSON.stringify(b[field]);
      if (av !== bv) fileChanges.push(`${path} ${field}: ${av} -> ${bv}`);
    }
  }
  return {
    filesAdded: onlyIn(nextFiles, baseFiles),
    filesRemoved: onlyIn(baseFiles, nextFiles),
    symbolsAdded: onlyIn(nextSymbols, baseSymbols),
    symbolsRemoved: onlyIn(baseSymbols, nextSymbols),
    fieldChanges: fieldChanges.sort(),
    fileChanges: fileChanges.sort(),
  };
}

/** Writes a diff as text. The last line always counts each kind of difference. */
export function renderDiff(d: Diff): string {
  const lines: string[] = [];
  const section = (title: string, items: string[], mark: string) => {
    if (items.length === 0) return;
    lines.push(title);
    for (const item of items) lines.push(`${mark}${item}`);
  };
  section("Files added:", d.filesAdded, "+ ");
  section("Files removed:", d.filesRemoved, "- ");
  section("Symbols added:", d.symbolsAdded, "+ ");
  section("Symbols removed:", d.symbolsRemoved, "- ");
  section("Field changes:", d.fieldChanges, "");
  section("File record changes:", d.fileChanges, "");
  lines.push(
    `files +${d.filesAdded.length} -${d.filesRemoved.length}, ` +
      `symbols +${d.symbolsAdded.length} -${d.symbolsRemoved.length}, ` +
      `fields changed ${d.fieldChanges.length}, file records changed ${d.fileChanges.length}`,
  );
  return lines.join("\n");
}

/** Returns true when the diff holds no difference. */
export function isEmpty(d: Diff): boolean {
  return Object.values(d).every((list: string[]) => list.length === 0);
}

/** Returns one row of the parity table, in the column order of `docs/parity-docs.md`. */
export function summaryRow(coverage: Coverage, name: string, commit: string): string {
  const s = coverage.summary;
  return (
    `| ${name} | \`${commit}\` | ${s.files_scanned} | ${s.symbols} | ${s.exported_symbols} | ` +
    `${s.exported_documented} | ${s.must_issues} | ${s.files_unparsed} |`
  );
}

function countBy(files: CoverageFile[], keyOf: (f: CoverageFile) => string | null) {
  const counts = new Map<string, number>();
  for (const file of files) {
    const key = keyOf(file);
    if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Counts the unparsed files of a report by their error text. */
export function unparsedByError(coverage: Coverage): Map<string, number> {
  return countBy(coverage.files, (f) => f.error || null);
}

/** Counts the files of a report by their language. */
export function filesByLanguage(coverage: Coverage): Map<string, number> {
  return countBy(coverage.files, (f) => f.language);
}

/** Returns the brace depth before `end`, outside double-quoted strings, or -1 inside a string. */
function braceDepthBefore(line: string, end: number): number {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < end; i += 1) {
    const ch = line[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
  }
  return inString ? -1 : depth;
}

/**
 * Writes `;` over the space before a `}` that closes a body on the line of its last member.
 * The text keeps its length, so every position stays valid.
 */
export function rewriteKotlinOneLineBody(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const end = line.trimEnd().length;
      const space = end - 2;
      if (space < 1 || line[end - 1] !== "}" || line[space] !== " ") return line;
      if (braceDepthBefore(line, space) < 1) return line;
      return `${line.slice(0, space)};${line.slice(space + 1)}`;
    })
    .join("\n");
}

/** Writes spaces over each upper-case macro name that no `(` follows. The length stays the same. */
export function rewriteCppMacros(text: string): string {
  return text.replace(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b(?!\s*\()/g, (m) => " ".repeat(m.length));
}

/** Returns true when the lambda of a delegation holds a declaration, as a misread class body does. */
export function delegationLambdaHoldsDeclaration(root: Node): boolean {
  for (const delegation of root.descendantsOfType(["explicit_delegation"])) {
    for (const lambda of delegation.descendantsOfType(["annotated_lambda"])) {
      const decls = lambda.descendantsOfType([
        "function_declaration",
        "property_declaration",
        "class_declaration",
      ]);
      if (decls.length > 0) return true;
    }
  }
  return false;
}

const hasSuffix = (path: string, suffixes: string[]) =>
  suffixes.some((s) => path.toLowerCase().endsWith(s));

/** Gives the cause of one unparsed file, from its error text and a reparse of a rewrite. */
export async function classifyUnparsed(path: string, error: string, text: string): Promise<Cause> {
  if (error === MANY) return "cpp-many-names";
  if (error === ARRAY) return "cpp-array-reference";
  if (hasSuffix(path, [".kt", ".kts"])) {
    if (error === GENERIC) {
      await loadGrammar("kotlin");
      return parsesAsKotlin(path, rewriteKotlinOneLineBody(text))
        ? "kotlin-one-line-body"
        : "other";
    }
    if (error === DELEG) {
      const tree = (await loadGrammar("kotlin")).parse(text);
      if (!tree) return "other";
      try {
        return delegationLambdaHoldsDeclaration(tree.rootNode)
          ? "delegation-misread-body"
          : "delegation-valid-lambda";
      } finally {
        tree.delete();
      }
    }
  }
  if (hasSuffix(path, C_FAMILY_SUFFIXES) && error === GENERIC) {
    await loadGrammar(path.toLowerCase().endsWith(".c") ? "c" : "cpp");
    return parsesAsCFamily(path, rewriteCppMacros(text)) ? "cpp-export-macro" : "other";
  }
  return "other";
}

const SCOPE_PARENTS = new Set(["translation_unit", "declaration_list", "linkage_specification"]);

function isExternObject(node: Node): boolean {
  if (!node.parent || !SCOPE_PARENTS.has(node.parent.type)) return false;
  if (node.descendantsOfType(["function_declarator"]).length > 0) return false;
  return node.namedChildren.some(
    (c) => c?.type === "storage_class_specifier" && c.text === "extern",
  );
}

function isPublicDataMember(field: Node): boolean {
  if (field.descendantsOfType(["function_declarator"]).length > 0) return false;
  const list = field.parent;
  const owner = list?.parent;
  if (list?.type !== "field_declaration_list" || !owner) return false;
  if (owner.type === "struct_specifier" || owner.type === "union_specifier") return true;
  if (owner.type !== "class_specifier") return false;
  let access = "private";
  for (const child of list.namedChildren) {
    if (!child) continue;
    if (child.id === field.id) break;
    if (child.type === "access_specifier") access = child.text.replace(":", "").trim();
  }
  return access === "public";
}

/** Counts function-like macros, `extern` objects and public data members in a header tree. */
export function countCppHeaderShapes(root: Node): {
  macros: number;
  externs: number;
  members: number;
} {
  return {
    macros: root.descendantsOfType(["preproc_function_def"]).length,
    externs: root.descendantsOfType(["declaration"]).filter(isExternObject).length,
    members: root.descendantsOfType(["field_declaration"]).filter(isPublicDataMember).length,
  };
}

async function readCoverage(path: string): Promise<Coverage | { error: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return { error: `cannot read a JSON report from ${path}` };
  }
  if (typeof parsed !== "object" || parsed === null) return { error: `${path} is not a report` };
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.files) || typeof record.summary !== "object" || !record.summary) {
    return { error: `${path} has no files and summary` };
  }
  return parsed as Coverage;
}

async function triage(coverage: Coverage, root: string, json: boolean): Promise<number> {
  const causes = new Map<Cause, number>();
  const totals = { headers: 0, functions: 0, macros: 0, externs: 0, members: 0 };
  for (const file of coverage.files) {
    const isHeader = hasSuffix(file.path, HEADER_SUFFIXES);
    if (!file.error && !isHeader) continue;
    let text: string;
    try {
      text = await readFile(join(root, file.path), "utf8");
    } catch {
      console.error(`cannot read ${join(root, file.path)}`);
      return 2;
    }
    if (file.error) {
      const cause = await classifyUnparsed(file.path, file.error, text);
      causes.set(cause, (causes.get(cause) ?? 0) + 1);
      continue;
    }
    const tree = (await loadGrammar("cpp")).parse(text);
    if (!tree) continue;
    try {
      const shapes = countCppHeaderShapes(tree.rootNode);
      totals.headers += 1;
      totals.macros += shapes.macros;
      totals.externs += shapes.externs;
      totals.members += shapes.members;
      totals.functions += file.symbols.filter(
        (s) => s.kind === "function" || s.kind === "method",
      ).length;
    } finally {
      tree.delete();
    }
  }
  if (json) {
    const counts = Object.fromEntries(CAUSES.map((c) => [c, causes.get(c) ?? 0]));
    console.log(JSON.stringify({ causes: counts, ...totals }, null, 2));
    return 0;
  }
  console.log("| cause | files |\n|---|---|");
  for (const cause of CAUSES) {
    const n = causes.get(cause) ?? 0;
    if (n > 0) console.log(`| ${cause} | ${n} |`);
  }
  console.log(
    `headers parsed ${totals.headers}, functions ${totals.functions}, macros ${totals.macros}, ` +
      `externs ${totals.externs}, members ${totals.members}`,
  );
  return 0;
}

/** Runs one command line, and returns its exit code. */
export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if ("error" in args) {
    console.error(args.error);
    return 2;
  }
  const reports: Coverage[] = [];
  for (const file of args.files) {
    const report = await readCoverage(file);
    if ("error" in report) {
      console.error(report.error);
      return 2;
    }
    reports.push(report);
  }
  const [first, second] = reports;
  if (!first) return 2;
  if (args.mode === "diff") {
    if (!second) return 2;
    const diff = diffCoverage(first, second);
    console.log(args.json ? JSON.stringify(diff, null, 2) : renderDiff(diff));
    return isEmpty(diff) ? 0 : 1;
  }
  if (args.mode === "summary") {
    console.log(summaryRow(first, args.name ?? "", args.commit ?? ""));
    for (const [text, n] of unparsedByError(first)) console.log(`unparsed ${n}: ${text}`);
    for (const [language, n] of filesByLanguage(first)) console.log(`files ${n}: ${language}`);
    return 0;
  }
  return triage(first, args.root ?? "", args.json);
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
