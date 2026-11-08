/**
 * The docstring styles of `docs stub --style=`. Each style writes the marker on every line that
 * needs text, so the gate fails (rule M4) until a writer fills the stub. The forms follow the
 * templates of mintlify/writer (MIT). Only `jsdoc` writes a type slot, and the slot holds the marker.
 */
import { type DocSymbol, STUB_MARKER } from "./model.ts";

/** One docstring style. */
export interface Style {
  /** The style id used with `--style=`. */
  id: string;
  /** The registry id of the language, for example "python" or "csharp". */
  language: string;
  /**
   * The lines of the stub, without line ends. `indent` starts every non-empty line. For python
   * the first line opens with the triple quote and the last line is the closing triple quote.
   */
  render(sym: DocSymbol, indent: string): string[];
}

const M = STUB_MARKER;
const SUMMARY = `${M} state what this does, in one active-voice sentence.`;
const PARAM = `${M} state what it is. Do not repeat the type.`;
const RETURNS = `${M} state what the caller gets back.`;

/**
 * A Python docstring: the summary line, a blank line when a section follows, the sections, and the
 * closing quotes. `params` and `returns` give the lines of each section, or an empty list.
 */
function pythonDoc(sym: DocSymbol, I: string, params: string[], returns: string[]): string[] {
  const lines = [`${I}"""${SUMMARY}`];
  const fn = sym.kind === "function";
  if (sym.params.length > 0 || fn) lines.push("");
  if (sym.params.length > 0) lines.push(...params);
  if (fn) lines.push(...returns);
  lines.push(`${I}"""`);
  return lines;
}

function renderGoogle(sym: DocSymbol, I: string): string[] {
  const params = [`${I}Args:`, ...sym.params.map((p) => `${I}    ${p}: ${PARAM}`), ""];
  return pythonDoc(sym, I, params, [`${I}Returns:`, `${I}    ${RETURNS}`]);
}

function renderNumpy(sym: DocSymbol, I: string): string[] {
  const entries = sym.params.flatMap((p) => [`${I}${p}`, `${I}    ${PARAM}`]);
  const params = [`${I}Parameters`, `${I}----------`, ...entries, ""];
  return pythonDoc(sym, I, params, [`${I}Returns`, `${I}-------`, `${I}${RETURNS}`]);
}

function renderRest(sym: DocSymbol, I: string): string[] {
  const params = sym.params.map((p) => `${I}:param ${p}: ${PARAM}`);
  return pythonDoc(sym, I, params, [`${I}:returns: ${RETURNS}`]);
}

/**
 * A block comment: the summary line, the parameter lines after a ` *` line, the return line for a
 * function or a method, and the closing line.
 */
function blockDoc(sym: DocSymbol, I: string, param: (p: string) => string, returns: string) {
  const lines = [`${I}/**`, `${I} * ${SUMMARY}`];
  if (sym.params.length > 0) lines.push(`${I} *`, ...sym.params.map((p) => `${I} * ${param(p)}`));
  if (sym.kind === "function" || sym.kind === "method") lines.push(`${I} * ${returns}`);
  lines.push(`${I} */`);
  return lines;
}

// The TSDoc form is `@param name - text`, with no `{type}` brace (rule S5).
const renderTsdoc = (sym: DocSymbol, I: string): string[] =>
  blockDoc(sym, I, (p) => `@param ${p} - ${PARAM}`, `@returns ${RETURNS}`);

// JSDoc carries the type in a brace, and the slot holds the marker. In a TypeScript file, rule S5
// reports a filled type slot, and the writer decides. A file in JSDoc keeps one dialect (rule M5).
const renderJsdoc = (sym: DocSymbol, I: string): string[] =>
  blockDoc(
    sym,
    I,
    (p) => `@param {${M} type} ${p} ${M} state what it is.`,
    `@returns {${M} type} ${RETURNS}`,
  );

/** True when the stub of `sym` needs a line for the value that it gives back. */
const givesValue = (sym: DocSymbol): boolean =>
  (sym.kind === "function" || sym.kind === "method") && sym.returnsValue !== false;

/** The C# XML doc comment: `<summary>`, one `<param>` per parameter, and `<returns>`. */
function renderXmldoc(sym: DocSymbol, I: string): string[] {
  const lines = [`${I}/// <summary>`, `${I}/// ${SUMMARY}`, `${I}/// </summary>`];
  for (const p of sym.params) lines.push(`${I}/// <param name="${p}">${PARAM}</param>`);
  if (givesValue(sym)) lines.push(`${I}/// <returns>${RETURNS}</returns>`);
  return lines;
}

/** The Rust doc comment: the summary, then the `# Arguments` and `# Returns` sections. */
function renderRustdoc(sym: DocSymbol, I: string): string[] {
  const lines = [`${I}/// ${SUMMARY}`];
  if (sym.params.length > 0) {
    lines.push(`${I}///`, `${I}/// # Arguments`, `${I}///`);
    for (const p of sym.params) lines.push(`${I}/// * \`${p}\` - ${PARAM}`);
  }
  if (givesValue(sym)) lines.push(`${I}///`, `${I}/// # Returns`, `${I}///`, `${I}/// ${RETURNS}`);
  return lines;
}

/** True when `id` names a style of the registry. A name of an object property is not a style. */
export function isStyle(id: string): boolean {
  return Object.hasOwn(STYLES, id);
}

/** The style registry, keyed by style id. */
export const STYLES: Readonly<Record<string, Style>> = {
  google: { id: "google", language: "python", render: renderGoogle },
  numpy: { id: "numpy", language: "python", render: renderNumpy },
  rest: { id: "rest", language: "python", render: renderRest },
  tsdoc: { id: "tsdoc", language: "typescript", render: renderTsdoc },
  jsdoc: { id: "jsdoc", language: "typescript", render: renderJsdoc },
  xmldoc: { id: "xmldoc", language: "csharp", render: renderXmldoc },
  rustdoc: { id: "rustdoc", language: "rust", render: renderRustdoc },
};
