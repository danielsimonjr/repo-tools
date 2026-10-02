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

const count = (line: string, ch: string): number => line.split(ch).length - 1;

/**
 * Returns the insertion that documents `sym`, or null when `sym` has a doc. The Python docstring
 * goes inside the body, on the line after the `def`. A signature can span lines, so the insertion
 * point is the line after the one that ends the signature. The code finds it by the depth of the
 * round brackets, not by an assumption that the signature has one line.
 */
export function planPython(sym: DocSymbol, lines: string[]): Insertion | null {
  if (sym.hasDoc) return null;
  const start = sym.line - 1;
  if (start >= lines.length) return null;
  let depth = 0;
  let end = start;
  for (let i = start; i < Math.min(lines.length, start + 60); i++) {
    const line = lines[i] ?? "";
    depth += count(line, "(") - count(line, ")");
    if (depth <= 0 && line.trimEnd().endsWith(":")) {
      end = i;
      break;
    }
  }
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
