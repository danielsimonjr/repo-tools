/**
 * The data model of `repo-tools docs`. One `DocSymbol` per documentable declaration. Every language
 * analyser produces this shape, so the report, the stub writer and the gate know one shape only.
 *
 * Ported from `code_docs/model.py` of the code-docs skill.
 */

/** The kinds of declaration that an analyser reports. */
export type Kind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "const"
  | "module"
  | "struct"
  | "enum"
  | "trait"
  | "property";

/**
 * The marker that `stub` writes into every placeholder, and that `check` fails on (rule M4). The
 * writer and the gate share this one constant. If they could disagree, a stub would be invisible to
 * the gate and would ship as finished documentation.
 */
export const STUB_MARKER = "TODO:";

/** The tier of a rule. A MUST issue fails `check`. A SHOULD issue is reported only. */
export type Tier = "MUST" | "SHOULD";

/** One violation of the docstring spec against one symbol. */
export interface Issue {
  /** The rule id, for example `M1` or `S6/STE-LEN`. */
  rule: string;
  tier: Tier;
  /** The specifics, for example the name of a stale parameter. */
  detail: string;
}

/** A documentable declaration that an analyser found. */
export interface DocSymbol {
  /** The path of the file, relative to the root, with `/` separators. */
  file: string;
  /** The line of the declaration itself, from 1. It is not the line of the doc comment. */
  line: number;
  /**
   * The line above which `stub` writes a doc comment, from 1. It equals `line`, except for an
   * exported declaration with decorators, and for a declaration with tool directives directly above
   * it (`// eslint-disable-next-line`): the comment must precede both, so a directive still applies
   * to the declaration.
   */
  anchorLine: number;
  /**
   * The column of the anchor on its line, from 0. `stub` writes above the anchor line, so a token
   * before the anchor on that line (the end of a template, a second declaration) makes the place
   * unsafe. A Python symbol holds 0: its stub goes inside the body.
   */
  anchorColumn: number;
  name: string;
  kind: Kind;
  /** True for the public surface. Only an exported symbol is gated by M1. */
  exported: boolean;
  hasDoc: boolean;
  /** The parameter names of the signature. Rule M3 compares the doc against them. */
  params: string[];
  /**
   * False when the declaration gives no value back (a `void` method, a constructor, a Rust `fn`
   * with no return type), so the stub writes no return line. Absent means unknown, and the stub
   * then writes the return line for a function or a method. The field is not in `coverage.json`.
   */
  returnsValue?: boolean;
  /** The parameter names that the doc comment names. */
  docParams: string[];
  summary: string;
  /**
   * The style id that the doc shows evidence of (`google`, `numpy`, `rest`, `tsdoc`, `jsdoc`,
   * `xmldoc`, `rustdoc`, `godoc`, `javadoc`, `kdoc`), or an empty string when the doc has no
   * marker.
   */
  dialect: string;
  issues: Issue[];
}

/** The results for one file. `error` is set when the analyser could not read the file. */
export interface FileReport {
  path: string;
  /** The registry id of the language (`python`, `typescript`, `csharp`, `rust`, `go`, `java`, `kotlin`), or "". */
  language: string;
  symbols: DocSymbol[];
  dialects: Set<string>;
  error: string;
}

/**
 * True when the analyser read the file. A file that failed to parse is not a file with no symbols:
 * it is unknown, and an unknown that counts as clean is an all-clear that nothing earned.
 */
export function isParsed(report: FileReport): boolean {
  return report.error === "";
}

/** A new report with no symbol and no error. */
export function newReport(path: string, language: string): FileReport {
  return { path, language, symbols: [], dialects: new Set(), error: "" };
}

/** The aggregate counts of a run. */
export interface Stats {
  filesScanned: number;
  filesParsed: number;
  filesUnparsed: number;
  symbols: number;
  exportedSymbols: number;
  exportedDocumented: number;
  /** The percentage over the exported symbols, with one decimal. 100 when none is exported. */
  exportedDocumentedPct: number;
  mustIssues: number;
  shouldIssues: number;
  filesMixedDialect: number;
}
