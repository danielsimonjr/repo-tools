/**
 * One compressor per file format for `repo-tools compress` (design section 4).
 *
 * Each compressor returns the compact text, its legend and the size statistics. The output of
 * each compressor is the CTON format and does not change.
 */
import { extname } from "node:path";
import {
  applySubstringCompression,
  findRepeatedSubstrings,
  generateAbbreviation,
  renameKeys,
} from "./legend.ts";

/** The formats that `--format` accepts, in help order. */
export const FORMATS = [
  "json",
  "yaml",
  "markdown",
  "csv",
  "tsv",
  "text",
  "log",
  "typescript",
  "javascript",
  "xml",
  "html",
] as const;

/** The compression levels that `--level` accepts, in help order. */
export const LEVELS = ["light", "medium", "aggressive"] as const;

export type FileFormat = (typeof FORMATS)[number];
export type CompressionLevel = (typeof LEVELS)[number];

/** Sizes in bytes and estimated token counts before and after compression. */
export interface CompressionStats {
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  tokenSavings: number;
  tokenSavingsPercent: number;
}

export interface CompressionResult {
  compressed: string;
  legend: Record<string, string>;
  stats: CompressionStats;
}

export type Compressor = (content: string, level: CompressionLevel) => CompressionResult;

/** Estimates tokens: one per word, plus a half for each punctuation mark and each number. */
export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter((w) => w.length > 0).length;
  const punctuation = (text.match(/[^\w\s]/g) || []).length;
  const numbers = (text.match(/\d+/g) || []).length;
  return Math.ceil(words + punctuation * 0.5 + numbers * 0.5);
}

/** Returns the statistics for one compression (or one decompression). */
export function calculateStats(original: string, compressed: string): CompressionStats {
  const originalSize = Buffer.byteLength(original, "utf8");
  const compressedSize = Buffer.byteLength(compressed, "utf8");
  const before = estimateTokens(original);
  const after = estimateTokens(compressed);
  return {
    originalSize,
    compressedSize,
    compressionRatio: compressedSize / originalSize,
    estimatedTokensBefore: before,
    estimatedTokensAfter: after,
    tokenSavings: before - after,
    tokenSavingsPercent: ((before - after) / before) * 100,
  };
}

/** The minimum key length that is abbreviated at each level. */
function minKeyLength(level: CompressionLevel): number {
  return level === "light" ? 6 : level === "medium" ? 4 : 3;
}

function result(content: string, compressed: string, legend: Record<string, string>) {
  return { compressed, legend, stats: calculateStats(content, compressed) };
}

// ---------------------------------------------------------------------------------------------
// JSON: key abbreviation and minification.

function collectKeys(value: unknown, freq: Map<string, number>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, freq);
  } else if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      freq.set(key, (freq.get(key) || 0) + 1);
      collectKeys((value as Record<string, unknown>)[key], freq);
    }
  }
}

const compressJson: Compressor = (content, level) => {
  const data: unknown = JSON.parse(content);
  const legend: Record<string, string> = {};
  const freq = new Map<string, number>();
  collectKeys(data, freq);
  // An abbreviation must not equal a key in the data, or a key and its value are lost in the
  // compact file. `_legend` and `data` are the reserved keys of the compact file.
  const existing = new Set<string>([...freq.keys(), "_legend", "data"]);

  // Highest frequency times length first.
  const keys = [...freq.entries()]
    .filter(([key]) => key.length >= minKeyLength(level))
    .sort((a, b) => b[1] * b[0].length - a[1] * a[0].length);

  const keyMap = new Map<string, string>();
  for (const [key] of keys) {
    const abbrev = generateAbbreviation(key, existing);
    keyMap.set(key, abbrev);
    legend[abbrev] = key;
    existing.add(abbrev);
  }

  const transformed = renameKeys(data, keyMap);
  // An array, a single value and an object with the one key `data` are wrapped as the value of
  // `data`. `-d` unwraps a compact file whose only keys are `_legend` and `data`.
  const isObject =
    typeof transformed === "object" && transformed !== null && !Array.isArray(transformed);
  const onlyData = isObject && Object.keys(transformed).join("\n") === "data";
  const output =
    isObject && !onlyData
      ? { _legend: legend, ...(transformed as Record<string, unknown>) }
      : { _legend: legend, data: transformed };
  return result(content, JSON.stringify(output), legend);
};

// ---------------------------------------------------------------------------------------------
// YAML: key abbreviation, with the legend in comment lines.

