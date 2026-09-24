/**
 * Splitters for the `chunk` subcommand (design section 4): Markdown, JSON and TypeScript.
 *
 * Each splitter returns the sections of one file. `split` writes one chunk file per section.
 * The splitters are a port of the original chunker. The TypeScript splitter keeps the string,
 * template, comment and regex tracking of the original (fix K4).
 */
import { extname } from "node:path";
import type { FileType } from "./manifest.ts";

/** One section of a source file. Line numbers start at 1. */
export interface Section {
  title: string;
  level: number;
  content: string;
  startLine: number;
  endLine: number;
}

/** Converts CRLF and CR line endings to LF. */
export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Returns the line-break style of `content`: "crlf" when every line break is CRLF, "lf" when
 * there is no CR, and "mixed" for another text.
 */
export function detectLineEnding(content: string): "lf" | "crlf" | "mixed" {
  const crlf = content.split("\r\n").length - 1;
  if (crlf === 0) return content.includes("\r") ? "mixed" : "lf";
  const lf = content.split("\n").length - 1;
  const cr = content.split("\r").length - 1;
  return lf === crlf && cr === crlf ? "crlf" : "mixed";
}

/** The kinds of line break that `lineBreakRuns` records. */
const BREAKS = { lf: "\n", crlf: "\r\n", cr: "\r" } as const;
type LineBreak = keyof typeof BREAKS;

/** The pattern of a `lineBreaks` value: runs such as `crlf*3`, joined by commas. */
export const LINE_BREAK_RUNS = /^(?:(?:lf|crlf|cr)\*[1-9]\d*(?:,(?:lf|crlf|cr)\*[1-9]\d*)*)?$/;

/**
 * Returns each line break of `content`, in order, as runs of one kind: for example
 * "crlf*2,lf*1,crlf*5". `restoreLineBreaks` puts them back after the text is normalized to LF.
 */
export function lineBreakRuns(content: string): string {
  const runs: [LineBreak, number][] = [];
  for (const match of content.matchAll(/\r\n|\r|\n/g)) {
    const kind: LineBreak = match[0] === "\r\n" ? "crlf" : match[0] === "\r" ? "cr" : "lf";
    const last = runs[runs.length - 1];
    if (last?.[0] === kind) last[1]++;
    else runs.push([kind, 1]);
  }
  return runs.map(([kind, count]) => `${kind}*${count}`).join(",");
}

/**
 * Gives the line breaks recorded in `runs` back to `text`. Each line break of `text` (CRLF, CR or
 * LF) takes the recorded kind at its position when the counts agree, so an unchanged text comes
 * back byte for byte. When an edit changed the number of line breaks, the positions no longer
 * agree: each line break then takes the most common recorded kind, and `exact` is false.
 */
export function restoreLineBreaks(text: string, runs: string): { text: string; exact: boolean } {
  const kinds: LineBreak[] = [];
  const totals: Record<LineBreak, number> = { lf: 0, crlf: 0, cr: 0 };
  for (const run of runs === "" ? [] : runs.split(",")) {
    const [kind, count] = run.split("*") as [LineBreak, string];
    for (let i = 0; i < Number(count); i++) kinds.push(kind);
    totals[kind] += Number(count);
  }
  const lines = normalizeLineEndings(text).split("\n");
  const exact = kinds.length === lines.length - 1;
  const kindsByCount = Object.keys(totals) as LineBreak[];
  const common = kindsByCount.reduce((a, b) => (totals[b] > totals[a] ? b : a));
  let out = lines[0] ?? "";
  for (let i = 1; i < lines.length; i++) {
    out += BREAKS[exact ? (kinds[i - 1] ?? common) : common] + lines[i];
  }
  return { text: out, exact };
}

/** Returns the file type for the extension of `filePath`. Unknown extensions give Markdown. */
export function detectFileType(filePath: string): FileType {
  switch (extname(filePath).toLowerCase()) {
    case ".json":
      return "json";
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "typescript";
    default:
      return "markdown";
  }
}

/** Returns the chunk file extension for a file type. */
export function chunkExtension(fileType: FileType): string {
  switch (fileType) {
    case "markdown":
      return ".md";
    case "json":
      return ".json";
    case "typescript":
      return ".ts";
  }
}

