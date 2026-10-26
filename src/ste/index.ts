/**
 * `repo-tools ste`: check Markdown documents, or docstring prose, against the mechanically
 * decidable part of ASD-STE100 Simplified Technical English.
 *
 * The Markdown mode is a gate (exit 1 on a finding). The `--prose` mode is advice (exit 0 with
 * findings). Both modes use one rule module (`rules.ts`).
 */
import { type Dirent, existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Io } from "../io-types.ts";
import { compareCodeUnits } from "../sort.ts";
import { checkMarkdownFindings } from "./markdown.ts";
import { checkProse, proseOf } from "./prose.ts";
import { addedLinesSince, SinceError, touchesAdded } from "./since.ts";

/** The help text of `repo-tools ste`. */
export const STE_HELP = `Usage: repo-tools ste <file-or-directory> [...] [--require=<path>] [--since=<rev>]
       repo-tools ste --prose <file>

Check prose against the mechanically decidable part of ASD-STE100 Simplified
Technical English: sentence length, wordy forms, ambiguous references (a
demonstrative with no noun) and the passive voice with an agent. The checker
cannot judge the approved dictionary.

Markdown mode (the default) checks each Markdown file, or each .md file below a
directory, in code-unit order of the path. A descriptive sentence may have 25
words; a procedural one (a numbered step or a check box) may have 20. Code
fences, tables, headings, quotes, comments, frontmatter, inline code and
identifiers are not checked. A file whose first five lines hold
"<!-- ste:historical-record -->" is skipped, and the skip is counted.

  --require=<path>  The file must exist, and the run must examine it. Repeat the
                  option for more files. A document that someone deletes inside
                  a folder gives no finding, so this option makes the deletion
                  an error. A file that the run skips as a historical record
                  counts as examined.
  --since=<rev>   Report only the findings on the lines that the working tree
                  adds or changes since the git revision <rev> (committed,
                  staged and unstaged edits). A sentence-length finding counts
                  when any line of its paragraph changed. A file that is not in
                  <rev> counts in full. The totals line gives the number of
                  older findings that the option hides.
  --prose <file>  Check the file as one docstring. Tag lines (@param), section
                  headers, doctest lines and code fences are removed first. Each
                  finding prints as "RULE<TAB>detail". The findings are advice:
                  the exit code is 0.
  --help, -h      Show this help.

Exit codes: 0 when no finding (Markdown mode) or always (--prose mode). 1 when a
Markdown finding exists. 2 on a usage error, when a path does not exist, when no
Markdown file was examined, when a required file does not exist or was not
examined, when --since cannot use the revision or the work tree, or when a file
is not UTF-8.
`;

/** The marker that opts a dated record out of the check. */
export const HISTORICAL_MARKER = "<!-- ste:historical-record -->";

/** Reads `path` as UTF-8 text with universal line ends, as Python's `read_text` does. */
function readText(path: string): string {
  const bytes = readFileSync(path);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return text.replace(/\r\n?/g, "\n");
}

/** Compares two paths part by part, in code-unit order. */
function comparePaths(a: string[], b: string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = compareCodeUnits(a[i] as string, b[i] as string);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

/**
 * The Markdown files to check for `path`: the file itself, or every `.md` file below a
 * directory. A folder named `.pytest_cache` is skipped, and a linked folder is not followed.
 */
function targetsFor(path: string): string[] {
  if (existsSync(path) && statSync(path).isFile()) return [path];
  const found: string[][] = [];
  const walk = (dir: string, parts: string[]): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== ".pytest_cache") walk(full, [...parts, entry.name]);
      } else if (entry.name.endsWith(".md")) {
        const isFile = entry.isFile() || (entry.isSymbolicLink() && statSync(full).isFile());
        if (isFile) found.push([...parts, entry.name]);
      }
    }
  };
  if (existsSync(path) && lstatSync(path).isDirectory()) walk(path, []);
  return found.sort(comparePaths).map((parts) => join(path, ...parts));
}

/** True when one of the first five lines of `path` is the historical-record marker. */
function isHistoricalRecord(path: string): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8").decode(readFileSync(path));
  } catch {
    return false;
  }
  return text
    .split(/\r\n|\r|\n/)
    .slice(0, 5)
    .some((line) => line.trim() === HISTORICAL_MARKER);
}

/** `--prose <file>`: prints each advisory finding of one docstring. */
function runProse(args: string[], io: Io): number {
  const [file, ...extra] = args;
  if (file === undefined || extra.length > 0) {
    io.stderr("repo-tools ste: --prose needs exactly one file\n");
    return 2;
  }
  let text: string;
  try {
    text = readText(file);
  } catch {
    io.stderr(`repo-tools ste: cannot read ${basename(file)} as UTF-8 text\n`);
    return 2;
  }
  for (const [rule, detail] of checkProse(proseOf(text))) io.stdout(`${rule}\t${detail}\n`);
  return 0;
}

