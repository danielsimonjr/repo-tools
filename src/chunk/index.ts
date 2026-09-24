/**
 * `repo-tools chunk` (design sections 3.3 and 4): split a large file into chunk files, merge
 * the chunks back, or show which chunks changed.
 *
 * Output goes to `io`. Errors return exit code 1; this module never ends the process.
 */
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { writeLf } from "../io.ts";
import type { Io } from "../io-types.ts";
import {
  type ChunkInfo,
  contentHash,
  type FileType,
  hashFor,
  MANIFEST_NAME,
  MANIFEST_VERSION,
  type Manifest,
  readManifest,
  relativeSource,
  resolveSource,
  writeManifest,
} from "./manifest.ts";
import {
  chunkFilename,
  detectFileType,
  detectLineEnding,
  type JsonSplit,
  mergeJson,
  mergeJsonLayout,
  normalizeLineEndings,
  splitJson,
  splitMarkdown,
  splitTypeScript,
} from "./splitters.ts";

/** The help text of `repo-tools chunk`. */
export const CHUNK_HELP = `Usage:
  repo-tools chunk split <file> [options]       Split a file into chunks
  repo-tools chunk merge <manifest.json>        Merge the chunks back into one file
  repo-tools chunk status <manifest.json>       Show which chunks changed

Split options:
  -o, --output <dir>     Chunk folder (default: <file>_chunks/ beside the file)
  -l, --level <n>        Split level (Markdown heading level, default: 2; other types: 1)
  -m, --max-lines <n>    Mark a chunk with more lines as [LARGE] (default: 500)
  -t, --type <type>      File type: auto, markdown, json, typescript (default: auto)
  --dry-run              Show the result and write no files

Merge options:
  -o, --output <file>    Output file (default: the source file of the manifest)
  --yes                  Write a source file outside the parent folder of the chunk folder
  --allow-shrink         Write a result that is smaller than the file it replaces
  --dry-run              Show the result and write no files

Status options:
  --yes                  Read a source file outside the parent folder of the chunk folder

File types:
  Markdown (.md, .markdown)          Splits at headings of level 1 to <n>.
  JSON (.json)                       Splits at the top-level keys of an object.
  TypeScript, JavaScript (.ts, .js)  Splits at top-level declarations and statements.
  A merge of unchanged chunks gives the source file again, byte for byte.
  Other extensions are read as Markdown.

Workflow:
  1. repo-tools chunk split large-file.ts
  2. Edit the chunk files.
  3. repo-tools chunk status large-file_chunks/manifest.json
  4. repo-tools chunk merge large-file_chunks/manifest.json
`;

interface Options {
  output?: string;
  level?: number;
  maxLines?: number;
  type?: string;
  dryRun?: boolean;
  yes?: boolean;
  allowShrink?: boolean;
}

/** One flag: its long name, the actions that accept it, and how it sets the options. */
interface Flag {
  long: string;
  actions: readonly string[];
  /** Sets the option. A flag with a value receives it; a switch receives undefined. */
  apply: (options: Options, value: string) => void;
  takesValue: boolean;
}

const FLAGS: Record<string, Flag> = {
  "--output": {
    long: "--output",
    actions: ["split", "merge"],
    takesValue: true,
    apply: (o, v) => {
      o.output = v;
    },
  },
  "--level": {
    long: "--level",
    actions: ["split"],
    takesValue: true,
    apply: (o, v) => {
      o.level = Number.parseInt(v, 10);
    },
  },
  "--max-lines": {
    long: "--max-lines",
    actions: ["split"],
    takesValue: true,
    apply: (o, v) => {
      o.maxLines = Number.parseInt(v, 10);
    },
  },
  "--type": {
    long: "--type",
    actions: ["split"],
    takesValue: true,
    apply: (o, v) => {
      o.type = v;
    },
  },
  "--dry-run": {
    long: "--dry-run",
    actions: ["split", "merge"],
    takesValue: false,
    apply: (o) => {
      o.dryRun = true;
    },
  },
  "--yes": {
    long: "--yes",
    actions: ["merge", "status"],
    takesValue: false,
    apply: (o) => {
      o.yes = true;
    },
  },
  "--allow-shrink": {
    long: "--allow-shrink",
    actions: ["merge"],
    takesValue: false,
    apply: (o) => {
      o.allowShrink = true;
    },
  },
};

