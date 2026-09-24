/**
 * The one comment and string masking module of repo-tools.
 *
 * Two families:
 *
 * - The scanner functions (`blankCommentsAndStrings`, `stripComments`) read the source as
 *   tokens. They know line comments, block comments, quoted strings and template literals with
 *   nested `${...}` code. They do not detect regular-expression literals: a `/` in code is code.
 * - The regex functions (`removeBlockCommentsRegex`, `removeLineCommentsRegex`,
 *   `stripCommentsRegex`) are the comment removal of the pre-port generator, kept byte for byte.
 *   They do not know strings, so they also remove `//` and `/* ... *\/` text inside a string.
 *   The port uses them until the fixes replace them with the scanner functions.
 */

/** The kind of one source segment. */
type SegmentKind = "code" | "comment" | "string";

interface Segment {
  kind: SegmentKind;
  start: number;
  end: number;
}

/**
 * Splits `src` into code, comment and string segments. A string segment holds the text between
 * the delimiters only. The delimiters and the `${` and `}` of a template are code.
 */
function scan(src: string): Segment[] {
  const out: Segment[] = [];
  const push = (kind: SegmentKind, start: number, end: number): void => {
    if (end <= start) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind && last.end === start) last.end = end;
    else out.push({ kind, start, end });
  };
  // Each entry is the brace depth of one open `${` interpolation.
  const templates: number[] = [];
  let i = 0;
  const n = src.length;

  const readTemplateBody = (): void => {
    // `i` is just after the opening backtick or the closing `}` of an interpolation.
    const start = i;
    while (i < n) {
      const c = src[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        push("string", start, i);
        push("code", i, i + 1);
        i += 1;
        return;
      }
      if (c === "$" && src[i + 1] === "{") {
        push("string", start, i);
        push("code", i, i + 2);
        i += 2;
        templates.push(0);
        return;
      }
      i += 1;
    }
    push("string", start, n);
  };

  let codeStart = 0;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      push("code", codeStart, i);
      const eol = src.indexOf("\n", i);
      const end = eol === -1 ? n : eol;
      push("comment", i, end);
      i = end;
      codeStart = i;
      continue;
    }
    if (c === "/" && next === "*") {
      push("code", codeStart, i);
      const close = src.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      push("comment", i, end);
      i = end;
      codeStart = i;
      continue;
    }
    if (c === "'" || c === '"') {
      push("code", codeStart, i + 1);
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      const end = Math.min(j, n);
      push("string", i + 1, end);
      i = end < n && src[end] === c ? end + 1 : end;
      push("code", end, i);
      codeStart = i;
      continue;
    }
    if (c === "`") {
      push("code", codeStart, i + 1);
      i += 1;
      readTemplateBody();
      codeStart = i;
      continue;
    }
    if (templates.length > 0) {
      const depth = templates.length - 1;
      if (c === "{") templates[depth] = (templates[depth] ?? 0) + 1;
      else if (c === "}") {
        if (templates[depth] === 0) {
          templates.pop();
          push("code", codeStart, i + 1);
          i += 1;
          readTemplateBody();
          codeStart = i;
          continue;
        }
        templates[depth] = (templates[depth] ?? 1) - 1;
      }
    }
    i += 1;
  }
  push("code", codeStart, n);
  return out;
}

/** Replaces every character except CR and LF with a space. */
function blank(text: string): string {
  return text.replace(/[^\r\n]/g, " ");
}

/**
 * Replaces the text of every comment and every string literal with spaces. String delimiters,
 * line breaks, offsets and line numbers do not change.
 */
export function blankCommentsAndStrings(src: string): string {
  return scan(src)
    .map((s) => {
      const text = src.slice(s.start, s.end);
      return s.kind === "code" ? text : blank(text);
    })
    .join("");
}

/** Removes every comment. String literals do not change. A line comment keeps its line break. */
export function stripComments(src: string): string {
  return scan(src)
    .filter((s) => s.kind !== "comment")
    .map((s) => src.slice(s.start, s.end))
    .join("");
}

/** Removes each `/* ... *\/` block with a regular expression (pre-port behavior). */
export function removeBlockCommentsRegex(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Removes each `//` to the end of its line with a regular expression (pre-port behavior). */
export function removeLineCommentsRegex(text: string): string {
  return text.replace(/\/\/.*$/gm, "");
}

/** Removes block comments, then line comments, with regular expressions (pre-port behavior). */
export function stripCommentsRegex(text: string): string {
  return removeLineCommentsRegex(removeBlockCommentsRegex(text));
}