/** Returns the chunk file name for a section: a 3-digit index and a slug of the title. */
export function chunkFilename(title: string, index: number, fileType: FileType): string {
  const safe = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 50);
  return `${String(index).padStart(3, "0")}-${safe || "section"}${chunkExtension(fileType)}`;
}

// ============================================================================
// MARKDOWN
// ============================================================================

/**
 * Splits Markdown at headings of level 1 to `splitLevel`. Text before the first heading becomes
 * the section `_preamble`. A file without headings becomes one section `_content`.
 */
export function splitMarkdown(content: string, splitLevel: number): Section[] {
  const lines = normalizeLineEndings(content).split("\n");
  const sections: Section[] = [];
  let current: { title: string; level: number; lines: string[]; startLine: number } | null = null;
  const headingRegex = new RegExp(`^(#{1,${splitLevel}})\\s+(.+)$`);
  let preambleLines: string[] = [];
  let preambleStart = 0;
  let foundFirstHeading = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = line.match(headingRegex);
    if (match) {
      foundFirstHeading = true;
      if (preambleLines.length > 0 && current === null) {
        sections.push({
          title: "_preamble",
          level: 0,
          content: preambleLines.join("\n"),
          startLine: preambleStart + 1,
          endLine: i,
        });
        preambleLines = [];
      }
      if (current) {
        sections.push({
          title: current.title,
          level: current.level,
          content: current.lines.join("\n"),
          startLine: current.startLine,
          endLine: i,
        });
      }
      current = {
        title: (match[2] ?? "").trim(),
        level: (match[1] ?? "").length,
        lines: [line],
        startLine: i + 1,
      };
    } else if (current) {
      current.lines.push(line);
    } else if (!foundFirstHeading) {
      if (preambleLines.length === 0) preambleStart = i;
      preambleLines.push(line);
    }
  }

  if (current) {
    sections.push({
      title: current.title,
      level: current.level,
      content: current.lines.join("\n"),
      startLine: current.startLine,
      endLine: lines.length,
    });
  } else if (preambleLines.length > 0) {
    sections.push({
      title: "_content",
      level: 0,
      content: preambleLines.join("\n"),
      startLine: 1,
      endLine: lines.length,
    });
  }
  return sections;
}

// ============================================================================
// JSON
// ============================================================================

/**
 * The text of a JSON object around its top-level members: the text before the first member,
 * the text between each pair of members, and the text after the last member. With the member
 * texts, the layout gives the file again byte for byte (fix K8).
 */
export interface JsonLayout {
  prefix: string;
  separators: string[];
  suffix: string;
}

/** The result of `splitJson`. `layout` is present when the file is a JSON object. */
export interface JsonSplit {
  sections: Section[];
  layout?: JsonLayout;
}

/** One top-level member of a JSON object: its key and the offsets of its text. */
interface JsonMember {
  key: string;
  start: number;
  end: number;
}

function skipWhitespace(text: string, i: number): number {
  let j = i;
  while (j < text.length && /\s/.test(text[j] ?? "")) j++;
  return j;
}

/** Returns the offset after the JSON string that starts at `i`. */
function endOfString(text: string, i: number): number {
  let j = i + 1;
  while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
  return j + 1;
}

/** Returns the offset after the JSON value that starts at or after `i`. */
function endOfValue(text: string, i: number): number {
  let j = skipWhitespace(text, i);
  const first = text[j];
  if (first === '"') return endOfString(text, j);
  if (first === "{" || first === "[") {
    let depth = 0;
    while (j < text.length) {
      const c = text[j];
      if (c === '"') {
        j = endOfString(text, j);
        continue;
      }
      if (c === "{" || c === "[") depth++;
      if (c === "}" || c === "]") depth--;
      j++;
      if (depth === 0) return j;
    }
    return j;
  }
  while (j < text.length && !/[\s,}\]]/.test(text[j] ?? "")) j++;
  return j;
}

/** Returns the top-level members of a valid JSON object text. */
function scanMembers(text: string): JsonMember[] {
  const members: JsonMember[] = [];
  let i = skipWhitespace(text, 0) + 1; // After "{".
  for (;;) {
    i = skipWhitespace(text, i);
    if (text[i] !== '"') return members; // "}" of an empty object.
    const start = i;
    const keyEnd = endOfString(text, i);
    const key = JSON.parse(text.slice(i, keyEnd)) as string;
    i = skipWhitespace(text, keyEnd) + 1; // After ":".
    i = endOfValue(text, i);
    members.push({ key, start, end: i });
    i = skipWhitespace(text, i);
    if (text[i] !== ",") return members;
    i++;
  }
}