const SHORT_FLAGS: Record<string, string> = {
  "-o": "--output",
  "-l": "--level",
  "-m": "--max-lines",
  "-t": "--type",
};

function flagFor(arg: string): Flag | undefined {
  const long = SHORT_FLAGS[arg] ?? arg;
  return Object.hasOwn(FLAGS, long) ? FLAGS[long] : undefined;
}

/** The target file and the options of one action, or an error message. */
type Parsed = { target?: string; options: Options; error?: undefined } | { error: string };

/**
 * Parses the arguments after the action. Flags can come before or after the target. An
 * unknown flag, a flag of another action, a flag without its value and a second target give
 * an error (item a: the original ignored them and ran with other settings).
 */
function parseArgs(action: string, args: readonly string[]): Parsed {
  const options: Options = {};
  let target: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg.startsWith("-") && arg.length > 1) {
      const flag = flagFor(arg);
      if (!flag?.actions.includes(action)) {
        return { error: `unknown option '${arg}' for chunk ${action}` };
      }
      const name = arg === flag.long ? flag.long : `${arg}/${flag.long}`;
      if (flag.takesValue) {
        const value = args[i + 1];
        if (value === undefined || flagFor(value) !== undefined) {
          return { error: `${name} needs a value` };
        }
        flag.apply(options, value);
        i++;
      } else {
        flag.apply(options, "");
      }
    } else if (target === undefined) {
      target = arg;
    } else {
      return { error: `unexpected argument '${arg}' (chunk ${action} takes one file)` };
    }
  }
  return { target, options };
}

const FILE_TYPES = ["auto", "markdown", "json", "typescript"];

/** Returns an error message for an invalid flag value, or undefined when all values are valid. */
function invalidOption(options: Options): string | undefined {
  if (options.type !== undefined && !FILE_TYPES.includes(options.type)) {
    return `invalid --type '${options.type}' (use auto, markdown, json or typescript)`;
  }
  if (options.level !== undefined && !(options.level >= 1)) {
    return "--level needs a whole number of 1 or more";
  }
  if (options.maxLines !== undefined && !(options.maxLines >= 0)) {
    return "--max-lines needs a whole number of 0 or more";
  }
  return undefined;
}

/** Returns an error message when `path` is a directory, or undefined. */
function directoryError(path: string): string | undefined {
  return statSync(path).isDirectory() ? `${path} is a directory, not a file` : undefined;
}

/**
 * Returns true when `path` is outside `folder`. The source file of a manifest must be in the
 * parent folder of the chunk folder, or below it, unless the user confirms another place.
 */
