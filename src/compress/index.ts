/**
 * `repo-tools compress` (design sections 3.4 and 4).
 *
 * Writes a compact copy of a file for a model context, in the CTON format, or restores a compact
 * file. Single-file mode and batch mode are available.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { Io } from "../io-types.ts";
import { compareCodeUnits } from "../sort.ts";
import {
  type CompressionLevel,
  type CompressionStats,
  calculateStats,
  detectFormat,
  type FileFormat,
  FORMATS,
  getCompressor,
  LEVELS,
} from "./formats.ts";
import { decompress, JSON_ONLY_MESSAGE } from "./legend.ts";

/** The help text of the subcommand. */
export const HELP = `Usage: repo-tools compress <input...> [options]
       repo-tools compress --batch --pattern <glob> [<directory>] [options]

Writes a compact copy of each input file (the CTON format), or restores a compact JSON file.

Arguments:
  <input>              The file to compress. In batch mode with --pattern, the directory
                       to search (default: the working folder). In batch mode without
                       --pattern, the files to compress.

Options:
  -o, --output <file>  The output file. Default: <input>.compact<ext>.
  -f, --format <fmt>   The input format: json, yaml, markdown, csv, tsv, text, log,
                       typescript, javascript, xml or html. Default: from the extension.
  -l, --level <lvl>    The compression level: light, medium or aggressive. Default: medium.
  --no-legend          Accepted for compatibility. The legend is always written.
  --no-stats           Do not show the statistics.
  --dry-run            Show a preview. Do not write a file.
  -d, --decompress     Restore a compact file. The output file name is the input file
                       name without ".compact". A folder name does not change.
                       This version restores JSON only. -d on any other format
                       exits 1 and writes no file.

Batch options:
  -b, --batch          Process many files.
  -p, --pattern <pat>  The file-name pattern, for example "*.md". Default: "*.json".
  -r, --recursive      Also search the subdirectories.

Levels:
  light       Small changes. The output stays easy to read.
  medium      A balance of size and readability.
  aggressive  The smallest output. The output can be difficult to read.

JSON:
  An integer outside the safe range (-9007199254740991 to 9007199254740991) is refused
  (exit 1), because JSON.parse would change its value. An integer-like key ("2", "10")
  moves to the start of its object, in numeric order, as JSON.parse orders it.

Exit codes: 0 when all files are done, 1 on an error.
`;

/** The file-system access that batch mode uses. Tests replace it. */
export interface CompressDeps {
  readdir: (dir: string) => { name: string; isDirectory(): boolean; isFile(): boolean }[];
}

const defaultDeps: CompressDeps = {
  readdir: (dir) => readdirSync(dir, { withFileTypes: true }),
};

interface Options {
  input: string;
  inputs: string[];
  output: string;
  format: FileFormat | "auto";
  level: CompressionLevel;
  showStats: boolean;
  dryRun: boolean;
  batch: boolean;
  decompress: boolean;
  recursive: boolean;
  pattern: string;
}

interface BatchResult {
  file: string;
  success: boolean;
  stats?: CompressionStats;
  error?: string;
  outputFile?: string;
}