const compressYaml: Compressor = (content, level) => {
  const lines = content.split("\n");
  const legend: Record<string, string> = {};
  const existing = new Set<string>();
  const freq = new Map<string, number>();
  const keyPattern = /^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/;

  for (const line of lines) {
    const key = line.match(keyPattern)?.[2];
    if (key !== undefined) freq.set(key, (freq.get(key) || 0) + 1);
  }

  const keyMap = new Map<string, string>();
  for (const [key] of freq.entries()) {
    if (key.length >= minKeyLength(level)) {
      const abbrev = generateAbbreviation(key, existing);
      keyMap.set(key, abbrev);
      legend[abbrev] = key;
      existing.add(abbrev);
    }
  }

  const out = lines.map((line) => {
    const match = line.match(keyPattern);
    if (!match) return line;
    const [full, indent, key] = match as unknown as [string, string, string];
    return line.replace(full, `${indent}${keyMap.get(key) || key}:`);
  });

  const header = Object.entries(legend)
    .map(([abbrev, full]) => `# ${abbrev}: ${full}`)
    .join("\n");
  return result(content, `${header}\n---\n${out.join("\n")}`, legend);
};

// ---------------------------------------------------------------------------------------------
// Markdown: whitespace normalization and substring compression.

const compressMarkdown: Compressor = (content, level) => {
  let compressed = content;
  let legend: Record<string, string> = {};

  if (level === "aggressive" || level === "medium") {
    compressed = compressed.replace(/\n{3,}/g, "\n\n");
    compressed = compressed.replace(/^[-*_]{3,}$/gm, "---");
    compressed = compressed.replace(/[ \t]+$/gm, "");
  }
  if (level === "aggressive") {
    compressed = compressed.replace(/<!--[\s\S]*?-->/g, "");
  }

  const minLength = level === "light" ? 8 : level === "medium" ? 6 : 5;
  const minOccurrences = level === "light" ? 5 : level === "medium" ? 4 : 3;
  const maxSubstrings = level === "light" ? 10 : level === "medium" ? 25 : 50;
  const substrings = findRepeatedSubstrings(compressed, minLength, minOccurrences, maxSubstrings);

  // Apply only when the saving is more than 50 characters.
  if (substrings.reduce((sum, s) => sum + s.savings, 0) > 50) {
    const applied = applySubstringCompression(compressed, substrings);
    legend = applied.legend;
    const entries = Object.entries(legend).map(([a, f]) => `${a}=${f}`);
    compressed = `<!-- §: ${entries.join(" | ")} -->\n${applied.compressed}`;
  }
  return result(content, compressed, legend);
};

// ---------------------------------------------------------------------------------------------
// CSV and TSV: header abbreviation, and value abbreviation at the aggressive level.

function parseDelimited(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function delimitedCompressor(delimiter: string): Compressor {
  return (content, level) => {
    const lines = content.split("\n").filter((l) => l.trim());
    const first = lines[0];
    if (first === undefined) return result(content, content, {});

    const legend: Record<string, string> = {};
    const existing = new Set<string>();
    const header = parseDelimited(first, delimiter).map((col) => {
      if (col.length < minKeyLength(level)) return col;
      const abbrev = generateAbbreviation(col, existing);
      legend[abbrev] = col;
      existing.add(abbrev);
      return abbrev;
    });

    const rows = lines.slice(1).map((line) => parseDelimited(line, delimiter));
    const valueMap = new Map<string, string>();
    if (level === "aggressive") {
      const columns = new Map<number, Map<string, number>>();
      for (const row of rows) {
        row.forEach((val, idx) => {
          let counts = columns.get(idx);
          if (!counts) {
            counts = new Map();
            columns.set(idx, counts);
          }
          counts.set(val, (counts.get(val) || 0) + 1);
        });
      }
      for (const counts of columns.values()) {
        for (const [val, count] of counts.entries()) {
          if (count >= 3 && val.length > 5 && !valueMap.has(val)) {
            const abbrev = generateAbbreviation(val, existing);
            valueMap.set(val, abbrev);
            legend[abbrev] = val;
            existing.add(abbrev);
          }
        }
      }
    }

    const out = [header.join(delimiter)];
    for (const row of rows) out.push(row.map((val) => valueMap.get(val) || val).join(delimiter));
    const comment = Object.entries(legend)
      .map(([abbrev, full]) => `# ${abbrev}=${full}`)
      .join("\n");
    return result(content, `${comment}\n${out.join("\n")}`, legend);
  };
}

// ---------------------------------------------------------------------------------------------
// Text and log: whitespace, timestamps and log levels, and substring compression.

const LOG_LEVELS: Record<string, string> = {
  ERROR: "@E",
  WARNING: "@W",
  WARN: "@W",
  INFO: "@I",
  DEBUG: "@D",
  TRACE: "@T",
};

const compressText: Compressor = (content, level) => {
  let compressed = content.replace(/\r\n/g, "\n");
  const legend: Record<string, string> = {};

  if (level !== "light") {
    compressed = compressed.replace(/[ \t]+/g, " ");
    compressed = compressed.replace(/\n{3,}/g, "\n\n");
  }

  if (level === "aggressive") {
    const timestamps = compressed.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g) || [];
    [...new Set(timestamps)].forEach((ts, idx) => {
      const abbrev = `@t${idx}`;
      legend[abbrev] = ts;
      compressed = compressed.split(ts).join(abbrev);
    });
    for (const [full, abbrev] of Object.entries(LOG_LEVELS)) {
      if (compressed.includes(full)) {
        legend[abbrev] = full;
        compressed = compressed.replace(new RegExp(`\\b${full}\\b`, "g"), abbrev);
      }
    }
  }

  // The light level uses the aggressive thresholds, as in the original tool.
  const minLength = level === "medium" ? 6 : 5;
  const minOccurrences = level === "medium" ? 4 : 3;
  const maxSubstrings = level === "medium" ? 30 : 50;
  const substrings = findRepeatedSubstrings(compressed, minLength, minOccurrences, maxSubstrings);

  if (substrings.reduce((sum, s) => sum + s.savings, 0) > 30) {
    const applied = applySubstringCompression(compressed, substrings);
    Object.assign(legend, applied.legend);
    compressed = applied.compressed;
  }

  if (Object.keys(legend).length > 0) {
    const entries = Object.entries(legend).map(([a, f]) => `${a} = ${f}`);
    compressed = `=== Legend ===\n${entries.join("\n")}\n=============\n\n${compressed}`;
  }
  return result(content, compressed, legend);
};

