/**
 * The check for dangling references to `docs/design.md`.
 *
 *   bun scripts/design-refs.ts
 *
 * A comment, a test title or a workflow can name a part of the design by its number: the word
 * `design`, an optional `section`, and a number such as `4` or `4.2`. The check finds each such
 * reference in the files of the repository and looks for a heading of `docs/design.md` with that
 * number. A reference with no heading is dangling. The script prints each one and exits 1.
 *
 * The check proves that the number exists. It cannot prove that the heading means what the
 * reference says: a reference to an existing but wrong section passes.
 *
 * A reference is the word `design`, then an optional `section`, then `N` or `N.M`. A list
 * (`11.3, 11.4`), a range (`11.1-11.3`) and `and` join more subsection numbers, and each number in
 * the list must have a dot. A number after the words `step` or `steps` is not a section. A
 * reference that a line break splits is not found. `CHANGELOG.md` and `todo.md` record history
 * and are not read.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One reference to a part of the design document. */
export interface DesignReference {
  /** The path of the file, with `/` separators. */
  file: string;
  /** The line number, from 1. */
  line: number;
  /** The section number, for example `11.4` or `15`. */
  section: string;
}

/** A file of the repository, as a path and its text. */
export interface SourceFile {
  path: string;
  text: string;
}

/** The files that record history; their old references stay as they were written. */
const HISTORY_FILES = new Set(["CHANGELOG.md", "todo.md"]);

/** The extensions of the files that can hold a comment, a title or a workflow. */
const TEXT_EXTENSIONS = /\.(?:ts|tsx|mjs|js|yml|yaml|md|txt)$/;

/** The word `design`, an optional `section`, a number, and the dotted numbers that follow it. */
const REFERENCE =
  /\bdesign(?:\s+sections?)?\s+(\d+(?:\.\d+)?)(?![\d.]*\d)((?:\s*(?:,|-|–|and|to)\s*\d+\.\d+(?![\d.]*\d))*)/gi;

/** Returns the section numbers that the headings of a design document define. */
export function headingsOf(markdown: string): Set<string> {
  const numbers = new Set<string>();
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^#{2,6}\s+(\d+(?:\.\d+)*)\.?(?:\s|$)/.exec(line);
    if (m?.[1]) numbers.add(m[1]);
  }
  return numbers;
}

/** Returns each reference to the design in a text, with its line number. */
export function findReferences(text: string): Array<{ line: number; section: string }> {
  const found: Array<{ line: number; section: string }> = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const m of (lines[i] ?? "").matchAll(REFERENCE)) {
      found.push({ line: i + 1, section: m[1] ?? "" });
      for (const more of (m[2] ?? "").matchAll(/\d+\.\d+/g)) {
        found.push({ line: i + 1, section: more[0] });
      }
    }
  }
  return found;
}

/** Returns the references of the given files that no heading of the design document defines. */
export function danglingReferences(files: SourceFile[], headings: Set<string>): DesignReference[] {
  const dangling: DesignReference[] = [];
  for (const file of files) {
    if (HISTORY_FILES.has(file.path) || !TEXT_EXTENSIONS.test(file.path)) continue;
    for (const ref of findReferences(file.text)) {
      if (!headings.has(ref.section)) dangling.push({ file: file.path, ...ref });
    }
  }
  return dangling;
}

/** Lists the files that git tracks, and the files that it does not ignore, below a root. */
function repositoryFiles(root: string): SourceFile[] {
  const run = Bun.spawnSync(
    ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root },
  );
  if (run.exitCode !== 0) throw new Error(`git ls-files failed: ${run.stderr.toString().trim()}`);
  const paths = [...new Set(run.stdout.toString().split("\0").filter(Boolean))].sort();
  const files: SourceFile[] = [];
  for (const path of paths) {
    if (!TEXT_EXTENSIONS.test(path)) continue;
    try {
      files.push({ path, text: readFileSync(join(root, path), "utf8") });
    } catch (error) {
      // A tracked file that was deleted in the work tree has nothing to scan. Any other error
      // would hide a file from the check, so it stops the run.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return files;
}

/** Scans a repository. Returns the dangling references of its files against `docs/design.md`. */
export function scanRepository(root: string): DesignReference[] {
  const headings = headingsOf(readFileSync(join(root, "docs/design.md"), "utf8"));
  return danglingReferences(repositoryFiles(root), headings);
}

/** The command: prints each dangling reference and returns the exit code. */
export function main(argv: string[]): number {
  const root = argv[0] ?? process.cwd();
  const dangling = scanRepository(root);
  for (const ref of dangling) {
    console.log(`${ref.file}:${ref.line}: design ${ref.section} has no heading in docs/design.md`);
  }
  console.log(`design references: ${dangling.length} dangling`);
  return dangling.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