/** Returns the 1-based line number of offset `i` in `text`. */
function lineAt(text: string, i: number): number {
  let line = 1;
  for (let j = 0; j < i; j++) if (text[j] === "\n") line++;
  return line;
}

/**
 * Splits a JSON object into one section per top-level key. An array becomes one section
 * `_array`. Invalid JSON becomes one section `_invalid_json`.
 *
 * A key section holds the member text of the source, as it is, in a JSON object:
 * `{`, a line break, the indent and the member, then a line break and `}`. The member keeps its
 * formatting, its number text and its key, also a duplicate key or `__proto__`. The layout holds
 * the text around the members, so `mergeJsonLayout` gives the file again byte for byte (fix K8).
 */
export function splitJson(content: string): JsonSplit {
  const normalized = normalizeLineEndings(content);
  const whole = (title: string): JsonSplit => ({
    sections: [
      {
        title,
        level: 0,
        content: normalized,
        startLine: 1,
        endLine: normalized.split("\n").length,
      },
    ],
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    return whole("_invalid_json");
  }
  if (Array.isArray(parsed)) return whole("_array");
  if (typeof parsed !== "object" || parsed === null) return { sections: [] };
  const members = scanMembers(normalized);
  const first = members[0];
  const last = members[members.length - 1];
  if (first === undefined || last === undefined) return { sections: [] };
  const sections = members.map((m) => {
    const lineStart = normalized.lastIndexOf("\n", m.start - 1) + 1;
    const lead = normalized.slice(lineStart, m.start);
    const indent = /^[ \t]*$/.test(lead) && lead !== "" ? lead : "  ";
    return {
      title: m.key,
      level: 1,
      content: `{\n${indent}${normalized.slice(m.start, m.end)}\n}`,
      startLine: lineAt(normalized, m.start),
      endLine: lineAt(normalized, m.end),
    };
  });
  const separators = members.slice(1).map((m, i) => normalized.slice(members[i]?.end, m.start));
  return {
    sections,
    layout: {
      prefix: normalized.slice(0, first.start),
      separators,
      suffix: normalized.slice(last.end),
    },
  };
}

/**
 * Merges JSON key chunks with the layout of the source file (fix K8). Each chunk must be a JSON
 * object; its members go into the place of the original member, as text. A chunk without
 * members is left out with its separator. Throws when a chunk or the result is not valid JSON.
 * The error names the chunk number and, from `names`, the chunk file name.
 */
export function mergeJsonLayout(
  chunks: string[],
  layout: JsonLayout,
  names: readonly string[] = [],
): string {
  let body = "";
  let count = 0;
  chunks.forEach((chunk, i) => {
    const label = `JSON chunk ${i + 1}${names[i] === undefined ? "" : ` (${names[i]})`}`;
    const trimmed = chunk.trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`${label} is not valid JSON: ${(error as Error).message}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${label} is not a JSON object`);
    }
    const members = trimmed.slice(1, -1).trim();
    if (members === "") return;
    body += count === 0 ? members : `${layout.separators[i - 1] ?? ",\n  "}${members}`;
    count++;
  });
  const tail = layout.suffix.slice(layout.suffix.lastIndexOf("}") + 1);
  const merged = count === 0 ? `{}${tail}` : `${layout.prefix}${body}${layout.suffix}`;
  JSON.parse(merged);
  return merged;
}

/**
 * Merges JSON chunks into one object. A chunk that is not a JSON object is skipped; `warn`
 * receives one message for each chunk that does not parse. Each key is defined as an own
 * property, so a `__proto__` key stays a key and does not set the prototype.
 */
