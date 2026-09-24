/**
 * `repo-tools chunk` (design sections 3.3 and 4): split a large file into chunk files, merge
 * the chunks back, or show which chunks changed.
 *
 * Output goes to `io`. Errors return exit code 1; this module never ends the process.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { writeLf } from "../io.ts";
import type { Io } from "../io-types.ts";
import {
  type ChunkInfo,
  contentHash,
  type FileType,
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
  mergeJson,
  type Section,
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
  --dry-run              Show the result and write no files

File types:
  Markdown (.md, .markdown)          Splits at headings of level 1 to <n>.
  JSON (.json)                       Splits at the top-level keys of an object.
  TypeScript, JavaScript (.ts, .js)  Splits at top-level declarations.
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
}

/** Parses the flags after the action and the target, as the original chunker does. */
function parseOptions(args: string[]): Options {
  const options: Options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-o" || arg === "--output") {
      options.output = args[++i];
    } else if (arg === "-l" || arg === "--level") {
      options.level = Number.parseInt(args[++i] ?? "", 10);
    } else if (arg === "-m" || arg === "--max-lines") {
      options.maxLines = Number.parseInt(args[++i] ?? "", 10);
    } else if (arg === "-t" || arg === "--type") {
      options.type = args[++i];
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    }
  }
  return options;
}

/** A line writer on top of `io.stdout`, in the style of `console.log`. */
function lineWriter(io: Io): (text?: string) => void {
  return (text = "") => io.stdout(`${text}\n`);
}

function splitSections(fileType: FileType, content: string, level: number): Section[] {
  switch (fileType) {
    case "json":
      return splitJson(content);
    case "typescript":
      return splitTypeScript(content);
    default:
      return splitMarkdown(content, level);
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

  const sections = splitSections(fileType, content, splitLevel);
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
    createdAt: new Date().toISOString(),
    fileType,
    splitLevel,
    chunks,
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
    log(`To merge: chunker merge "${manifestPath}"`);
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
  const manifest = readManifest(absoluteManifest);
  const chunksDir = dirname(absoluteManifest);
  const sourcePath = resolveSource(chunksDir, manifest.sourceFile);
  const fileType = manifest.fileType || "markdown";

  log("\nchunker - Merging Chunks");
  log("=".repeat(50));
  log(`Manifest:    ${absoluteManifest}`);
  log(`Source:      ${sourcePath}`);
  log(`File Type:   ${fileType}`);
  log(`Created:     ${manifest.createdAt}`);
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
    const modified = contentHash(content) !== chunk.hash;
    if (modified) modifiedCount++;
    log(
      `  ${String(chunk.index).padStart(2)}. ${chunk.filename.padEnd(45)} ${modified ? "[MODIFIED]" : "[unchanged]"}`,
    );
    chunkContents.push(content);
  }
  log(`\nModified chunks: ${modifiedCount} of ${manifest.chunks.length}`);

  const mergedContent =
    fileType === "json" ? mergeJson(chunkContents, io.stderr) : chunkContents.join("\n");
  const outputPath = options.output ? resolve(options.output) : sourcePath;

  if (existsSync(sourcePath)) {
    const currentSourceHash = contentHash(readFileSync(sourcePath, "utf8"));
    if (currentSourceHash !== manifest.sourceHash) {
      log("\nWARNING: Source file has changed since split!");
      log(`  Original hash: ${manifest.sourceHash}`);
      log(`  Current hash:  ${currentSourceHash}`);
      if (!options.output)
        log("\nUse --output to write to a different file, or confirm overwrite.");
    }
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

function status(manifestFile: string, io: Io): number {
  const log = lineWriter(io);
  const absoluteManifest = resolve(manifestFile);
  if (!existsSync(absoluteManifest)) {
    io.stderr(`Error: Manifest not found: ${absoluteManifest}\n`);
    return 1;
  }
  const manifest = readManifest(absoluteManifest);
  const chunksDir = dirname(absoluteManifest);
  const sourcePath = resolveSource(chunksDir, manifest.sourceFile);
  const fileType = manifest.fileType || "markdown";

  log("\nchunker - Chunk Status");
  log("=".repeat(50));
  log(`Source:    ${sourcePath}`);
  log(`File Type: ${fileType}`);
  log(`Created:   ${manifest.createdAt}`);
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
      if (contentHash(content) !== chunk.hash) {
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
    if (contentHash(readFileSync(sourcePath, "utf8")) !== manifest.sourceHash) {
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
  const [action, target = "", ...flags] = argv;
  if (action === undefined || action === "help") {
    io.stdout(CHUNK_HELP);
    return 0;
  }
  const options = parseOptions(flags);
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
      case "status":
        if (!target) {
          io.stderr("Error: Please specify a manifest.json file\n");
          io.stderr("Usage: repo-tools chunk status <manifest.json>\n");
          return 1;
        }
        return status(target, io);
      default:
        io.stderr(`Unknown command: ${action}\n\n${CHUNK_HELP}`);
        return 1;
    }
  } catch (error) {
    io.stderr(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