// ---------------------------------------------------------------------------------------------
// TypeScript and JavaScript: comment removal and whitespace normalization. No legend.

const compressCode: Compressor = (content, level) => {
  let compressed = content;
  if (level !== "light") {
    // Line comments, but not the `//` of a URL.
    compressed = compressed.replace(/(?<!:)\/\/(?!\/)[^\n]*/g, "");
    compressed = compressed.replace(/\/\*[\s\S]*?\*\//g, "");
  }
  if (level === "aggressive") {
    compressed = compressed.replace(/\/\*\*[\s\S]*?\*\//g, "");
  }
  if (level !== "light") {
    compressed = compressed.replace(/[ \t]+$/gm, "");
    compressed = compressed.replace(/\n{3,}/g, "\n\n");
    compressed = compressed.trim();
  }
  if (level === "aggressive") {
    compressed = compressed.replace(/\s*{\s*/g, "{");
    compressed = compressed.replace(/\s*}\s*/g, "}");
    compressed = compressed.replace(/;\s+/g, ";");
  }
  return result(content, compressed, {});
};

// ---------------------------------------------------------------------------------------------
// XML and HTML: comment removal, whitespace between tags, and tag abbreviation.

const compressXml: Compressor = (content, level) => {
  let compressed = content;
  const legend: Record<string, string> = {};
  const existing = new Set<string>();

  if (level !== "light") {
    compressed = compressed.replace(/<!--[\s\S]*?-->/g, "");
    compressed = compressed.replace(/>\s+</g, "><");
  }

  if (level === "aggressive") {
    const tags = new Map<string, number>();
    for (const match of content.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9_-]*)/g)) {
      const tag = match[1] ?? "";
      tags.set(tag, (tags.get(tag) || 0) + 1);
    }
    for (const [tag, count] of tags.entries()) {
      if (tag.length > 6 && count >= 2) {
        const abbrev = generateAbbreviation(tag, existing);
        legend[abbrev] = tag;
        existing.add(abbrev);
        compressed = compressed.replace(new RegExp(`<${tag}([ >])`, "g"), `<${abbrev}$1`);
        compressed = compressed.replace(new RegExp(`</${tag}>`, "g"), `</${abbrev}>`);
      }
    }
  }

  if (Object.keys(legend).length > 0) {
    const entries = Object.entries(legend).map(([a, f]) => `${a}=${f}`);
    compressed = `<!-- Legend: ${entries.join(", ")} -->\n${compressed}`;
  }
  return result(content, compressed, legend);
};

// ---------------------------------------------------------------------------------------------

const EXTENSIONS: Record<string, FileFormat> = {
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".md": "markdown",
  ".markdown": "markdown",
  ".csv": "csv",
  ".tsv": "tsv",
  ".txt": "text",
  ".log": "log",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".xml": "xml",
  ".html": "html",
  ".htm": "html",
  ".xhtml": "html",
  ".svg": "xml",
};

/** Returns the format for a file name from its extension. An unknown extension is `text`. */
export function detectFormat(filePath: string): FileFormat {
  const ext = extname(filePath).toLowerCase();
  return Object.hasOwn(EXTENSIONS, ext) ? (EXTENSIONS[ext] as FileFormat) : "text";
}

const COMPRESSORS: Record<FileFormat, Compressor> = {
  json: compressJson,
  yaml: compressYaml,
  markdown: compressMarkdown,
  csv: delimitedCompressor(","),
  tsv: delimitedCompressor("\t"),
  text: compressText,
  log: compressText,
  typescript: compressCode,
  javascript: compressCode,
  xml: compressXml,
  html: compressXml,
};

/** Returns the compressor for `format`. */
export function getCompressor(format: FileFormat): Compressor {
  return COMPRESSORS[format];
}