function parseArgs(args: readonly string[]): Options {
  const o: Options = {
    input: "",
    inputs: [],
    output: "",
    format: "auto",
    level: "medium",
    showStats: true,
    dryRun: false,
    batch: false,
    decompress: false,
    recursive: false,
    pattern: "",
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "-o" || arg === "--output") {
      o.output = args[++i] || "";
    } else if (arg === "-f" || arg === "--format") {
      o.format = (args[++i] || "auto") as FileFormat | "auto";
    } else if (arg === "-l" || arg === "--level") {
      o.level = (args[++i] || "medium") as CompressionLevel;
    } else if (arg === "--no-legend") {
      // Accepted and ignored, as in the original tool.
    } else if (arg === "--no-stats") {
      o.showStats = false;
    } else if (arg === "--dry-run") {
      o.dryRun = true;
    } else if (arg === "-b" || arg === "--batch") {
      o.batch = true;
    } else if (arg === "-d" || arg === "--decompress") {
      o.decompress = true;
    } else if (arg === "-r" || arg === "--recursive") {
      o.recursive = true;
    } else if (arg === "-p" || arg === "--pattern") {
      o.pattern = args[++i] || "*.json";
    } else if (!arg.startsWith("-")) {
      if (!o.input) o.input = arg;
      o.inputs.push(arg);
    }
  }
  return o;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function statsText(s: CompressionStats): string {
  return [
    "",
    "=== Compression Statistics ===",
    `Original size:     ${formatBytes(s.originalSize)}`,
    `Compressed size:   ${formatBytes(s.compressedSize)}`,
    `Size reduction:    ${percent(1 - s.compressionRatio)}`,
    "",
    `Est. tokens before: ${s.estimatedTokensBefore.toLocaleString()}`,
    `Est. tokens after:  ${s.estimatedTokensAfter.toLocaleString()}`,
    `Token savings:      ${s.tokenSavings.toLocaleString()} (${s.tokenSavingsPercent.toFixed(1)}%)`,
    "==============================",
    "",
  ].join("\n");
}

function batchSummaryText(results: readonly BatchResult[]): string {
  const ok = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const lines = [
    "",
    "=== Batch Processing Summary ===",
    `Total files:    ${results.length}`,
    `Successful:     ${ok.length}`,
    `Failed:         ${failed.length}`,
  ];
  if (ok.length > 0) {
    const sum = (pick: (s: CompressionStats) => number) =>
      ok.reduce((total, r) => total + (r.stats ? pick(r.stats) : 0), 0);
    const original = sum((s) => s.originalSize);
    const compressed = sum((s) => s.compressedSize);
    const before = sum((s) => s.estimatedTokensBefore);
    const after = sum((s) => s.estimatedTokensAfter);
    lines.push(
      "",
      `Total original:   ${formatBytes(original)}`,
      `Total compressed: ${formatBytes(compressed)}`,
      `Overall savings:  ${percent(1 - compressed / original)}`,
      "",
      `Total tokens before: ${before.toLocaleString()}`,
      `Total tokens after:  ${after.toLocaleString()}`,
      `Total token savings: ${(before - after).toLocaleString()}`,
    );
  }
  if (failed.length > 0) {
    lines.push("", "Failed files:");
    for (const f of failed) lines.push(`  ${f.file}: ${f.error}`);
  }
  lines.push("================================", "");
  return lines.join("\n");
}

/**
 * Converts a simple glob (`*` and `?`) to a case-insensitive regular expression. Every other
 * character is literal: each RegExp metacharacter is escaped, so `a+b.md` does not match
 * `aab.md` and `a[.md` does not throw.
 */