export function mergeJson(chunks: string[], warn: (message: string) => void): string {
  const merged: Record<string, unknown> = Object.create(null);
  for (const chunk of chunks) {
    try {
      const parsed: unknown = JSON.parse(chunk);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          Object.defineProperty(merged, key, {
            value,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
      }
    } catch {
      warn("Warning: Skipping invalid JSON chunk\n");
    }
  }
  return JSON.stringify(merged, null, 2);
}

// ============================================================================
// TYPESCRIPT
// ============================================================================

/** Cross-line lexer state for strings, template expressions, comments and regexes. */
interface LexState {
  inString: boolean;
  stringChar: string;
  /** The nesting of `${...}` in template literals. */
  templateExpressionDepth: number;
  inBlockComment: boolean;
  /** The quote of a string inside a template expression. */
  nestedStringChar: string;
  inRegex: boolean;
}

function freshLexState(): LexState {
  return {
    inString: false,
    stringChar: "",
    templateExpressionDepth: 0,
    inBlockComment: false,
    nestedStringChar: "",
    inRegex: false,
  };
}

/** Returns the number of backslashes directly before index `i` of `line`. */
function backslashesBefore(line: string, i: number): number {
  let count = 0;
  for (let j = i - 1; j >= 0 && line[j] === "\\"; j--) count++;
  return count;
}

/**
 * Returns the net `{}` and `()` counts of `line`. Characters in strings, comments and regexes
 * do not count. `state` carries the lexer state from line to line.
 */
function countBrackets(line: string, state: LexState): { brackets: number; parens: number } {
  let brackets = 0;
  let parens = 0;

  for (let i = 0; i < line.length; i++) {
    const char = line[i] ?? "";
    const prevChar = i > 0 ? (line[i - 1] ?? "") : "";
    const nextChar = i < line.length - 1 ? (line[i + 1] ?? "") : "";

    if (state.inBlockComment) {
      if (char === "*" && nextChar === "/") {
        state.inBlockComment = false;
        i++;
      }
      continue;
    }
    if (!state.inString && char === "/" && nextChar === "*") {
      state.inBlockComment = true;
      i++;
      continue;
    }
    if (!state.inString && !state.inRegex && char === "/" && nextChar === "/") {
      break;
    }
    if (state.inRegex) {
      if (char === "/" && prevChar !== "\\" && backslashesBefore(line, i) % 2 === 0) {
        state.inRegex = false;
        while (i + 1 < line.length && /[gimsuy]/.test(line[i + 1] ?? "")) i++;
      }
      continue;
    }
    if (!state.inString && char === "/") {
      // A regex can follow one of ( [ = ! & | : ; { } , or the line start.
      let lastNonWs = "";
      for (let j = i - 1; j >= 0; j--) {
        const c = line[j] ?? "";
        if (!/\s/.test(c)) {
          lastNonWs = c;
          break;
        }
      }
      if (/[([=!&|:;{},]/.test(lastNonWs) || lastNonWs === "" || i === 0) {
        if (nextChar !== "=" && nextChar !== "*" && nextChar !== "/") {
          state.inRegex = true;
          continue;
        }
      }
    }

    if (state.inString) {
      const activeQuote = state.nestedStringChar || state.stringChar;
      if (
        state.stringChar === "`" &&
        state.nestedStringChar === "" &&
        char === "$" &&
        nextChar === "{"
      ) {
        state.templateExpressionDepth++;
        state.inString = false;
        i++;
        brackets++;
      } else if (char === activeQuote && backslashesBefore(line, i) % 2 === 0) {
        if (state.nestedStringChar !== "") {
          state.nestedStringChar = "";
          state.inString = false;
        } else {
          state.inString = false;
          if (state.templateExpressionDepth === 0) state.stringChar = "";
        }
      }
    } else if (state.templateExpressionDepth > 0 && state.stringChar === "`") {
      if (char === '"' || char === "'") {
        state.inString = true;
        state.nestedStringChar = char;
      } else if (char === "`") {
        state.templateExpressionDepth++;
        state.inString = true;
      } else if (char === "}") {
        state.templateExpressionDepth--;
        brackets--;
        if (state.templateExpressionDepth === 0) state.inString = true;
      } else if (char === "{") {
        brackets++;
      } else if (char === "(") {
        parens++;
      } else if (char === ")") {
        parens--;
      }
    } else if (char === '"' || char === "'" || char === "`") {
      state.inString = true;
      state.stringChar = char;
    } else if (char === "{") {
      brackets++;
    } else if (char === "}") {
      brackets--;
    } else if (char === "(") {
      parens++;
    } else if (char === ")") {
      parens--;
    }
  }
  return { brackets, parens };
}

const TS_PATTERNS = {
  import: /^import\s+/,
  exportFrom: /^export\s+(?:type\s+)?\{[^}]*\}\s+from/,
  exportAll: /^export\s+\*\s+from/,
  function: /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)/,
  anonymousFunction: /^(?:export\s+)?(?:async\s+)?function\b/,
  class: /^(?:export\s+)?(?:abstract\s+)?class\s+([\w$]+)/,
  anonymousClass: /^(?:export\s+)?(?:abstract\s+)?class\b/,
  interface: /^(?:export\s+)?interface\s+([\w$]+)/,
  type: /^(?:export\s+)?type\s+([\w$]+)/,
  const: /^(?:export\s+)?const\s+([\w$]+)/,
  let: /^(?:export\s+)?let\s+([\w$]+)/,
  var: /^(?:export\s+)?var\s+([\w$]+)/,
  enum: /^(?:export\s+)?(?:const\s+)?enum\s+([\w$]+)/,
  arrowFunction: /^(?:export\s+)?const\s+([\w$]+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/,
  arrowFunctionSimple: /^(?:export\s+)?const\s+([\w$]+)\s*=\s*(?:async\s+)?[\w$]+\s*=>/,
  decorator: /^@(\w+)(?:\([^)]*\))?$/,
  namespace: /^(?:export\s+)?(?:namespace|module)\s+["']?([\w$.-]+)/,
};

/** The title and level of a top-level declaration line. */
interface Declaration {
  title: string;
  level: number;
}

/** Returns `prefix:name` from the first capture of `re` in `line`, or null. */
function named(line: string, re: RegExp, prefix: string, level: number): Declaration | null {
  const m = line.match(re);
  return m ? { title: `${prefix}:${m[1] ?? ""}`, level } : null;
}

/**
 * Returns the title and level of a top-level declaration, or null for another line.
 * `export default` and `declare` are modifiers: `export default function main` gives
 * `function:main`, and `declare const X` gives `const:X`.
 */
function matchDeclaration(line: string): Declaration | null {
  const p = TS_PATTERNS;
  if (p.exportAll.test(line) || p.exportFrom.test(line)) return { title: "_exports", level: 0 };
  const isDefault = /^export\s+default\s+/.test(line);
  const t = line
    .replace(/^export\s+default\s+/, "export ")
    .replace(/^(export\s+)?declare\s+/, "$1");
  const found =
    named(t, p.arrowFunction, "function", 1) ??
    named(t, p.arrowFunctionSimple, "function", 1) ??
    named(t, p.function, "function", 1) ??
    named(t, p.namespace, "namespace", 1) ??
    named(t, p.class, "class", 1) ??
    named(t, p.interface, "interface", 2) ??
    named(t, p.type, "type", 2) ??
    named(t, p.enum, "enum", 2) ??
    named(t, p.const, "const", 2) ??
    named(t, p.let, "let", 2) ??
    named(t, p.var, "var", 2);
  if (found) return found;
  if (p.anonymousFunction.test(t))
    return { title: isDefault ? "function:default" : "_function", level: 1 };
  if (p.anonymousClass.test(t)) return { title: isDefault ? "class:default" : "_class", level: 1 };
  return isDefault ? { title: "_default", level: 1 } : null;
}

function countChar(line: string, ch: "{" | "}"): number {
  let n = 0;
  for (const c of line) if (c === ch) n++;
  return n;
}

/** A top-level unit of a TypeScript file: its title, its level and its first and last line. */
interface Span {
  title: string;
  level: number;
  /** The index of the first line (a decorator, or the declaration line). */
  start: number;
  /** The index of the last line that is not blank. */
  end: number;
}

/**
 * Returns the sections of `lines` for the top-level units `spans` (fix K8). The sections cover
 * every line once and in order, so the section texts joined with LF give the file again byte for
 * byte. The text between two units goes to the earlier unit up to and with its last blank line;
 * the rest (a comment directly above a declaration) goes to the later unit. The text before the
 * first unit goes to the first unit, and the text after the last unit to the last unit.
 */
function partition(lines: string[], spans: Span[]): Section[] {
  const bounds = spans.map((span, k) => {
    if (k === 0) return 0;
    const prevEnd = spans[k - 1]?.end ?? 0;
    for (let j = span.start - 1; j > prevEnd; j--) {
      if ((lines[j] ?? "").trim() === "") return j + 1;
    }
    return prevEnd + 1;
  });
  return spans.map((span, k) => {
    const from = bounds[k] ?? 0;
    const to = bounds[k + 1] ?? lines.length;
    return {
      title: span.title,
      level: span.level,
      content: lines.slice(from, to).join("\n"),
      startLine: from + 1,
      endLine: to,
    };
  });
}

/**
 * Splits TypeScript or JavaScript at top-level units: imports form one section `_imports`, a
 * declaration forms one section, and another top-level statement forms one section
 * `_statement`. Decorators join the next declaration. A file without units becomes one section
 * `_content`.
 *
 * Blank lines and comments between units stay in a section (see `partition`), so `merge` gives
 * the file again byte for byte (fix K8). The original dropped them, and it dropped every
 * top-level statement that is not a declaration.
 */
export function splitTypeScript(content: string): Section[] {
  const normalized = normalizeLineEndings(content);
  const lines = normalized.split("\n");
  const spans: Span[] = [];

  let current: { title: string; level: number; start: number } | null = null;
  let bracketDepth = 0;
  let parenDepth = 0;
  let lex = freshLexState();
  let importStart = -1;
  let importEnd = -1;
  let importDepth = 0;
  let decoratorStart = -1;
  let inComment = false;

  const isBlank = (i: number): boolean => (lines[i] ?? "").trim() === "";
  const close = (end: number): void => {
    if (current) {
      let last = end;
      while (last > current.start && isBlank(last)) last--;
      spans.push({ ...current, end: last });
    }
    current = null;
  };
  const flushImports = (): void => {
    if (importStart !== -1) {
      spans.push({ title: "_imports", level: 0, start: importStart, end: importEnd });
    }
    importStart = -1;
    importEnd = -1;
    importDepth = 0;
  };
  /** True when a line at column 0 starts a new unit after a statement without a semicolon. */
  const startsUnit = (line: string, trimmed: string): boolean =>
    /^\S/.test(line) &&
    !lex.inString &&
    !lex.inBlockComment &&
    !lex.inRegex &&
    lex.templateExpressionDepth === 0 &&
    (TS_PATTERNS.import.test(trimmed) ||
      TS_PATTERNS.decorator.test(trimmed) ||
      matchDeclaration(trimmed) !== null);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (current) {
      if (!(bracketDepth <= 0 && parenDepth <= 0 && startsUnit(line, trimmed))) {
        const { brackets, parens } = countBrackets(line, lex);
        bracketDepth += brackets;
        parenDepth += parens;
        if (bracketDepth <= 0 && parenDepth <= 0 && /[;},]$/.test(trimmed)) close(i);
        continue;
      }
      close(i - 1); // A statement without a semicolon ends before the next unit.
    }

    if (importDepth > 0) {
      importEnd = i;
      importDepth += countChar(line, "{") - countChar(line, "}");
      continue;
    }
    if (inComment) {
      if (trimmed.includes("*/")) inComment = false;
      continue;
    }
    if (trimmed === "" || trimmed.startsWith("//")) continue;
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) {
        inComment = true;
        continue;
      }
      if (trimmed.endsWith("*/")) continue;
    }

    if (TS_PATTERNS.import.test(trimmed)) {
      decoratorStart = -1;
      if (importStart === -1) importStart = i;
      importEnd = i;
      importDepth += countChar(line, "{") - countChar(line, "}");
      continue;
    }
    flushImports();
    if (TS_PATTERNS.decorator.test(trimmed)) {
      if (decoratorStart === -1) decoratorStart = i;
      continue;
    }

    const decl = matchDeclaration(trimmed) ?? { title: "_statement", level: 1 };
    current = {
      title: decl.title,
      level: decl.level,
      start: decoratorStart !== -1 ? decoratorStart : i,
    };
    decoratorStart = -1;
    lex = freshLexState();
    const { brackets, parens } = countBrackets(line, lex);
    bracketDepth = brackets;
    parenDepth = parens;
    if (bracketDepth <= 0 && parenDepth <= 0 && /[;}]$/.test(trimmed)) close(i);
  }
  flushImports();
  close(lines.length - 1);

  if (spans.length === 0) {
    return [
      { title: "_content", level: 0, content: normalized, startLine: 1, endLine: lines.length },
    ];
  }
  return partition(lines, spans);
}
