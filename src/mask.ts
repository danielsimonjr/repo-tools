/**
 * The one comment and string masking module of repo-tools.
 *
 * The functions read the source as tokens. They know line comments, block comments, quoted
 * strings, template literals with nested `${...}` code, and regular-expression literals.
 *
 * Fix F27: the regex comment removal of the pre-port generator is gone. It did not know
 * strings, so it also removed `//` and `/* ... *\/` text inside a string.
 * Fix F39: a `/` starts a regular-expression literal where an operand can start (see
 * `regexCanStart`). A quote, a backtick or a `/` in the literal then does not open a string or
 * a comment. The literal body is a string segment; its delimiters and flags are code.
 */

/** The keywords after which a `/` starts a regular-expression literal, not a division. */
const REGEX_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

/**
 * True when a `/` at an offset after `src[prev]` starts a regular-expression literal. `prev` is
 * the offset of the last code character that is not white space, or -1 at the start. A regex
 * can start after an operator or a punctuator (`( [ { } , ; : ? = ! & | + - * % ^ ~`), after `=>`,
 * after a keyword of `REGEX_KEYWORDS`, and at the start. After `)`, `]`, a name, a number or a
 * literal, the `/` is a division. A `<` or a `>` that is not `=>` gives a division, because in a
 * `.tsx` file `</tag>` is not a regex.
 */
function regexCanStart(src: string, prev: number): boolean {
  if (prev < 0) return true;
  const c = src[prev] ?? "";
  if (c === ">") return src[prev - 1] === "=";
  if (/[([{},;:?=!&|+\-*%^~]/.test(c)) return true;
  if (!/[\w$]/.test(c)) return false;
  const word = /[\w$]+$/.exec(src.slice(Math.max(0, prev - 15), prev + 1))?.[0] ?? "";
  return REGEX_KEYWORDS.has(word) && !/[\w$.]/.test(src[prev - word.length] ?? "");
}

/**
 * The end offset of the regular-expression body that starts after the `/` at `start`: the
 * offset of the closing `/`. Returns -1 when the line ends first, so the `/` is not a regex.
 */
function regexBodyEnd(src: string, start: number): number {
  let inClass = false;
  for (let j = start + 1; j < src.length; j++) {
    const c = src[j];
    if (c === "\n" || c === "\r") return -1;
    if (c === "\\") j += 1;
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) return j;
  }
  return -1;
}

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
  // The offset of the last code character that is not white space (fix F39). After a string or
  // a template it is the closing delimiter; after `${` it is the `{`. A comment does not move it.
  let prev = -1;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next !== "/" && next !== "*" && regexCanStart(src, prev)) {
      const close = regexBodyEnd(src, i);
      if (close !== -1) {
        push("code", codeStart, i + 1);
        push("string", i + 1, close);
        i = close + 1;
        while (i < n && /[a-z]/i.test(src[i] ?? "")) i += 1;
        push("code", close, i);
        prev = i - 1;
        codeStart = i;
        continue;
      }
    }
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
      prev = i - 1;
      codeStart = i;
      continue;
    }
    if (c === "`") {
      push("code", codeStart, i + 1);
      i += 1;
      readTemplateBody();
      prev = i - 1;
      codeStart = i;
      continue;
    }
    if (!/\s/.test(c ?? "")) prev = i;
    if (templates.length > 0) {
      const depth = templates.length - 1;
      if (c === "{") templates[depth] = (templates[depth] ?? 0) + 1;
      else if (c === "}") {
        if (templates[depth] === 0) {
          templates.pop();
          push("code", codeStart, i + 1);
          i += 1;
          readTemplateBody();
          prev = i - 1;
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
