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
 * Splits a JSON object into one section per top-level key. An array becomes one section
 * `_array`. Invalid JSON becomes one section `_invalid_json`.
 */
export function splitJson(content: string): Section[] {
  const normalized = normalizeLineEndings(content);
  const whole = (title: string): Section[] => [
    { title, level: 0, content: normalized, startLine: 1, endLine: normalized.split("\n").length },
  ];
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    return whole("_invalid_json");
  }
  if (Array.isArray(parsed)) return whole("_array");
  if (typeof parsed !== "object" || parsed === null) return [];
  const record = parsed as Record<string, unknown>;
  return Object.keys(record).map((key, i) => {
    const chunkContent = JSON.stringify({ [key]: record[key] }, null, 2);
    return {
      title: key,
      level: 1,
      content: chunkContent,
      startLine: i + 1, // Approximate, as in the original.
      endLine: i + chunkContent.split("\n").length,
    };
  });
}

/**
 * Merges JSON chunks into one object. A chunk that is not a JSON object is skipped; `warn`
 * receives one message for each chunk that does not parse.
 */
export function mergeJson(chunks: string[], warn: (message: string) => void): string {
  const merged: Record<string, unknown> = {};
  for (const chunk of chunks) {
    try {
      const parsed: unknown = JSON.parse(chunk);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        Object.assign(merged, parsed);
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
  exportFrom: /^export\s+\{[^}]*\}\s+from/,
  exportAll: /^export\s+\*\s+from/,
  function: /^(?:async\s+)?function\s+(\w+)/,
  class: /^class\s+(\w+)/,
  interface: /^interface\s+(\w+)/,
  type: /^type\s+(\w+)/,
  const: /^(?:export\s+)?const\s+(\w+)/,
  let: /^(?:export\s+)?let\s+(\w+)/,
  var: /^(?:export\s+)?var\s+(\w+)/,
  enum: /^(?:export\s+)?enum\s+(\w+)/,
  arrowFunction: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/,
  arrowFunctionSimple: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\w+\s*=>/,
  decorator: /^@(\w+)(?:\([^)]*\))?$/,
  namespace: /^(?:export\s+)?namespace\s+(\w+)/,
  classMethod:
    /^\s+(?:public|private|protected|static|async|readonly)*\s*(?:get|set)?\s*(\w+)\s*[<(]/,
};

/** Returns `prefix:name` from the first capture of `re` in `line`, or `fallback`. */
function titleFrom(line: string, re: RegExp, prefix: string, fallback: string): string {
  const m = line.match(re);
  return m ? `${prefix}:${m[1] ?? ""}` : fallback;
}

/** The title and level of a top-level declaration line, or null. */
interface Declaration {
  title: string;
  level: number;
  className?: string;
}

function matchDeclaration(t: string): Declaration | null {
  const p = TS_PATTERNS;
  if (p.exportAll.test(t) || p.exportFrom.test(t)) return { title: "_exports", level: 0 };
  if (p.arrowFunction.test(t) || p.arrowFunctionSimple.test(t)) {
    return { title: titleFrom(t, /const\s+(\w+)/, "function", "_function"), level: 1 };
  }
  if (p.function.test(t) || /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/.test(t)) {
    return { title: titleFrom(t, /function\s+(\w+)/, "function", "_function"), level: 1 };
  }
  if (p.namespace.test(t)) {
    return { title: titleFrom(t, /namespace\s+(\w+)/, "namespace", "_namespace"), level: 1 };
  }
  if (p.class.test(t) || /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/.test(t)) {
    const m = t.match(/class\s+(\w+)/);
    return {
      title: m ? `class:${m[1] ?? ""}` : "_class",
      level: 1,
      className: m ? (m[1] ?? "") : "",
    };
  }
  if (p.interface.test(t) || /^(?:export\s+)?interface\s+(\w+)/.test(t)) {
    return { title: titleFrom(t, /interface\s+(\w+)/, "interface", "_interface"), level: 2 };
  }
  if (p.type.test(t) || /^(?:export\s+)?type\s+(\w+)/.test(t)) {
    return { title: titleFrom(t, /type\s+(\w+)/, "type", "_type"), level: 2 };
  }
  if (p.enum.test(t) || /^(?:export\s+)?enum\s+(\w+)/.test(t)) {
    return { title: titleFrom(t, /enum\s+(\w+)/, "enum", "_enum"), level: 2 };
  }
  if (p.const.test(t)) return { title: titleFrom(t, /const\s+(\w+)/, "const", "_const"), level: 2 };
  if (p.let.test(t)) return { title: titleFrom(t, /let\s+(\w+)/, "let", "_let"), level: 2 };
  if (p.var.test(t)) return { title: titleFrom(t, /var\s+(\w+)/, "var", "_var"), level: 2 };
  return null;
}

function countChar(line: string, ch: "{" | "}"): number {
  let n = 0;
  for (const c of line) if (c === ch) n++;
  return n;
}

/**
 * Splits TypeScript or JavaScript at top-level declarations. Imports form one section
 * `_imports`. JSDoc comments and decorators join the next declaration. A file without
 * declarations becomes one section `_content`.
 */
export function splitTypeScript(content: string): Section[] {
  const normalized = normalizeLineEndings(content);
  const lines = normalized.split("\n");
  const sections: Section[] = [];

  let current: { title: string; level: number; lines: string[]; startLine: number } | null = null;
  let importLines: string[] = [];
  let importStart = -1;
  let importBracketDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let inClass = false;
  let currentClassName = "";
  let classDepth = 0;
  let pendingComments: string[] = [];
  let commentStartLine = -1;
  let inMultilineComment = false;
  let decorators: string[] = [];
  let decoratorStartLine = -1;
  let lex = freshLexState();

  const saveCurrentSection = (endLine: number): void => {
    if (current && current.lines.length > 0) {
      const allLines = [...decorators, ...pendingComments, ...current.lines];
      const adjustedStartLine = current.startLine - decorators.length - pendingComments.length;
      sections.push({
        title: current.title,
        level: current.level,
        content: allLines.join("\n"),
        startLine: adjustedStartLine > 0 ? adjustedStartLine : current.startLine,
        endLine,
      });
    }
    current = null;
    bracketDepth = 0;
    parenDepth = 0;
    lex = freshLexState();
    pendingComments = [];
    commentStartLine = -1;
    decorators = [];
    decoratorStartLine = -1;
  };

  const saveImports = (endLine: number): void => {
    if (importLines.length > 0) {
      sections.push({
        title: "_imports",
        level: 0,
        content: importLines.join("\n"),
        startLine: importStart + 1,
        endLine,
      });
      importLines = [];
      importStart = -1;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    // JSDoc comments (/** ... */) wait for the next declaration.
    if (trimmed.startsWith("/**")) {
      inMultilineComment = true;
      if (commentStartLine === -1) commentStartLine = i;
      pendingComments.push(line);
      if (trimmed.includes("*/")) inMultilineComment = false;
      continue;
    }
    if (inMultilineComment) {
      pendingComments.push(line);
      if (trimmed.includes("*/")) inMultilineComment = false;
      continue;
    }

    if (TS_PATTERNS.decorator.test(trimmed)) {
      if (decoratorStartLine === -1) decoratorStartLine = i;
      decorators.push(line);
      continue;
    }

    // Outside a declaration, blank lines and line comments are skipped.
    if (!current && (trimmed === "" || trimmed.startsWith("//"))) {
      if (importLines.length > 0) importLines.push(line);
      if (trimmed === "") continue;
    }

    // A plain block comment that opens on this line and closes later.
    if (trimmed.startsWith("/*") && !trimmed.startsWith("/**") && !trimmed.includes("*/")) {
      if (current) current.lines.push(line);
      continue;
    }

    if (current) {
      current.lines.push(line);
      const { brackets, parens } = countBrackets(line, lex);
      bracketDepth += brackets;
      parenDepth += parens;

      if (inClass) {
        classDepth += brackets;
        if (classDepth === 1 && TS_PATTERNS.classMethod.test(trimmed)) {
          const methodMatch = trimmed.match(/(?:get|set)?\s*(\w+)\s*[<(]/);
          if (methodMatch) {
            saveCurrentSection(i);
            current = {
              title: `class:${currentClassName}.${methodMatch[1] ?? ""}`,
              level: 2,
              lines: [line],
              startLine: i + 1,
            };
            const methodBrackets = countBrackets(line, lex);
            bracketDepth = methodBrackets.brackets;
            parenDepth = methodBrackets.parens;
            continue;
          }
        }
      }

      if (bracketDepth <= 0 && parenDepth <= 0) {
        if (trimmed.endsWith(";") || trimmed.endsWith("}") || trimmed.endsWith(",")) {
          saveCurrentSection(i + 1);
          if (inClass && classDepth <= 0) {
            inClass = false;
            currentClassName = "";
          }
        }
      }
      continue;
    }

    // Imports form one group. A multi-line import continues until its braces balance.
    if (TS_PATTERNS.import.test(trimmed)) {
      if (importStart === -1) importStart = i;
      importLines.push(line);
      importBracketDepth += countChar(line, "{") - countChar(line, "}");
      continue;
    }
    if (importLines.length > 0 && importBracketDepth > 0) {
      importLines.push(line);
      importBracketDepth += countChar(line, "{") - countChar(line, "}");
      continue;
    }
    if (importLines.length > 0) {
      saveImports(i);
      importBracketDepth = 0;
    }

    const decl = matchDeclaration(trimmed);
    if (decl) {
      if (decl.className !== undefined) {
        currentClassName = decl.className;
        inClass = true;
        classDepth = 0;
      }
      // The original resets the depth for a multi-line generic; the count below replaces it.
      current = {
        title: decl.title,
        level: decl.level,
        lines: [line],
        startLine:
          decoratorStartLine !== -1
            ? decoratorStartLine + 1
            : commentStartLine !== -1
              ? commentStartLine + 1
              : i + 1,
      };
      const { brackets, parens } = countBrackets(line, lex);
      bracketDepth = brackets;
      parenDepth = parens;
      if (
        bracketDepth <= 0 &&
        parenDepth <= 0 &&
        (trimmed.endsWith(";") || trimmed.endsWith("}"))
      ) {
        saveCurrentSection(i + 1);
      }
    } else if (trimmed !== "" && !trimmed.startsWith("//")) {
      // A line that is not a declaration drops the pending comments and decorators.
      pendingComments = [];
      commentStartLine = -1;
      decorators = [];
      decoratorStartLine = -1;
    }
  }

  saveImports(lines.length);
  saveCurrentSection(lines.length);

  if (sections.length === 0) {
    sections.push({
      title: "_content",
      level: 0,
      content: normalized,
      startLine: 1,
      endLine: lines.length,
    });
  }
  return sections;
}
