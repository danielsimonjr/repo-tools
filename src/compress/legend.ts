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
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Throws when the JSON source text holds an integer outside the safe integer range of a
 * JavaScript number (plus or minus 2^53 - 1). `JSON.parse` changes such an integer
 * (12345678901234567890 becomes 12345678901234567000), so the data would change without a
 * message. The check reads the source text, because the parsed value has already lost the digits.
 * A number with a fraction or an exponent is not an integer token and is not checked.
 *
 * @throws Error that names the first unsafe integer.
 */
export function assertSafeIntegers(text: string): void {
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    if (ch === '"') {
      // Skip the string, and each escaped character in it.
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      i++;
    } else if (ch === "-" || (ch >= "0" && ch <= "9")) {
      NUMBER_TOKEN.lastIndex = i;
      const match = NUMBER_TOKEN.exec(text);
      const token = match?.[0] ?? ch;
      if (match && match[1] === undefined && match[2] === undefined) {
        const value = BigInt(token);
        if (value > MAX_SAFE || value < -MAX_SAFE) {
          throw new Error(
            `the JSON holds the integer ${token}, which is outside the safe integer range ` +
              `(-${MAX_SAFE} to ${MAX_SAFE}). JSON.parse would change it, so the file is not processed.`,
          );
        }
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
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return content;
  }
  assertSafeIntegers(content);
  if (data === null || typeof data !== "object" || Array.isArray(data)) return content;
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
