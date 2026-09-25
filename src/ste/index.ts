/**
 * `repo-tools ste`: check Markdown documents, or docstring prose, against the mechanically
 * decidable part of ASD-STE100 Simplified Technical English.
 *
 * The Markdown mode is a gate (exit 1 on a finding). The `--prose` mode is advice (exit 0 with
 * findings). Both modes use one rule module (`rules.ts`).
 */
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Io } from "../io-types.ts";
import { compareCodeUnits } from "../sort.ts";
import { checkMarkdown } from "./markdown.ts";
import { checkProse, proseOf } from "./prose.ts";

/** The help text of `repo-tools ste`. */
export const STE_HELP = `Usage: repo-tools ste <file-or-directory> [...]
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

  --prose <file>  Check the file as one docstring. Tag lines (@param), section
                  headers, doctest lines and code fences are removed first. Each
                  finding prints as "RULE<TAB>detail". The findings are advice:
                  the exit code is 0.
  --help, -h      Show this help.

Exit codes: 0 when no finding (Markdown mode) or always (--prose mode). 1 when a
Markdown finding exists. 2 on a usage error, when no Markdown file was examined,
or when a file is not UTF-8.
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
    let entries: import("node:fs").Dirent[];
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

/** Runs `repo-tools ste` and returns the exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  if (argv[0] === "--prose") return runProse(argv.slice(1), io);
  if (argv.length === 0) {
    io.stdout("usage: repo-tools ste <file-or-directory> [...]\n");
    return 2;
  }
  let total = 0;
  let checked = 0;
  let skipped = 0;
  for (const arg of argv) {
    for (const target of targetsFor(arg)) {
      const name = basename(target);
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
      const problems = checkMarkdown(name, text);
      checked += 1;
      total += problems.length;
      const status = problems.length === 0 ? "OK" : `${problems.length} problem(s)`;
      io.stdout(`\n=== ${name}: ${status} ===\n`);
      for (const p of problems) io.stdout(`  ${p}\n`);
    }
  }
  const tail = skipped > 0 ? `; ${skipped} skipped as historical record(s)` : "";
  io.stdout(`\nTOTAL: ${total} problem(s) in ${checked} file(s)${tail}\n`);
  // Checking nothing is not passing: a mistyped path must not look like a clean run.
  if (checked === 0) {
    io.stderr(
      "ERROR: no Markdown file was examined. This is a failure, not a clean result -- check the path(s) given.\n",
    );
    return 2;
  }
  return total > 0 ? 1 : 0;
}
