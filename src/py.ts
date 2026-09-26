/**
 * The Python string behaviour that the ported Python tools (STE, map) depend on.
 *
 * The ports must give the same bytes as the Python tools. Python and
 * JavaScript differ in these places:
 *
 * - Python's `\w` and `\b` match Unicode letters and digits. JavaScript's match ASCII only, even
 *   with the `u` flag. `W` and `B` give the Python meaning.
 * - Python's `\s`, `str.split()` and `str.strip()` also treat U+001C to U+001F and U+0085 as
 *   white space. JavaScript's `\s` and `trim()` do not. `S` and the functions below give the
 *   Python set.
 * - `str.splitlines()` splits at more line ends than `\n`.
 * - A Python slice counts code points; a JavaScript slice counts UTF-16 code units.
 * - `repr()` has its own quoting and escape rules.
 */

/** The Python white-space characters (`str.isspace()`), as a character-class body (for a negated class). */
export const SPACE_BODY =
  "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

/** Python `\s` (a character class). Use it in a regex with the `u` flag. */
export const S = `[${SPACE_BODY}]`;

/** Python `\w`: a Unicode letter, a Unicode number or `_`. Use it with the `u` flag. */
export const W = "[\\p{L}\\p{N}_]";

/** Python `\b`: a boundary between a `W` character and a character that is not one. */
export const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;

/** Python `\d`: a Unicode decimal digit. */
export const D = "\\p{Nd}";

/**
 * The letters that Python's case-insensitive match accepts for an ASCII letter, beyond its two
 * cases: `i` also matches U+0131 and U+0130, `s` matches U+017F, and `k` matches U+212A.
 */
const EXTRA_CASES: Readonly<Record<string, string>> = {
  i: String.fromCharCode(0x131, 0x130),
  s: String.fromCharCode(0x17f),
  k: String.fromCharCode(0x212a),
};

/**
 * A case-insensitive form of `pattern`, in the Python sense, as a regex source with no flag.
 *
 * Each ASCII letter becomes a class of its cases (`is` becomes `[iIıİ][sSſ]`); every other
 * character stays as it is. A scoped flag group such as `(?i:is)` would do the same, but Node 20
 * and Node 22 cannot compile one, and the npm package supports Node 20.
 */
export function ci(pattern: string): string {
  let out = "";
  for (const ch of pattern) {
    const lower = ch.toLowerCase();
    if (lower >= "a" && lower <= "z" && lower.length === 1) {
      out += `[${lower}${lower.toUpperCase()}${EXTRA_CASES[lower] ?? ""}]`;
    } else out += ch;
  }
  return out;
}

const SPACE_RUN = new RegExp(`${S}+`, "u");
const LEADING_SPACE = new RegExp(`^${S}+`, "u");
const TRAILING_SPACE = new RegExp(`${S}+$`, "u");

/** Python `str.strip()` with no argument. */
export function pyStrip(text: string): string {
  return text.replace(LEADING_SPACE, "").replace(TRAILING_SPACE, "");
}

/** Python `str.lstrip()` with no argument. */
export function pyLstrip(text: string): string {
  return text.replace(LEADING_SPACE, "");
}

/** Python `str.split()` with no argument: split at runs of white space, drop empty parts. */
export function pySplit(text: string): string[] {
  return text.split(SPACE_RUN).filter((part) => part !== "");
}

/** The line ends of Python `str.splitlines()`, as code points (CR LF counts as one end). */
const LINE_ENDS = new Set([0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x85, 0x2028, 0x2029]);
const CR = 0x0d;
const LF = 0x0a;

/** Python `str.splitlines()`: split at every line end that Python knows; no trailing empty. */
export function pySplitlines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (!LINE_ENDS.has(c)) continue;
    lines.push(text.slice(start, i));
    if (c === CR && text.charCodeAt(i + 1) === LF) i += 1;
    start = i + 1;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

/** True when `ch` (one code point) is alphanumeric in the sense of Python `str.isalnum()`. */
export function isAlnum(ch: string): boolean {
  return /^[\p{L}\p{N}]$/u.test(ch);
}

/** Python `text[:n]`: the first `n` code points. */
export function headCodePoints(text: string, n: number): string {
  return Array.from(text).slice(0, n).join("");
}

/** The number of code points in `text` (Python `len`). */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}

/** True for a code point that Python's `repr()` writes as an escape. */
const NOT_PRINTABLE = /^[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Zl}\p{Zp}\p{Zs}]$/u;

/** Python `repr()` of a string. */
export function pyRepr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === "\\") out += "\\\\";
    else if (ch === quote) out += `\\${quote}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch !== " " && NOT_PRINTABLE.test(ch)) {
      if (cp < 0x100) out += `\\x${cp.toString(16).padStart(2, "0")}`;
      else if (cp < 0x10000) out += `\\u${cp.toString(16).padStart(4, "0")}`;
      else out += `\\U${cp.toString(16).padStart(8, "0")}`;
    } else out += ch;
  }
  return out + quote;
}

/**
 * Escapes the characters that a regex treats as special, for a pattern with the `u` flag. (The
 * `u` flag refuses an escape of a character that is not special, so `-` and `/` stay as they are.)
 */
export function reEscape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Python `posixpath.dirname`. */
export function pyDirname(path: string): string {
  const head = path.slice(0, path.lastIndexOf("/") + 1);
  if (head !== "" && head !== "/".repeat(head.length)) return head.replace(/\/+$/, "");
  return head;
}

/** Python `posixpath.join`. */
export function pyJoin(first: string, ...rest: string[]): string {
  let path = first;
  for (const part of rest) {
    if (part.startsWith("/")) path = part;
    else if (path === "" || path.endsWith("/")) path += part;
    else path += `/${part}`;
  }
  return path;
}

/** Python `posixpath.normpath`: removes `.` and empty parts, and folds `..` where it can. */
export function pyNormpath(path: string): string {
  if (path === "") return ".";
  let initialSlashes = path.startsWith("/") ? 1 : 0;
  if (path.startsWith("//") && !path.startsWith("///")) initialSlashes = 2;
  const comps: string[] = [];
  for (const comp of path.split("/")) {
    if (comp === "" || comp === ".") continue;
    if (comp !== ".." || (initialSlashes === 0 && comps.length === 0) || comps.at(-1) === "..") {
      comps.push(comp);
    } else if (comps.length > 0) {
      comps.pop();
    }
  }
  const joined = "/".repeat(initialSlashes) + comps.join("/");
  return joined || ".";
}
