/**
 * Legend build and parse for `repo-tools compress` (design section 4).
 *
 * A legend maps a short abbreviation to the full text that it replaces. The compressors build
 * legends with the helpers here, and `decompress` reads the legend back from a compact JSON file
 * and restores the full keys. The legend syntax of each format is part of the CTON format and
 * does not change.
 */
import type { FileFormat } from "./formats.ts";

/** A repeated substring and its estimated net saving in characters. */
export interface SubstringCandidate {
  substring: string;
  count: number;
  savings: number;
}

/**
 * Returns an abbreviation for `key` that is not in `existing`.
 *
 * The strategies, in order: the first letter of each camelCase, snake_case or kebab-case word;
 * the first 2 characters; the first and the last character; the first 3 characters; the first
 * 2 characters and a number.
 */
export function generateAbbreviation(key: string, existing: Set<string>): string {
  const words = key.split(/(?=[A-Z])|[_\-\s]+/);
  let abbrev = words.map((w) => w[0]?.toLowerCase() || "").join("");
  if (abbrev.length >= 1 && !existing.has(abbrev)) return abbrev;

  abbrev = key.slice(0, 2).toLowerCase();
  if (!existing.has(abbrev)) return abbrev;

  abbrev = (key.charAt(0) + key.charAt(key.length - 1)).toLowerCase();
  if (!existing.has(abbrev)) return abbrev;

  abbrev = key.slice(0, 3).toLowerCase();
  if (!existing.has(abbrev)) return abbrev;

  let counter = 1;
  const base = key.slice(0, 2).toLowerCase();
  while (existing.has(`${base}${counter}`)) counter++;
  return `${base}${counter}`;
}

/** Counts the occurrences of `value` in a regular-expression match. */
function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) || []).length;
}

/**
 * Finds repeated substrings at natural token boundaries.
 *
 * Returns at most `maxSubstrings` candidates, highest net saving first. A candidate that is too
 * similar to a candidate with a higher saving is skipped.
 */