function isOutside(folder: string, path: string): boolean {
  const rel = relative(folder, path);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/** Returns the error text for a source file outside the parent folder of the chunk folder. */
function outsideError(sourcePath: string, chunksDir: string, remedy: string): string {
  return `Error: the source file ${sourcePath} is outside ${dirname(chunksDir)}, the parent folder of the chunk folder. ${remedy}\n`;
}

/** A line writer on top of `io.stdout`, in the style of `console.log`. */
function lineWriter(io: Io): (text?: string) => void {
  return (text = "") => io.stdout(`${text}\n`);
}

function splitSections(fileType: FileType, content: string, level: number): JsonSplit {
  switch (fileType) {
    case "json":
      return splitJson(content);
    case "typescript":
      return { sections: splitTypeScript(content) };
    default:
      return { sections: splitMarkdown(content, level) };
  }
}

function levelIndicator(fileType: FileType, level: number): string {
  if (fileType === "markdown") return level > 0 ? `h${level}` : "pre";
  return ["meta", "decl", "type"][level] ?? "meth";
}

function split(inputFile: string, options: Options, io: Io): number {
  const log = lineWriter(io);
  const maxLines = options.maxLines ?? 500;
  const dryRun = options.dryRun ?? false;
  const absoluteInput = resolve(inputFile);
  if (!existsSync(absoluteInput)) {
    io.stderr(`Error: File not found: ${absoluteInput}\n`);
    return 1;
  }
  const inputError = directoryError(absoluteInput);
  if (inputError) {
    io.stderr(`Error: ${inputError}\n`);
    return 1;
  }
  const fileType: FileType =
    options.type && options.type !== "auto"
      ? (options.type as FileType)
      : detectFileType(absoluteInput);
  const splitLevel = options.level ?? (fileType === "markdown" ? 2 : 1);
  const content = readFileSync(absoluteInput, "utf8");
  const sourceHash = contentHash(content);
  const baseName = basename(inputFile, extname(inputFile));
  const outputDir = options.output
    ? resolve(options.output)
    : join(dirname(absoluteInput), `${baseName}_chunks`);

  log("\nchunker - Splitting File");
  log("=".repeat(50));
  log(`Source:      ${absoluteInput}`);
  log(`Output:      ${outputDir}`);
  log(`File Type:   ${fileType}`);
  if (fileType === "markdown") log(`Split Level: h${splitLevel} (${"#".repeat(splitLevel)})`);
  log(`Max Lines:   ${maxLines}`);
  log(`Dry Run:     ${dryRun}`);
  log();

  const lineEnding = detectLineEnding(content);
  if (lineEnding === "mixed") {
    log("WARNING: the file has mixed line endings. The chunks and a merge use LF.\n");
  }
  const { sections, layout } = splitSections(fileType, content, splitLevel);
  if (sections.length === 0) {
    log("No sections found to split.");
    return 0;
  }
  log(`Found ${sections.length} section(s):\n`);

  const chunks: ChunkInfo[] = sections.map((section, i) => {
    const filename = chunkFilename(section.title, i + 1, fileType);
    const lineCount = section.content.split("\n").length;
    const large = lineCount > maxLines ? " ⚠️  [LARGE]" : "";
    log(
      `  ${String(i + 1).padStart(2)}. [${levelIndicator(fileType, section.level).padEnd(4)}] ${section.title.substring(0, 40).padEnd(40)} ${String(lineCount).padStart(4)} lines${large}`,
    );
    // Section content has LF line endings only, so writeLf keeps its bytes.
    if (!dryRun) writeLf(join(outputDir, filename), section.content);
    return {
      index: i + 1,
      filename,
      title: section.title,
      level: section.level,
      startLine: section.startLine,
      endLine: section.endLine,
      lineCount,
      hash: contentHash(section.content),
      modified: false,
    };
  });

  const manifest: Manifest = {
    version: MANIFEST_VERSION,
    sourceFile: relativeSource(outputDir, absoluteInput),
    sourceHash,
    fileType,
    splitLevel,
    chunks,
    ...(layout ? { jsonLayout: layout } : {}),
    ...(lineEnding === "crlf" ? { lineEnding } : {}),
  };
  const manifestPath = join(outputDir, MANIFEST_NAME);
  if (!dryRun) {
    writeManifest(manifestPath, manifest);
    log(`\nManifest written: ${manifestPath}`);
  }

  const totalLines = chunks.reduce((sum, c) => sum + c.lineCount, 0);
  const largeChunks = chunks.filter((c) => c.lineCount > maxLines).length;
  log("\nSummary:");
  log(`  Total chunks:  ${chunks.length}`);
  log(`  Total lines:   ${totalLines}`);
  if (largeChunks > 0) log(`  Large chunks:  ${largeChunks} (>${maxLines} lines)`);
  if (dryRun) {
    log("\n[DRY RUN] No files were written.");
  } else {
    log(`\nChunks written to: ${outputDir}`);
    log("\nTo edit: Modify individual chunk files in the directory");
    log(`To merge: repo-tools chunk merge "${manifestPath}"`);
  }
  return 0;
}

function merge(manifestFile: string, options: Options, io: Io): number {
  const log = lineWriter(io);
  const dryRun = options.dryRun ?? false;
  const absoluteManifest = resolve(manifestFile);
  if (!existsSync(absoluteManifest)) {
    io.stderr(`Error: Manifest not found: ${absoluteManifest}\n`);
    return 1;
  }
  const manifestError = directoryError(absoluteManifest);
  if (manifestError) {
    io.stderr(`Error: ${manifestError}\n`);
    return 1;
  }
  const manifest = readManifest(absoluteManifest);
  const chunksDir = dirname(absoluteManifest);
  const sourcePath = resolveSource(chunksDir, manifest.sourceFile);
  const outside = isOutside(dirname(chunksDir), sourcePath);
  if (outside && !options.output && !options.yes) {
    io.stderr(
      outsideError(sourcePath, chunksDir, "Use -o <file> to name the target, or --yes to confirm."),
    );
    return 1;
  }
  // Without --yes, merge does not read a source file outside the parent folder.
  const readSource = !outside || options.yes === true;
  const hash = hashFor(manifest);
  const fileType = manifest.fileType || "markdown";

  log("\nchunker - Merging Chunks");
  log("=".repeat(50));
  log(`Manifest:    ${absoluteManifest}`);
  log(`Source:      ${sourcePath}`);
  log(`File Type:   ${fileType}`);
  if (manifest.createdAt !== undefined) log(`Created:     ${manifest.createdAt}`);
  log(`Chunks:      ${manifest.chunks.length}`);
  log();

  const chunkContents: string[] = [];
  let modifiedCount = 0;
  for (const chunk of manifest.chunks) {
    const chunkPath = join(chunksDir, chunk.filename);
    if (!existsSync(chunkPath)) {
      io.stderr(`Error: Missing chunk file: ${chunkPath}\n`);
      return 1;
    }
    const content = readFileSync(chunkPath, "utf8");
    const modified = hash(content) !== chunk.hash;
    if (modified) modifiedCount++;
    log(
      `  ${String(chunk.index).padStart(2)}. ${chunk.filename.padEnd(45)} ${modified ? "[MODIFIED]" : "[unchanged]"}`,
    );
    chunkContents.push(content);
  }
  log(`\nModified chunks: ${modifiedCount} of ${manifest.chunks.length}`);

  // A JSON array or invalid JSON is one whole-file chunk of level 0 (`_array`, `_invalid_json`).
  // Its text is the file text, so merge keeps it as it is (fix K7).
  const keyChunks = fileType === "json" && !manifest.chunks.every((c) => c.level === 0);
  // A JSON object split by this build has a layout and merges by text (fix K8). An older
  // manifest has no layout and merges by object.
  let mergedContent: string;
  if (!keyChunks) {
    mergedContent = chunkContents.join("\n");
  } else if (manifest.jsonLayout) {
    mergedContent = mergeJsonLayout(chunkContents, manifest.jsonLayout);
  } else {
    mergedContent = mergeJson(chunkContents, io.stderr);
  }
  // Split writes LF chunks; a CRLF source gets its CRLF line breaks again (item c).
  if (manifest.lineEnding === "crlf") {
    mergedContent = normalizeLineEndings(mergedContent).replace(/\n/g, "\r\n");
  }
  const outputPath = options.output ? resolve(options.output) : sourcePath;

  if (readSource && existsSync(sourcePath)) {
    const currentSourceHash = hash(readFileSync(sourcePath, "utf8"));
    if (currentSourceHash !== manifest.sourceHash) {
      log("\nWARNING: Source file has changed since split!");
      log(`  Original hash: ${manifest.sourceHash}`);
      log(`  Current hash:  ${currentSourceHash}`);
      if (!options.output)
        log("\nUse --output to write to a different file, or confirm overwrite.");
    }
  }

  // No smaller or empty result over a non-empty file without --allow-shrink (fix K7). A merge
  // that loses text is more often a defect than an edit, and the loss is silent.
  const newSize = Buffer.byteLength(mergedContent, "utf8");
  const oldSize = existsSync(outputPath) ? statSync(outputPath).size : 0;
  if (newSize < oldSize && !options.allowShrink) {
    io.stderr(
      `Error: the merged result (${newSize} bytes) is smaller than ${outputPath} (${oldSize} bytes). Nothing was written. Use --allow-shrink to write it.\n`,
    );
    return 1;
  }

  const lineCount = mergedContent.split("\n").length;
  if (dryRun) {
    log(`\n[DRY RUN] Would write ${lineCount} lines to: ${outputPath}`);
    return 0;
  }
  if (existsSync(outputPath)) {
    const backupPath = `${outputPath}.backup-${Date.now()}`;
    copyFileSync(outputPath, backupPath);
    log(`\nBackup created: ${backupPath}`);
  }
  // A plain write keeps the bytes of the chunk files exactly, as the user edited them.
  writeFileSync(outputPath, mergedContent);
  log(`\nMerged file written: ${outputPath}`);
  log(`Total lines: ${lineCount}`);
  return 0;
}

function status(manifestFile: string, options: Options, io: Io): number {
  const log = lineWriter(io);
  const absoluteManifest = resolve(manifestFile);
  if (!existsSync(absoluteManifest)) {
    io.stderr(`Error: Manifest not found: ${absoluteManifest}\n`);
    return 1;
  }
  const manifestError = directoryError(absoluteManifest);
  if (manifestError) {
    io.stderr(`Error: ${manifestError}\n`);
    return 1;
  }
  const manifest = readManifest(absoluteManifest);
  const chunksDir = dirname(absoluteManifest);
  const sourcePath = resolveSource(chunksDir, manifest.sourceFile);
  if (isOutside(dirname(chunksDir), sourcePath) && !options.yes) {
    io.stderr(outsideError(sourcePath, chunksDir, "Use --yes to read it."));
    return 1;
  }
  const hash = hashFor(manifest);
  const fileType = manifest.fileType || "markdown";

  log("\nchunker - Chunk Status");
  log("=".repeat(50));
  log(`Source:    ${sourcePath}`);
  log(`File Type: ${fileType}`);
  if (manifest.createdAt !== undefined) log(`Created:   ${manifest.createdAt}`);
  if (fileType === "markdown") log(`Level:     h${manifest.splitLevel}`);
  log();

  let modifiedCount = 0;
  let missingCount = 0;
  let totalLines = 0;
  log("Chunks:\n");
  log("  #   Filename                                      Lines   Status");
  log(`  ${"─".repeat(70)}`);

  for (const chunk of manifest.chunks) {
    const chunkPath = join(chunksDir, chunk.filename);
    let state: string;
    let lines = chunk.lineCount;
    if (!existsSync(chunkPath)) {
      state = "MISSING";
      missingCount++;
    } else {
      const content = readFileSync(chunkPath, "utf8");
      lines = content.split("\n").length;
      if (hash(content) !== chunk.hash) {
        state = "MODIFIED";
        modifiedCount++;
      } else {
        state = "unchanged";
      }
    }
    totalLines += lines;
    const color = state === "MODIFIED" ? "\x1b[33m" : state === "MISSING" ? "\x1b[31m" : "\x1b[90m";
    log(
      `  ${String(chunk.index).padStart(2)}  ${chunk.filename.padEnd(45)} ${String(lines).padStart(5)}   ${color}${state}\x1b[0m`,
    );
  }

  log();
  log("Summary:");
  log(`  Total chunks:    ${manifest.chunks.length}`);
  log(`  Modified:        ${modifiedCount}`);
  log(`  Missing:         ${missingCount}`);
  log(`  Total lines:     ${totalLines}`);
  if (existsSync(sourcePath)) {
    if (hash(readFileSync(sourcePath, "utf8")) !== manifest.sourceHash) {
      log("\n\x1b[33mWARNING: Source file modified since split!\x1b[0m");
    }
  }
  return 0;
}

/**
 * Runs `repo-tools chunk` and returns the exit code.
 *
 * @param argv - The arguments after `chunk`: the action, the target and the flags.
 * @param io - Where to write normal output and error output.
 */
export async function run(argv: string[], io: Io): Promise<number> {
  const [action, ...rest] = argv;
  if (action === undefined || action === "help") {
    io.stdout(CHUNK_HELP);
    return 0;
  }
  if (action !== "split" && action !== "merge" && action !== "status") {
    io.stderr(`Unknown command: ${action}\n\n${CHUNK_HELP}`);
    return 1;
  }
  const parsed = parseArgs(action, rest);
  if (parsed.error !== undefined) {
    io.stderr(`Error: ${parsed.error}\n`);
    return 1;
  }
  const { target = "", options } = parsed;
  const optionError = invalidOption(options);
  if (optionError) {
    io.stderr(`Error: ${optionError}\n`);
    return 1;
  }
  try {
    switch (action) {
      case "split":
        if (!target) {
          io.stderr("Error: Please specify a file to split\n");
          io.stderr("Usage: repo-tools chunk split <file> [options]\n");
          return 1;
        }
        return split(target, options, io);
      case "merge":
        if (!target) {
          io.stderr("Error: Please specify a manifest.json file\n");
          io.stderr("Usage: repo-tools chunk merge <manifest.json> [options]\n");
          return 1;
        }
        return merge(target, options, io);
      default: // "status"
        if (!target) {
          io.stderr("Error: Please specify a manifest.json file\n");
          io.stderr("Usage: repo-tools chunk status <manifest.json>\n");
          return 1;
        }
        return status(target, options, io);
    }
  } catch (error) {
    io.stderr(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
