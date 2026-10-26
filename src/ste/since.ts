/**
 * `repo-tools ste --since=<rev>`: the lines of a file that the working tree adds or changes since
 * a git revision.
 *
 * The answer comes from `git diff -U0 <rev>`, so it counts the committed, the staged and the
 * unstaged edits together. A file that does not exist at the revision is new: every line counts.
 */
import { spawnSync } from "node:child_process";
import { basename, dirname, resolve } from "node:path";

/** The time that one git call may take. The other git calls of the tool use the same limit. */
const GIT_TIMEOUT_MS = 60_000;

/**
 * The edits of one file since the revision: `"all"` for a new file. Else `ranges` holds the added
 * and changed lines as inclusive `[first, last]` pairs, and `cuts` holds each pure deletion as the
 * number of the line that now comes before the removed text.
 */
export type AddedLines =
  | "all"
  | {
      ranges: ReadonlyArray<readonly [first: number, last: number]>;
      cuts: readonly number[];
    };

/** A problem with the revision or the work tree. Its message is ready to print. */
export class SinceError extends Error {}

/** Runs git in `dir`. */
function git(dir: string, args: string[]) {
  return spawnSync("git", ["-C", dir, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 1 << 28,
  });
}

/** The folders that passed the work-tree and revision check, with the revision of each. */
const checked = new Set<string>();

/** Throws a `SinceError` unless `dir` is in a git work tree that knows the commit `rev`. */
function checkRevision(dir: string, rev: string): void {
  const key = `${dir}\0${rev}`;
  if (checked.has(key)) return;
  const tree = git(dir, ["rev-parse", "--is-inside-work-tree"]);
  if (tree.error)
    throw new SinceError(`--since needs git, and git cannot run: ${tree.error.message}`);
  if (tree.status !== 0) throw new SinceError(`--since needs a git work tree: ${dir}`);
  const commit = git(dir, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
  if (commit.status !== 0) throw new SinceError(`cannot resolve revision '${rev}' in ${dir}`);
  checked.add(key);
}

/** The hunk header of a zero-context diff: the first line and the line count of the new side. */
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gmu;

/**
 * The lines of `file` that the working tree adds or changes since the commit `rev`.
 *
 * @throws SinceError when `file` is not in a git work tree or `rev` is not a commit there.
 */
export function addedLinesSince(file: string, rev: string): AddedLines {
  const full = resolve(file);
  const dir = dirname(full);
  const name = basename(full);
  checkRevision(dir, rev);
  // `rev:./name` names the file relative to `dir`, so a file below a subfolder needs no prefix.
  if (git(dir, ["cat-file", "-e", `${rev}:./${name}`]).status !== 0) return "all";
  const diff = git(dir, ["diff", "-U0", "--no-color", "--no-ext-diff", rev, "--", name]);
  if (diff.status !== 0) {
    throw new SinceError(`git diff failed for ${name}: ${diff.stderr.toString().trim()}`);
  }
  const ranges: [number, number][] = [];
  const cuts: number[] = [];
  for (const m of diff.stdout.toString().matchAll(HUNK)) {
    const first = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    // A count of 0 is a pure deletion: the new side has no line there, and `first` is the line
    // before the removed text.
    if (count > 0) ranges.push([first, first + count - 1]);
    else cuts.push(first);
  }
  return { ranges, cuts };
}

/**
 * True when the lines `first` to `last` include an added line, or when a deletion cut through
 * them. A deletion between two paragraphs touches neither. A deletion inside a paragraph touches
 * it, because the rest of the text can now read as longer sentences.
 */
export function touchesAdded(added: AddedLines, first: number, last: number): boolean {
  if (added === "all") return true;
  if (added.ranges.some(([from, to]) => from <= last && first <= to)) return true;
  return added.cuts.some((line) => first <= line && line + 1 <= last);
}