export function findRepeatedSubstrings(
  text: string,
  minLength: number,
  minOccurrences: number,
  maxSubstrings = 50,
): SubstringCandidate[] {
  const counts = new Map<string, number>();
  const tokens = text.split(/(\s+|[{}()[\]<>:;,."'`|=])/);

  for (let n = 1; n <= 6; n++) {
    for (let i = 0; i <= tokens.length - n; i++) {
      const ngram = tokens.slice(i, i + n).join("");
      if (ngram.length < minLength || ngram.length > 50) continue;
      if (/^\s*$/.test(ngram)) continue;
      if (countMatches(ngram, /\s/g) > ngram.length * 0.5) continue;
      const opens = countMatches(ngram, /[{([<]/g);
      const closes = countMatches(ngram, /[})\]>]/g);
      if (opens !== closes) continue;
      counts.set(ngram, (counts.get(ngram) || 0) + 1);
    }
  }

  for (const match of text.matchAll(/[a-zA-Z0-9_\-./]+\/[a-zA-Z0-9_\-./]+/g)) {
    const found = match[0];
    if (found.length >= minLength) counts.set(found, (counts.get(found) || 0) + 1);
  }

  const candidates: SubstringCandidate[] = [];
  for (const [substring, count] of counts.entries()) {
    if (count < minOccurrences) continue;
    // The abbreviation is §X (2 characters). The legend entry costs "§X=substring | ".
    const abbrevLength = 2;
    const legendCost = abbrevLength + substring.length + 4;
    const netSavings = (substring.length - abbrevLength) * count - legendCost;
    if (netSavings > 5) candidates.push({ substring, count, savings: netSavings });
  }

  candidates.sort((a, b) => b.savings - a.savings);

  const selected: SubstringCandidate[] = [];
  const used: string[] = [];
  for (const candidate of candidates) {
    const trimmed = candidate.substring.trim();
    if (trimmed.length < 3) continue;
    if (!used.some((u) => isTooSimilar(candidate.substring, trimmed, u))) {
      selected.push(candidate);
      used.push(candidate.substring);
      if (selected.length >= maxSubstrings) break;
    }
  }
  return selected;
}

/** True when a candidate overlaps an already selected substring too much. */
function isTooSimilar(candidate: string, candidateTrimmed: string, used: string): boolean {
  const usedTrimmed = used.trim();
  if (used.includes(candidate) || candidate.includes(used)) return true;
  if (
    candidateTrimmed === usedTrimmed ||
    candidateTrimmed.includes(usedTrimmed) ||
    usedTrimmed.includes(candidateTrimmed)
  ) {
    return true;
  }
  const shorter = candidateTrimmed.length < usedTrimmed.length ? candidateTrimmed : usedTrimmed;
  const longer = candidateTrimmed.length >= usedTrimmed.length ? candidateTrimmed : usedTrimmed;
  return longer.includes(shorter.slice(0, Math.floor(shorter.length * 0.7)));
}

/**
 * Replaces each substring with a `§` abbreviation (`§0`, `§1`, ... `§a`, ...).
 * The longest substrings are replaced first.
 */
export function applySubstringCompression(
  text: string,
  substrings: readonly SubstringCandidate[],
): { compressed: string; legend: Record<string, string> } {
  const legend: Record<string, string> = {};
  let compressed = text;
  const sorted = [...substrings].sort((a, b) => b.substring.length - a.substring.length);
  sorted.forEach((item, index) => {
    const abbrev = `§${index.toString(36)}`;
    legend[abbrev] = item.substring;
    compressed = compressed.split(item.substring).join(abbrev);
  });
  return { compressed, legend };
}

const NUMBER_TOKEN = /-?\d+(\.\d+)?([eE][+-]?\d+)?/y;
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** The source-text functions of ES2025 JSON: `JSON.rawJSON` and `JSON.isRawJSON`. */
interface SourceTextJson {
  rawJSON(text: string): object;
  isRawJSON(value: unknown): boolean;
}
const RAW = JSON as unknown as Partial<SourceTextJson>;

/** The third argument of a `JSON.parse` reviver in ES2025: the source text of a primitive. */
type ReviverContext = { source?: string } | undefined;

/**
 * True when this runtime gives a `JSON.parse` reviver the source text of each number and has
 * `JSON.rawJSON`. Probed once. Bun 1.4.2 has both.
 */
const HAS_SOURCE_TEXT = ((): boolean => {
  try {
    const source = JSON.parse("1.0", (_key, value, context?: ReviverContext) =>
      context?.source === undefined ? value : context.source,
    );
    return source === "1.0" && typeof RAW.rawJSON === "function";
  } catch {
    return false;
  }
})();

/**
 * Returns true when `value` is a number that `parseLossless` keeps as its source text. Code that
 * walks a parsed value must treat it as a number, not as an object.
 */
export function isRawNumber(value: unknown): boolean {
  return RAW.isRawJSON?.(value) === true;
}

/**
 * Parses JSON and keeps each number as its source text (lossless passthrough). `JSON.stringify`
 * writes such a number with the same text: `12345678901234567890`, `1e400` and
 * `0.12345678901234567890123` do not change. A plain `JSON.parse` changes all three.
 *
 * On a runtime without source-text access, the numbers are plain numbers, and the function
 * throws when a number would change (see `assertNumbersKept`).
 *
 * @throws Error when the text is not valid JSON, or when a number cannot be kept.
 */
export function parseLossless(text: string): unknown {
  const rawJSON = RAW.rawJSON;
  if (!HAS_SOURCE_TEXT || rawJSON === undefined) {
    assertNumbersKept(text);
    return JSON.parse(text);
  }
  return JSON.parse(text, (_key, value, context?: ReviverContext) =>
    typeof value === "number" && context?.source !== undefined ? rawJSON(context.source) : value,
  );
}

/**
 * Returns the decimal value of the number text `token` in one form: the sign, the significant
 * digits and the exponent ("-15e-1" for "-1.50"). Zero gives "0". Two texts with one value give
 * one result. A text that is not a JSON number gives "NaN".
 */
function decimalValue(token: string): string {
  const match = DECIMAL.exec(token);
  if (!match) return "NaN";
  const [, sign = "", int = "", frac = "", exp = "0"] = match;
  const all = `${int}${frac}`.replace(/^0+/, "");
  const digits = all.replace(/0+$/, "");
  if (digits === "") return "0";
  const exponent = Number(exp) - frac.length + (all.length - digits.length);
  return `${sign}${digits}e${exponent}`;
}

/** Returns a JSON path such as `$.items[3].v` for the keys and indexes of `path`. */
function formatPath(path: readonly (string | number)[]): string {
  return `$${path
    .map((part) =>
      typeof part === "number"
        ? `[${part}]`
        : /^[A-Za-z_$][\w$]*$/.test(part)
          ? `.${part}`
          : `[${JSON.stringify(part)}]`,
    )
    .join("")}`;
}

/**
 * The fallback of `parseLossless` for a runtime without source-text access. Throws when the JSON
 * text holds a number whose value a plain `JSON.parse` changes (for example
 * 12345678901234567890, 1e400 or 0.12345678901234567890123). The error names the number and its
 * JSON path. The check reads the source text; numbers in the text of a string are not checked.
 *
 * @throws Error that names the first number that cannot be kept, and its JSON path.
 */
export function assertNumbersKept(text: string): void {
  const path: (string | number)[] = [];
  const open: string[] = [];
  let expectKey = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    if (ch === '"') {
      // Skip the string, and each escaped character in it.
      const start = i;
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      i++;
      if (expectKey) path[path.length - 1] = JSON.parse(text.slice(start, i)) as string;
      expectKey = false;
    } else if (ch === "{" || ch === "[") {
      open.push(ch);
      path.push(ch === "{" ? "" : 0);
      expectKey = ch === "{";
      i++;
    } else if (ch === "}" || ch === "]") {
      open.pop();
      path.pop();
      i++;
    } else if (ch === ",") {
      const last = path[path.length - 1];
      if (open[open.length - 1] === "[" && typeof last === "number")
        path[path.length - 1] = last + 1;
      else expectKey = true;
      i++;
    } else if (ch === "-" || (ch >= "0" && ch <= "9")) {
      NUMBER_TOKEN.lastIndex = i;
      const token = NUMBER_TOKEN.exec(text)?.[0] ?? ch;
      if (decimalValue(String(Number(token))) !== decimalValue(token)) {
        throw new Error(
          `the JSON number ${token} at ${formatPath(path)} would change, and this runtime cannot keep its text. The file is not processed.`,
        );
      }
      i += token.length;
    } else {
      i++;
    }
  }
}

/**
 * Returns a copy of `value` with each object key renamed through `keyMap`.
 *
 * Each key is defined as an own property. A plain assignment of the key `__proto__` sets the
 * prototype of the copy, so the key and its value were lost (and the prototype changed).
 */
export function renameKeys(value: unknown, keyMap: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => renameKeys(item, keyMap));
  if (isRawNumber(value)) return value;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      Object.defineProperty(out, keyMap.get(key) || key, {
        value: renameKeys(v, keyMap),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }
  return value;
}

/**
 * Restores a compact JSON document. The keys are renamed by structure, not by text replacement:
 * the original tool replaced each abbreviation everywhere in the text, so an abbreviation such
 * as `n` also changed every `n` in the keys and the values.
 */
function decompressJson(content: string): string {
  try {
    JSON.parse(content);
  } catch {
    return content;
  }
  // Each number keeps its text (lossless passthrough).
  const data = parseLossless(content);
  if (data === null || typeof data !== "object" || Array.isArray(data) || isRawNumber(data)) {
    return content;
  }
  const { _legend: legend, ...rest } = data as Record<string, unknown>;
  if (!legend || typeof legend !== "object") return content;
  const keyMap = new Map<string, string>();
  for (const [abbrev, key] of Object.entries(legend)) {
    if (typeof key === "string") keyMap.set(abbrev, key);
  }
  // The compressor wraps an array, a single value and an object with the one key `data`.
  const wrapped = Object.keys(rest).join("\n") === "data";
  return JSON.stringify(renameKeys(wrapped ? rest.data : rest, keyMap), null, 2);
}

/** The start of the message for a `-d` on a format that is not JSON (K9). */
export const JSON_ONLY_MESSAGE = "decompress supports JSON only in this version";

/**
 * Restores a compact JSON file: removes the legend and renames each abbreviated key. Content
 * that does not parse, or has no legend, is returned unchanged.
 *
 * K9: this version restores JSON only. The original tool replaced text in the other formats,
 * which corrupted YAML, CSV and TSV data, and it did not read the XML and HTML legend.
 *
 * @throws Error when `format` is not `json`.
 */
export function decompress(content: string, format: FileFormat): string {
  if (format !== "json") {
    throw new Error(`${JSON_ONLY_MESSAGE}. The format '${format}' cannot be restored.`);
  }
  return decompressJson(content);
}
