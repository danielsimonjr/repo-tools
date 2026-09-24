/**
 * Legend build and parse for `repo-tools compress` (design section 4).
 *
 * A legend maps a short abbreviation to the full text that it replaces. The compressors build
 * legends with the helpers here, and `decompress` reads a legend back from a compact file and
 * restores the full text. The legend syntax of each format is part of the CTON format and does
 * not change.
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

/** Removes the legend from `content` and returns the body and the parsed legend. */
function parseLegend(
  content: string,
  format: FileFormat,
): { body: string; legend: Record<string, string> } {
  let result = content;
  const legend: Record<string, string> = {};

  if (format === "markdown" || format === "html" || format === "xml") {
    const legendMatch = result.match(/<!--\s*§:\s*([^>]+)\s*-->\n?/);
    if (legendMatch) {
      result = result.replace(legendMatch[0], "");
      // Split on " | " only. A value keeps its spaces.
      for (const entry of (legendMatch[1] ?? "").split(" | ")) {
        const eq = entry.indexOf("=");
        if (eq > 0) {
          const abbrev = entry.slice(0, eq).trim();
          const value = entry.slice(eq + 1);
          if (abbrev && value) legend[abbrev] = value;
        }
      }
    }
  } else if (format === "yaml") {
    const lines = result.split("\n");
    let i = 0;
    while (i < lines.length && (lines[i] ?? "").startsWith("#")) {
      const match = (lines[i] ?? "").match(/^#\s*(\S+):\s*(.+)$/);
      if (match?.[1] !== undefined && match[2] !== undefined) legend[match[1]] = match[2];
      i++;
    }
    if (lines[i] === "---") i++;
    result = lines.slice(i).join("\n");
  } else if (format === "text" || format === "log") {
    const legendMatch = result.match(/=== Legend ===\n([\s\S]*?)\n=+\n\n?/);
    if (legendMatch) {
      result = result.replace(legendMatch[0], "");
      for (const entry of (legendMatch[1] ?? "").split("\n")) {
        const [abbrev, ...valueParts] = entry.split(" = ");
        if (abbrev && valueParts.length > 0) {
          legend[abbrev.trim()] = valueParts.join(" = ").trim();
        }
      }
    }
  } else if (format === "csv" || format === "tsv") {
    const data: string[] = [];
    for (const line of result.split("\n")) {
      if (line.startsWith("#")) {
        const match = line.match(/^#\s*(\S+)=(.+)$/);
        if (match?.[1] !== undefined && match[2] !== undefined) legend[match[1]] = match[2];
      } else {
        data.push(line);
      }
    }
    result = data.join("\n");
  }
  return { body: result, legend };
}

/** Returns a copy of `value` with each object key renamed through `keyMap`. */
export function renameKeys(value: unknown, keyMap: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => renameKeys(item, keyMap));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[keyMap.get(key) || key] = renameKeys(v, keyMap);
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
  if (data === null || typeof data !== "object") return content;
  const { _legend: legend, ...rest } = data as Record<string, unknown>;
  if (!legend || typeof legend !== "object") return content;
  const keyMap = new Map<string, string>();
  for (const [abbrev, key] of Object.entries(legend)) {
    if (typeof key === "string") keyMap.set(abbrev, key);
  }
  return JSON.stringify(renameKeys(rest, keyMap), null, 2);
}

/**
 * Restores a compact file: removes the legend and replaces each abbreviation with its full
 * text. Content in the `json` format that does not parse, or has no legend, is returned
 * unchanged.
 */
export function decompress(content: string, format: FileFormat): string {
  if (format === "json") return decompressJson(content);
  const parsed = parseLegend(content, format);
  let result = parsed.body;
  // Longer abbreviations first, so §10 is replaced before §1.
  const entries = Object.entries(parsed.legend).sort((a, b) => b[0].length - a[0].length);
  for (const [abbrev, original] of entries) {
    result = result.split(abbrev).join(original);
  }
  return result;
}
