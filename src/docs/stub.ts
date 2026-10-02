/**
 * The stub writer: the only part of `repo-tools docs` that changes source files.
 *
 * Ported from `stub.py` of the code-docs skill. Five properties make the change safe. Each one
 * answers a real failure mode:
 *
 * 1. **A dry run is the default.** A write needs `--apply`. A tool that changes tracked source on
 *    its default call will run by accident.
 * 2. **An existing doc is never touched.** Only a symbol with no doc gets a stub. The tool does not
 *    rewrite, reflow or replace written prose.
 * 3. **The insertions go bottom up.** The edits apply in descending line order, so each remaining
 *    insertion point stays valid. A top-down order shifts the lines below and misplaces each later
 *    stub without a sign.
 * 4. **The file is parsed again, and a file that no longer parses is reverted.** A documentation
 *    tool that breaks source is worse than none.
 * 5. **Every stub holds the marker `TODO:`**, and the prompt text is Simplified Technical English.
 *    The gate fails on a surviving marker (rule M4), so a skeleton cannot become the finished doc.
 */
import { pyLstrip } from "../py.ts";
import { type DocSymbol, STUB_MARKER } from "./model.ts";

/** One planned stub: its text, and the 0-based line that it goes above. */
export interface Insertion {
  lineIndex: number;
  text: string;
  symbol: string;
}

/** The result of an apply. `ok` is false when nothing was written, including a revert. */
export interface Applied {
  ok: boolean;
  /** The new text when `ok`, otherwise the original text. */
  text: string;
  message: string;
}

/** The lines of `text` with their line ends. A text with no final line end keeps its last line. */
export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

const indentOf = (line: string): string => line.slice(0, line.length - pyLstrip(line).length);

const OPENERS = "([{";
const CLOSERS = ")]}";

/**
 * The code of one line: a string literal and a comment are left out. `open` is the delimiter of a
 * triple-quoted string that is still open from the line above, or an empty string. A bracket in a
 * string, or a `#` comment after the colon, must not change where a signature ends.
 */
function codeOf(line: string, open: string): { code: string; open: string } {
  let code = "";
  let string = open;
  let i = 0;
  while (i < line.length) {
    const ch = line.charAt(i);
    if (string !== "") {
      if (ch === "\\") i += 2;
      else if (line.startsWith(string, i)) {
        i += string.length;
        string = "";
      } else i += 1;
    } else if (ch === "#") {
      break;
    } else if (ch === '"' || ch === "'") {
      string = line.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
      i += string.length;
    } else {
      code += ch;
      i += 1;
    }
  }
  // Only a triple-quoted string goes on to the next line.
  return { code, open: string.length === 3 ? string : "" };
}

/**
 * The 0-based index of the line that ends the signature that starts at `start`: the first line at
 * bracket depth zero whose code ends with a colon. A signature can span lines, so the code counts
 * the depth of the brackets and does not assume one line. It returns `start` when it finds none.
 */
function headerEnd(lines: string[], start: number): number {
  let depth = 0;
  let open = "";
  for (let i = start; i < Math.min(lines.length, start + 60); i++) {
    const line = codeOf(lines[i] ?? "", open);
    open = line.open;
    for (const ch of line.code) {
      if (OPENERS.includes(ch)) depth += 1;
      else if (CLOSERS.includes(ch)) depth -= 1;
    }
    if (depth <= 0 && line.code.trimEnd().endsWith(":")) return i;
  }
  return start;
}

/**
 * Returns the insertion that documents `sym`, or null when `sym` has a doc. The Python docstring
 * goes inside the body, on the line after the end of the signature.
 */
export function planPython(sym: DocSymbol, lines: string[]): Insertion | null {
  if (sym.hasDoc) return null;
  const start = sym.line - 1;
  if (start >= lines.length) return null;
  const end = headerEnd(lines, start);
  const body = `${indentOf(lines[end] ?? "")}    `;
  const out = [`${body}"""${STUB_MARKER} state what this does, in one active-voice sentence.`];
  if (sym.params.length > 0 || sym.kind === "function") out.push("");
  if (sym.params.length > 0) {
    out.push(`${body}Args:`);
    // The entry holds no type: the signature has it (rule S5).
    for (const p of sym.params) {
      out.push(`${body}    ${p}: ${STUB_MARKER} state what it is. Do not repeat the type.`);
    }
    out.push("");
  }
  if (sym.kind === "function") {
    out.push(`${body}Returns:`, `${body}    ${STUB_MARKER} state what the caller gets back.`);
  }
  out.push(`${body}"""`);
  return { lineIndex: end + 1, text: `${out.join("\n")}\n`, symbol: sym.name };
}

/**
 * True when only white space precedes the anchor of `sym` on its line. `planTypeScript` writes the
 * block above that line. If a token comes first (the end of a template or of a comment, or another
 * declaration), the line start is not a safe place: the block could land inside a string, or above
 * the wrong declaration.
 */
export function startsItsLine(sym: DocSymbol, lines: string[]): boolean {
  const line = lines[sym.anchorLine - 1] ?? "";
  return line.slice(0, sym.anchorColumn).trim() === "";
}

/**
 * Returns the TSDoc block that documents `sym`, or null when `sym` has a doc. The block goes above
 * the anchor line of the symbol: the first line of its export statement, above any decorator.
 */
export function planTypeScript(sym: DocSymbol, lines: string[]): Insertion | null {
  if (sym.hasDoc) return null;
  const index = sym.anchorLine - 1;
  if (index >= lines.length) return null;
  const indent = indentOf(lines[index] ?? "");
  const out = [
    `${indent}/**`,
    `${indent} * ${STUB_MARKER} state what this does, in one active-voice sentence.`,
  ];
  if (sym.params.length > 0) {
    out.push(`${indent} *`);
    // The TSDoc form is `@param name - text`, with no `{type}` brace (rule S5).
    for (const p of sym.params) {
      out.push(
        `${indent} * @param ${p} - ${STUB_MARKER} state what it is. Do not repeat the type.`,
      );
    }
  }
  if (sym.kind === "function" || sym.kind === "method") {
    out.push(`${indent} * @returns ${STUB_MARKER} state what the caller gets back.`);
  }
  out.push(`${indent} */`);
  return { lineIndex: index, text: `${out.join("\n")}\n`, symbol: sym.name };
}

/**
 * Inserts the stubs into `original`, and checks the result with `verify`. The stub text has LF line
 * ends, and the code writes the line end that the file uses. `verify` gets the new text and returns
 * true when the text still parses. The module has no language knowledge, so the caller passes it.
 */
export function applyInsertions(
  original: string,
  insertions: Insertion[],
  verify: (text: string) => boolean,
): Applied {
  if (insertions.length === 0) return { ok: false, text: original, message: "no insertions" };
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = splitLines(original);
  for (const ins of [...insertions].sort((a, b) => b.lineIndex - a.lineIndex)) {
    const index = Math.max(0, Math.min(ins.lineIndex, lines.length));
    lines.splice(index, 0, eol === "\n" ? ins.text : ins.text.replace(/\n/g, eol));
  }
  const updated = lines.join("");
  if (!verify(updated)) {
    // A file that does not parse is never left on disk (property 4).
    return {
      ok: false,
      text: original,
      message: "REVERTED: the file would no longer parse after insertion",
    };
  }
  return { ok: true, text: updated, message: `inserted ${insertions.length} stub(s)` };
}