function globToRegExp(pattern: string): RegExp {
  const source = pattern
    .replace(/[.+^${}()|[\]\\/]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${source}$`, "i");
}

/**
 * Returns the files in `dir` whose names match `pattern`, each folder in code-unit order of its
 * entry names. With `recursive`, it also searches the subdirectories, except hidden directories
 * and `node_modules`.
 */
export function findFiles(
  dir: string,
  pattern: string,
  recursive: boolean,
  deps: CompressDeps = defaultDeps,
): string[] {
  const regex = globToRegExp(pattern);
  const found: string[] = [];
  const scan = (current: string): void => {
    // K6: readdir order depends on the file system. Sort the names of each folder in code-unit
    // order; a sort of full paths would differ by OS, because the separator differs.
    const entries = [...deps.readdir(current)].sort((a, b) => compareCodeUnits(a.name, b.name));
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !entry.name.startsWith(".") && entry.name !== "node_modules") scan(full);
      } else if (entry.isFile() && regex.test(entry.name)) {
        found.push(full);
      }
    }
  };
  scan(dir);
  return found;
}

/** True when `path` exists and is a directory. */
function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/** Returns `<dir>/<base>.compact<ext>` for `file`. */
function compactName(file: string): string {
  const ext = extname(file);
  return join(dirname(file), `${basename(file, ext)}.compact${ext}`);
}

/**
 * Returns the output name of `-d` for `file`: the base name without the ".compact" before the
 * extension (or at the end). A folder name does not change. When the result is the input name,
 * it returns `<dir>/<base>.restored<ext>`, so `-d` never writes to its input.
 */
function restoredName(file: string): string {
  const base = basename(file);
  const stripped = base.replace(/\.compact(?=\.[^.]*$|$)/, "");
  const output = stripped === base ? file : join(dirname(file), stripped);
  if (output !== file) return output;
  const ext = extname(file);
  return join(dirname(file), `${basename(file, ext)}.restored${ext}`);
}

// A compact file is written byte for byte (a plain write, not `writeLf`): the output keeps the
// line endings of the input, so a restored file can equal its original.
function writeExact(path: string, text: string): void {
  writeFileSync(path, text, "utf8");
}

function processBatch(files: readonly string[], o: Options): BatchResult[] {
  return files.map((file): BatchResult => {
    try {
      const content = readFileSync(file, "utf8");
      const format = o.format === "auto" ? detectFormat(file) : o.format;
      if (o.decompress) {
        const restored = decompress(content, format);
        const outputFile = restoredName(file);
        if (!o.dryRun) writeExact(outputFile, restored);
        return { file, success: true, outputFile, stats: calculateStats(content, restored) };
      }
      const result = getCompressor(format)(content, o.level);
      const outputFile = compactName(file);
      if (!o.dryRun) writeExact(outputFile, result.compressed);
      return { file, success: true, outputFile, stats: result.stats };
    } catch (error) {
      return {
        file,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function runBatch(o: Options, io: Io, deps: CompressDeps): number {
  const say = (line: string) => io.stdout(`${line}\n`);
  let files: string[] = [];
  if (o.pattern) {
    const searchDir = o.input || ".";
    if (!existsSync(searchDir)) {
      io.stderr(`Error: Directory not found: ${searchDir}\n`);
      return 1;
    }
    if (!isDirectory(searchDir)) {
      io.stderr(`Error: ${searchDir} is not a directory. With --pattern, give a directory.\n`);
      return 1;
    }
    files = findFiles(searchDir, o.pattern, o.recursive, deps);
    say(`Found ${files.length} files matching "${o.pattern}"${o.recursive ? " (recursive)" : ""}`);
  } else if (o.inputs.length > 0) {
    const dir = o.inputs.find(isDirectory);
    if (dir !== undefined) {
      io.stderr(`Error: ${dir} is a directory. Use --pattern <glob> to select files in it.\n`);
      return 1;
    }
    files = o.inputs.filter((f) => existsSync(f));
    const missing = o.inputs.filter((f) => !existsSync(f));
    if (missing.length > 0) {
      io.stderr(`Warning: ${missing.length} file(s) not found: ${missing.join(", ")}\n`);
    }
  }
  // Compression skips the .compact files: the original tool compressed its own output again
  // (README.compact.compact.md). Decompression takes only the .compact files: the original tool
  // restored any matched file, and wrote the result over the input when the name had no
  // ".compact" (conf.yaml, d.csv).
  const isCompact = (f: string) => basename(f).includes(".compact");
  const skipped = files.filter((f) => isCompact(f) !== o.decompress);
  if (skipped.length > 0) {
    files = files.filter((f) => isCompact(f) === o.decompress);
    const how = o.decompress ? "without" : "with";
    say(`Skipped ${skipped.length} file(s) ${how} ".compact" in the name.`);
  }
  if (files.length === 0) {
    io.stderr(
      "Error: No files to process. Use -p to specify a pattern or provide file arguments.\n",
    );
    return 1;
  }

  say(`\n${o.decompress ? "Decompressing" : "Compressing"} ${files.length} file(s)...\n`);
  const results = processBatch(files, o);
  for (const r of results) {
    if (r.success) {
      const savings = r.stats ? `(${percent(1 - r.stats.compressionRatio)})` : "";
      say(`✓ ${r.file} → ${r.outputFile} ${savings}`);
    } else {
      say(`✗ ${r.file}: ${r.error}`);
    }
  }
  if (o.showStats) say(batchSummaryText(results));
  return results.some((r) => !r.success) ? 1 : 0;
}

function preview(text: string): string {
  const more = text.length > 500 ? "...\n" : "";
  return `Dry run - no file written\n\n--- Preview (first 500 chars) ---\n${text.slice(0, 500)}\n${more}--- End preview ---\n`;
}

function runDecompress(o: Options, format: FileFormat, io: Io): number {
  const content = readFileSync(o.input, "utf8");
  const output = o.output || restoredName(o.input);
  io.stdout(`Decompressing: ${o.input}\nFormat: ${format}\n`);
  const restored = decompress(content, format);
  const s = calculateStats(content, restored);
  if (o.showStats) {
    io.stdout(
      [
        "",
        "=== Decompression Statistics ===",
        `Compressed size:   ${formatBytes(s.originalSize)}`,
        `Restored size:     ${formatBytes(s.compressedSize)}`,
        `Size increase:     ${percent(s.compressionRatio - 1)}`,
        "================================",
        "",
        "",
      ].join("\n"),
    );
  }
  if (o.dryRun) {
    io.stdout(preview(restored));
  } else {
    writeExact(output, restored);
    io.stdout(`Output written to: ${output}\n`);
  }
  return 0;
}

function runCompress(o: Options, format: FileFormat, io: Io): number {
  const output = o.output || compactName(o.input);
  const content = readFileSync(o.input, "utf8");
  const compressor = getCompressor(format);
  io.stdout(`Compressing: ${o.input}\nFormat: ${format}\nLevel: ${o.level}\n`);
  const result = compressor(content, o.level);
  if (o.showStats) io.stdout(`${statsText(result.stats)}\n`);
  if (o.dryRun) {
    io.stdout(preview(result.compressed));
  } else {
    writeExact(output, result.compressed);
    io.stdout(`Output written to: ${output}\n`);
  }
  return 0;
}

/**
 * Runs `repo-tools compress` and returns the exit code.
 *
 * @param argv - The arguments after `compress`.
 * @param io - Where to write normal output and error output.
 * @param deps - The file-system access for batch mode. Tests replace it.
 */
export async function run(
  argv: string[],
  io: Io,
  deps: CompressDeps = defaultDeps,
): Promise<number> {
  const o = parseArgs(argv);
  // K5: the original tool accepted any value and fell back to other settings without a message.
  if (!(LEVELS as readonly string[]).includes(o.level)) {
    io.stderr(`Error: invalid level '${o.level}'. Use one of: ${LEVELS.join(", ")}.\n`);
    return 1;
  }
  if (o.format !== "auto" && !(FORMATS as readonly string[]).includes(o.format)) {
    io.stderr(`Error: invalid format '${o.format}'. Use one of: ${FORMATS.join(", ")}.\n`);
    return 1;
  }
  try {
    if (o.batch) return runBatch(o, io, deps);
    if (!o.input) {
      io.stdout(HELP);
      return 1;
    }
    if (!existsSync(o.input)) {
      io.stderr(`Error: Input file not found: ${o.input}\n`);
      return 1;
    }
    if (isDirectory(o.input)) {
      io.stderr(`Error: ${o.input} is a directory. Use --batch --pattern <glob> for a folder.\n`);
      return 1;
    }
    const format = o.format === "auto" ? detectFormat(o.input) : o.format;
    if (o.decompress && format !== "json") {
      io.stderr(`Error: ${JSON_ONLY_MESSAGE}. The format '${format}' cannot be restored.\n`);
      return 1;
    }
    return o.decompress ? runDecompress(o, format, io) : runCompress(o, format, io);
  } catch (error) {
    io.stderr(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