/** The paths and the options of the Markdown mode. */
interface MarkdownArgs {
  paths: string[];
  required: string[];
  since: string | null;
}

/** Splits `argv` into paths and options. Returns a message when an option has no usable value. */
function parseMarkdownArgs(argv: string[]): MarkdownArgs | string {
  const args: MarkdownArgs = { paths: [], required: [], since: null };
  for (const arg of argv) {
    if (arg === "--require" || arg.startsWith("--require=")) {
      const value = arg.slice("--require=".length);
      if (arg === "--require" || value === "") return "--require needs a path (--require=<path>)";
      args.required.push(value);
    } else if (arg === "--since" || arg.startsWith("--since=")) {
      const value = arg.slice("--since=".length);
      // A value that starts with a dash would be an option of git, not a revision.
      if (arg === "--since" || value === "" || value.startsWith("-")) {
        return "--since needs a revision (--since=<rev>)";
      }
      args.since = value;
    } else {
      args.paths.push(arg);
    }
  }
  return args;
}

/** The key that compares two paths: absolute, and without case on Windows. */
function pathKey(path: string): string {
  const full = resolve(path);
  return process.platform === "win32" ? full.toLowerCase() : full;
}

/** Runs `repo-tools ste` and returns the exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  if (argv[0] === "--prose") return runProse(argv.slice(1), io);
  const parsed = parseMarkdownArgs(argv);
  if (typeof parsed === "string") {
    io.stderr(`repo-tools ste: ${parsed}\n`);
    return 2;
  }
  const { paths, required, since } = parsed;
  if (paths.length === 0) {
    io.stdout("usage: repo-tools ste <file-or-directory> [...]\n");
    return 2;
  }
  let total = 0;
  let checked = 0;
  let skipped = 0;
  let hidden = 0;
  const missing: string[] = [];
  const examined = new Set<string>();
  for (const arg of paths) {
    if (!existsSync(arg)) missing.push(arg);
    for (const target of targetsFor(arg)) {
      const name = basename(target);
      examined.add(pathKey(target));
      if (isHistoricalRecord(target)) {
        skipped += 1;
        io.stdout(`\n=== ${name}: SKIPPED (historical record) ===\n`);
        continue;
      }
      let text: string;
      try {
        text = readText(target);
      } catch {
        io.stderr(`repo-tools ste: cannot read ${name} as UTF-8 text\n`);
        return 2;
      }
      let findings = checkMarkdownFindings(name, text);
      if (since !== null) {
        try {
          const added = addedLinesSince(target, since);
          const shown = findings.filter((f) => touchesAdded(added, f.first, f.last));
          hidden += findings.length - shown.length;
          findings = shown;
        } catch (error) {
          if (!(error instanceof SinceError)) throw error;
          io.stderr(`repo-tools ste: ${error.message}\n`);
          return 2;
        }
      }
      checked += 1;
      total += findings.length;
      const status = findings.length === 0 ? "OK" : `${findings.length} problem(s)`;
      io.stdout(`\n=== ${name}: ${status} ===\n`);
      for (const f of findings) io.stdout(`  ${f.text}\n`);
    }
  }
  const notes: string[] = [];
  if (skipped > 0) notes.push(`${skipped} skipped as historical record(s)`);
  if (since !== null && hidden > 0) {
    notes.push(`${hidden} older finding(s) hidden by --since=${since}`);
  }
  const tail = notes.length > 0 ? `; ${notes.join("; ")}` : "";
  io.stdout(`\nTOTAL: ${total} problem(s) in ${checked} file(s)${tail}\n`);
  // A mistyped path must not look like a clean run, even when other paths were checked.
  for (const path of missing) io.stderr(`ERROR: path does not exist: ${path}\n`);
  // A required file is a promise that the gate covers it. A deleted file, or a file outside the
  // paths of the run, breaks the promise.
  let requiredFailed = false;
  for (const path of required) {
    if (!existsSync(path) || !statSync(path).isFile()) {
      io.stderr(`ERROR: required file does not exist: ${path}\n`);
      requiredFailed = true;
    } else if (!examined.has(pathKey(path))) {
      io.stderr(`ERROR: required file was not examined: ${path}\n`);
      requiredFailed = true;
    }
  }
  // Checking nothing is not passing: a mistyped path must not look like a clean run.
  if (checked === 0) {
    io.stderr(
      "ERROR: no Markdown file was examined. This is a failure, not a clean result -- check the path(s) given.\n",
    );
  }
  if (missing.length > 0 || checked === 0 || requiredFailed) return 2;
  return total > 0 ? 1 : 0;
}
