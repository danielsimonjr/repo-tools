/**
 * The fix-ledger audit. For each fix of `docs/fix-ledger-2.0.0.md` that a test locks, the audit
 * restores the 1.x defect in a scratch copy of the repository (one hand-written mutation in
 * `scripts/fix-ledger-mutations.ts`), runs the tests, and records whether any test fails.
 *
 *   bun run audit:ledger                       audit every fix
 *   bun run audit:ledger -- --only F22,M1      audit some fixes
 *   bun run audit:ledger -- --check            check that every edit applies; run no test
 *   bun run audit:ledger -- --out docs/fix-ledger-audit.md
 *
 * Per fix, the audit runs the test file of the fix first. If that file passes, it runs the whole
 * suite with `--bail=1`. The result is one of:
 *
 * - `caught-by-own`: a test of the fix file fails. The fix has its own lock.
 * - `caught-elsewhere`: the fix file passes, and another test fails.
 * - `uncaught`: no test fails. The fix needs a test.
 * - `error`: the audit could not tell. A stale anchor, a syntax error, a time-out, a run
 *   that fails with no failing test, and a run in which only tests fail at their own time
 *   limit (machine load) are errors, never catches.
 *
 * The audit runs an unchanged copy first. A suite that already fails would "catch" every fix.
 * The audit works on a copy: it never writes to the repository that it audits.
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { bannerFor } from "../src/depgraph/reporters/banner.ts";
import { MUTATIONS } from "./fix-ledger-mutations.ts";

/** One exact text replacement in one file of the repository. */
export interface Edit {
  /** The file, relative to the repository root, with `/` separators. */
  file: string;
  /** The text to replace. It must occur exactly once in the file. */
  find: string;
  /** The text that restores the defect. */
  replace: string;
}

/**
 * The mutation of one fix: the edits that bring the 1.x defect back. A fix that lives in more
 * than one place has one mutation for each place, so that each place needs its own test.
 */
export interface Mutation {
  /** The fix id of the ledger: `F22`, `M1` or `R1`. */
  fix: string;
  /** One sentence: the defect that the edits restore. */
  defect: string;
  /** The edits. A mutation can change more than one place. */
  edits: Edit[];
  /** The test files of the fix. Default: `tests/unit/depgraph-<id>.test.ts`. `[]` skips them. */
  own?: string[];
}

/** What the audit concludes for one fix. */
export type Verdict = "caught-by-own" | "caught-elsewhere" | "uncaught" | "error";

/** The counts and the failing test names of one `bun test` run. */
export interface TestSummary {
  pass: number;
  fail: number;
  skip: number;
  failed: string[];
  /** The failing tests that ended at their own time limit. Load can cause this, not a defect. */
  timeouts: string[];
}

/** The result of one `bun test` run. */
export interface StageResult {
  exitCode: number;
  timedOut: boolean;
  summary: TestSummary;
}

/** The verdict for one fix, with the failing tests, and the reason of an error. */
export interface Decision {
  verdict: Verdict;
  failing: string[];
  reason?: string;
}

/** One row of the report. */
export interface AuditRow extends Decision {
  fix: string;
  defect: string;
}

/** The options of `auditMutations`. */
export interface AuditOptions {
  /** A folder that does not exist yet. The audit makes one copy of the repository per job in it. */
  scratch: string;
  /** The number of copies that run at the same time. */
  jobs: number;
  /** The time that one `bun test` run may take, in milliseconds. */
  timeoutMs: number;
  /** The time limit of one test, in milliseconds. Default: 30000 (the Bun default is 5000). */
  testTimeoutMs?: number;
  /** Receives one progress line at a time. */
  log: (line: string) => void;
  /** Run the unchanged copy first, and stop when it fails. Default: true. */
  baseline?: boolean;
  /** List the files of the copy with `git ls-files`. Default: true. `false` walks the folder. */
  useGit?: boolean;
}

/** An error in the catalog or in a run, as opposed to a bug of the audit. */
export class AuditError extends Error {}

/** Orders fix ids as F1 < F2 < F10 < M1 < R1. */
export function compareFix(a: string, b: string): number {
  const letter = (id: string): string => id.slice(0, 1);
  const number = (id: string): number => Number(id.slice(1));
  if (letter(a) !== letter(b)) return letter(a) < letter(b) ? -1 : 1;
  return number(a) - number(b);
}

/** The test files that lock a fix by default. */
export function ownTests(fix: string): string[] {
  return [`tests/unit/depgraph-${fix.toLowerCase()}.test.ts`];
}

/** Returns `text` with the one place of `edit.find` replaced. Any other count is an error. */
export function applyEdit(text: string, edit: Edit): string {
  if (edit.find === "") throw new AuditError(`${edit.file}: the anchor is empty`);
  if (edit.find === edit.replace) {
    throw new AuditError(`${edit.file}: the replacement makes no change`);
  }
  const count = text.split(edit.find).length - 1;
  const shown = JSON.stringify(edit.find.length > 60 ? `${edit.find.slice(0, 60)}...` : edit.find);
  if (count === 0) throw new AuditError(`${edit.file}: the anchor was not found: ${shown}`);
  if (count > 1) {
    throw new AuditError(`${edit.file}: the anchor occurs ${count} times, not once: ${shown}`);
  }
  const at = text.indexOf(edit.find);
  return text.slice(0, at) + edit.replace + text.slice(at + edit.find.length);
}

/** Reads the counts and the failing test names from the output of `bun test`. */
export function parseTestOutput(text: string): TestSummary {
  const count = (word: string): number => {
    const found = new RegExp(`^\\s*(\\d+) ${word}\\s*$`, "m").exec(text);
    return found ? Number(found[1]) : 0;
  };
  const failed: string[] = [];
  const timeouts: string[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  lines.forEach((line, index) => {
    const found = /^\(fail\) (.+?)(?: \[[\d.]+m?s\])?\s*$/.exec(line);
    if (!found) return;
    failed.push(found[1] as string);
    // Bun prints the time-out reason on the line after the failing test.
    if (/^\s*\^ this test timed out after \d+ms/.test(lines[index + 1] ?? "")) {
      timeouts.push(found[1] as string);
    }
  });
  return {
    pass: count("pass"),
    fail: count("fail"),
    skip: count("skip"),
    failed: [...new Set(failed)],
    timeouts: [...new Set(timeouts)],
  };
}

/** Turns the result of a run into "a test failed", "nothing failed" or an error. */
function judge(stage: StageResult): "failed" | "passed" | { error: string } {
  if (stage.timedOut) return { error: "time-out: the run did not end" };
  if (stage.exitCode === 0) return "passed";
  if (stage.summary.failed.length === 0) {
    return { error: `the run exited with ${stage.exitCode} and no failing test` };
  }
  if (stage.summary.failed.every((name) => stage.summary.timeouts.includes(name))) {
    return {
      error: `only time-limit failures (${stage.summary.timeouts.length}): load, not a catch`,
    };
  }
  return "failed";
}

/**
 * Decides the verdict from the run of the own test files (`null` when the fix has none) and the
 * run of the whole suite (`null` when the own run already decided).
 */
export function decide(own: StageResult | null, full: StageResult | null): Decision {
  if (own) {
    const result = judge(own);
    if (typeof result === "object") return { verdict: "error", failing: [], reason: result.error };
    if (result === "failed") return { verdict: "caught-by-own", failing: own.summary.failed };
  }
  if (!full) throw new AuditError("the own tests passed, so the full suite must run");
  const result = judge(full);
  if (typeof result === "object") return { verdict: "error", failing: [], reason: result.error };
  if (result === "failed") return { verdict: "caught-elsewhere", failing: full.summary.failed };
  return { verdict: "uncaught", failing: [] };
}

/** Reads the fixes of the ledger: those that a test locks, and those with no 2.0.0 meaning. */
export function parseLedger(markdown: string): { locked: string[]; notApplicable: string[] } {
  const id = /\b(?:F\d+|M1|R1)\b/g;
  const locked: string[] = [];
  const notApplicable: string[] = [];
  let section = "";
  for (const line of markdown.split(/\r\n|\r|\n/)) {
    if (line.startsWith("## ")) section = line;
    if (section.startsWith("## Locked") && line.startsWith("|")) {
      const cell = line.split("|")[1] ?? "";
      locked.push(...(cell.match(id) ?? []));
    }
    if (section.startsWith("## No 2.0.0 meaning")) {
      const bullet = /^- \*\*((?:F\d+)(?: and F\d+)*)\.\*\*/.exec(line);
      if (bullet) notApplicable.push(...((bullet[1] as string).match(id) ?? []));
    }
  }
  return { locked: locked.sort(compareFix), notApplicable: notApplicable.sort(compareFix) };
}

const LABELS: Record<Exclude<Verdict, "error">, string> = {
  "caught-by-own": "caught by its own test",
  "caught-elsewhere": "caught by another test",
  uncaught: "UNCAUGHT",
};

/** Makes text safe for a Markdown table cell. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

/** Renders the Markdown record of an audit. The text holds no date and no commit id. */
export function renderReport(rows: AuditRow[], notApplicable: string[]): string {
  const sorted = [...rows].sort((a, b) => compareFix(a.fix, b.fix));
  const count = (verdict: Verdict): number => sorted.filter((r) => r.verdict === verdict).length;
  const lines = [
    "# Fix-ledger audit",
    "",
    "Each row reverts one fix of `docs/fix-ledger-2.0.0.md` in a scratch copy of the repository.",
    "The audit runs the test file of the fix, and then the whole suite. A fix is locked when a",
    "test fails. A fix that no test catches is a gap, and it needs a test.",
    "",
    "| Fix | Defect that the mutation restores | Result | First failing test |",
    "| --- | --- | --- | --- |",
  ];
  for (const row of sorted) {
    const result =
      row.verdict === "error" ? `ERROR: ${row.reason ?? "unknown"}` : LABELS[row.verdict];
    const first = row.failing[0];
    const shown = first === undefined ? "none" : `\`${cell(first)}\``;
    const more = row.failing.length > 1 ? ` (+${row.failing.length - 1} more)` : "";
    lines.push(`| ${row.fix} | ${cell(row.defect)} | ${cell(result)} | ${shown}${more} |`);
  }
  const fixes = new Set(sorted.map((r) => r.fix)).size;
  lines.push(
    "",
    `The audit ran ${sorted.length} mutations of ${fixes} fixes:`,
    "",
    `- ${count("caught-by-own")} caught by its own test`,
    `- ${count("caught-elsewhere")} caught by another test`,
    `- ${count("uncaught")} uncaught`,
    `- ${count("error")} error`,
  );
  if (notApplicable.length > 0) {
    lines.push(
      "",
      `These fixes have no 2.0.0 meaning, so the audit has no mutation for them: ${notApplicable.join(", ")}.`,
    );
  }
  return `${bannerFor({ command: "bun run audit:ledger -- --out docs/fix-ledger-audit.md" })}${lines.join("\n")}\n`;
}

/** Runs git in `cwd` and returns its standard output. A failure stops the audit. */
function git(cwd: string, args: string[]): string {
  const run = Bun.spawnSync(["git", ...args], { cwd });
  if (run.exitCode !== 0) {
    throw new AuditError(`git ${args.join(" ")} failed: ${run.stderr.toString().trim()}`);
  }
  return run.stdout.toString();
}

/** The entries of NUL-separated git output. */
function nulList(text: string): string[] {
  return text.split("\u0000").filter((entry) => entry !== "");
}

/** The files below `repo`, as `/` paths, without `node_modules` and `.git`. */
function walkFiles(repo: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".git") continue;
      const path = join(dir, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(path);
      else found.push(relative(repo, path).replaceAll("\\", "/"));
    }
  };
  walk(repo);
  return found;
}

/**
 * Copies the repository at `repo` to the new folder `dest` and links `node_modules` into the copy.
 *
 * With `useGit` (the default) the copy is a shared clone of `HEAD`, so it holds the history, the
 * index and the file modes that some tests read. The uncommitted work of `repo` is laid over the
 * clone: edits, deletions, staged files and untracked files that git does not ignore. Without
 * `useGit` the copy is a plain copy of the files, for a folder that is not a repository.
 */
export function copyRepository(repo: string, dest: string, useGit = true): void {
  if (existsSync(dest)) throw new AuditError(`the scratch folder already exists: ${dest}`);
  mkdirSync(dirname(dest), { recursive: true });
  if (useGit) {
    git(dirname(dest), ["clone", "-q", "--shared", "-c", "core.autocrlf=false", repo, dest]);
    const changed = nulList(git(repo, ["diff", "--name-only", "--no-renames", "-z", "HEAD"]));
    const untracked = nulList(git(repo, ["ls-files", "-z", "--others", "--exclude-standard"]));
    for (const file of [...changed, ...untracked]) {
      const from = join(repo, file);
      const to = join(dest, file);
      if (existsSync(from)) {
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
      } else {
        rmSync(to, { force: true });
      }
    }
  } else {
    for (const file of walkFiles(repo)) {
      mkdirSync(dirname(join(dest, file)), { recursive: true });
      copyFileSync(join(repo, file), join(dest, file));
    }
    mkdirSync(dest, { recursive: true });
  }
  const modules = join(repo, "node_modules");
  if (existsSync(modules)) symlinkSync(modules, join(dest, "node_modules"), "junction");
}

/**
 * Removes a copy. The link to `node_modules` goes first, so the removal cannot reach the target.
 * When the link stays, the copy stays too, and the function returns false: a recursive removal
 * could follow the link into the real `node_modules`.
 */
function removeCopy(dest: string): boolean {
  const link = join(dest, "node_modules");
  try {
    unlinkSync(link);
  } catch {
    try {
      rmdirSync(link);
    } catch {
      // No link exists, or it is already gone.
    }
  }
  if (existsSync(link)) return false;
  rmSync(dest, { recursive: true, force: true });
  return true;
}

/** Runs `bun <args>` in `cwd`; kills the whole process tree when `timeoutMs` passes. */
async function runBun(cwd: string, args: string[], timeoutMs: number): Promise<StageResult> {
  const proc = Bun.spawn([process.execPath, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (process.platform === "win32") {
      Bun.spawnSync(["taskkill", "/PID", String(proc.pid), "/T", "/F"]);
    } else {
      proc.kill("SIGKILL");
    }
  }, timeoutMs);
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  clearTimeout(timer);
  return { exitCode, timedOut, summary: parseTestOutput(`${out}\n${err}`) };
}

/** Applies the edits to the sources in memory, and checks that each changed file still parses. */
function mutate(dir: string, mutation: Mutation): Map<string, { before: string; after: string }> {
  const files = new Map<string, { before: string; after: string }>();
  for (const edit of mutation.edits) {
    const path = join(dir, edit.file);
    if (!existsSync(path)) throw new AuditError(`${edit.file}: the file does not exist`);
    const text = readFileSync(path, "utf8");
    const current = files.get(edit.file) ?? { before: text, after: text };
    files.set(edit.file, { before: current.before, after: applyEdit(current.after, edit) });
  }
  for (const [file, { after }] of files) assertParses(file, after);
  return files;
}

/**
 * Throws an `AuditError` when `text` is not valid for the kind of `file`: a TypeScript file must
 * transpile, and a JSON file must parse. Any other file has no check.
 */
export function assertParses(file: string, text: string): void {
  try {
    if (file.endsWith(".json")) JSON.parse(text);
    else if (/\.[cm]?tsx?$/.test(file)) {
      new Bun.Transpiler({ loader: file.endsWith("x") ? "tsx" : "ts" }).transformSync(text);
    }
  } catch (error) {
    throw new AuditError(`${file}: the mutated file does not parse: ${(error as Error).message}`);
  }
}

/** Audits one fix in the copy `dir`. The copy is whole again when the function returns. */
async function auditOne(
  dir: string,
  mutation: Mutation,
  timeoutMs: number,
  testTimeoutMs: number,
): Promise<Decision> {
  const limit = ["--timeout", String(testTimeoutMs)];
  let files: Map<string, { before: string; after: string }>;
  try {
    files = mutate(dir, mutation);
  } catch (error) {
    if (error instanceof AuditError)
      return { verdict: "error", failing: [], reason: error.message };
    throw error;
  }
  try {
    for (const [file, { after }] of files) writeFileSync(join(dir, file), after);
    const own = mutation.own ?? ownTests(mutation.fix);
    for (const file of own) {
      if (!existsSync(join(dir, file))) {
        return { verdict: "error", failing: [], reason: `the own test file is missing: ${file}` };
      }
    }
    const ownRun = own.length > 0 ? await runBun(dir, ["test", ...limit, ...own], timeoutMs) : null;
    const needFull = ownRun === null || (ownRun.exitCode === 0 && !ownRun.timedOut);
    const fullRun = needFull ? await runBun(dir, ["test", ...limit, "--bail=1"], timeoutMs) : null;
    return decide(ownRun, fullRun);
  } finally {
    for (const [file, { before }] of files) writeFileSync(join(dir, file), before);
  }
}

/**
 * Audits `mutations` against the repository at `repo`. Each job owns one copy of the repository
 * under `options.scratch`. The copies are removed when the function returns.
 */
export async function auditMutations(
  repo: string,
  mutations: Mutation[],
  options: AuditOptions,
): Promise<AuditRow[]> {
  const useGit = options.useGit ?? true;
  const testTimeoutMs = options.testTimeoutMs ?? 30_000;
  const jobs = Math.max(1, Math.min(options.jobs, mutations.length));
  mkdirSync(options.scratch, { recursive: true });
  const dirs = Array.from({ length: jobs }, (_, index) => join(options.scratch, `copy-${index}`));
  const rows: (AuditRow | undefined)[] = new Array(mutations.length).fill(undefined);
  try {
    for (const dir of dirs) copyRepository(repo, dir, useGit);
    if (options.baseline ?? true) {
      options.log("baseline: running the unchanged copy");
      const base = await runBun(
        dirs[0] as string,
        ["test", "--timeout", String(testTimeoutMs)],
        options.timeoutMs,
      );
      const verdict = judge(base);
      if (verdict !== "passed") {
        const names = base.summary.failed.slice(0, 12).map((name) => `\n  ${name}`);
        const why =
          typeof verdict === "object"
            ? verdict.error
            : `${base.summary.failed.length} test(s) fail:${names.join("")}`;
        throw new AuditError(
          `the unchanged copy does not pass, so no result would mean anything: ${why}`,
        );
      }
      options.log(
        `baseline: ${base.summary.pass} pass, ${base.summary.skip} skip, ${base.summary.fail} fail`,
      );
    }
    let next = 0;
    await Promise.all(
      dirs.map(async (dir) => {
        for (let index = next++; index < mutations.length; index = next++) {
          const mutation = mutations[index] as Mutation;
          const started = Date.now();
          const decision = await auditOne(dir, mutation, options.timeoutMs, testTimeoutMs);
          rows[index] = { fix: mutation.fix, defect: mutation.defect, ...decision };
          const seconds = ((Date.now() - started) / 1000).toFixed(1);
          const note = decision.reason ?? decision.failing[0] ?? "";
          const defect = mutation.defect.slice(0, 48);
          options.log(`${mutation.fix}\t${decision.verdict}\t${seconds}s\t${defect}\t${note}`);
        }
      }),
    );
  } finally {
    for (const dir of dirs) {
      if (!removeCopy(dir))
        options.log(`the link to node_modules stays, so the copy stays: ${dir}`);
    }
    try {
      rmdirSync(options.scratch);
    } catch {
      // The scratch folder holds other files, or it is already gone.
    }
  }
  return rows as AuditRow[];
}

/** The result of checking one mutation without a test run. */
export interface CheckResult {
  fix: string;
  /** Empty when every edit applies and every changed file parses. */
  problem: string;
}

/** Checks that every edit of `mutations` applies to the sources of `repo` and still parses. */
export function checkMutations(repo: string, mutations: Mutation[]): CheckResult[] {
  return mutations.map((mutation) => {
    try {
      mutate(repo, mutation);
      return { fix: mutation.fix, problem: "" };
    } catch (error) {
      if (!(error instanceof AuditError)) throw error;
      return { fix: mutation.fix, problem: error.message };
    }
  });
}

/** The help text. */
const HELP = `Usage: bun run audit:ledger [-- options]

Reverts each fix of the ledger in a scratch copy and records whether a test fails.

Options:
  --only <ids>       Audit the fixes in the list, such as F22,M1.
  --check            Check that every edit applies and parses. Run no test.
  --jobs <n>         Copies that run at the same time. Default: 3.
  --timeout-s <n>    Seconds that one test run may take. Default: 900.
  --test-timeout-s <n>  Seconds that one test may take. Default: 30 (Bun: 5).
  --no-baseline      Skip the run of the unchanged copy.
  --out <file>       Write the Markdown record to <file>.
  --json <file>      Write the rows as JSON to <file>.
  --scratch <dir>    A folder that does not exist yet. Default: a new folder in the temp folder.
  -h, --help         Print this text.
`;

/**
 * Runs the command line. Returns the exit code: 0 when every mutation fails a test of its own
 * fix, 1 for any other verdict (a catch by another test is a gap in the fix file), 2 for a bad
 * option.
 */
export async function main(argv: string[]): Promise<number> {
  const root = join(import.meta.dir, "..");
  const flags: Record<string, string | boolean> = {};
  const valued = new Set([
    "--only",
    "--jobs",
    "--timeout-s",
    "--test-timeout-s",
    "--out",
    "--json",
    "--scratch",
  ]);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;
    if (valued.has(arg)) {
      const value = argv[++index];
      if (value === undefined) {
        console.error(`audit: ${arg} needs a value`);
        return 2;
      }
      flags[arg] = value;
    } else if (["--check", "--no-baseline", "-h", "--help"].includes(arg)) {
      flags[arg] = true;
    } else {
      console.error(`audit: unknown option ${arg}\n\n${HELP}`);
      return 2;
    }
  }
  if (flags["-h"] || flags["--help"]) {
    console.log(HELP);
    return 0;
  }
  let mutations = MUTATIONS;
  if (typeof flags["--only"] === "string") {
    const wanted = new Set(flags["--only"].split(",").map((id) => id.trim().toUpperCase()));
    mutations = MUTATIONS.filter((m) => wanted.has(m.fix));
    const missing = [...wanted].filter((id) => !mutations.some((m) => m.fix === id));
    if (missing.length > 0) {
      console.error(`audit: no mutation for ${missing.join(", ")}`);
      return 2;
    }
  }
  if (flags["--check"]) {
    const results = checkMutations(root, mutations);
    for (const { fix, problem } of results)
      console.log(problem === "" ? `${fix}	ok` : `${fix}	ERROR	${problem}`);
    return results.some((r) => r.problem !== "") ? 1 : 0;
  }
  const ledger = parseLedger(readFileSync(join(root, "docs/fix-ledger-2.0.0.md"), "utf8"));
  const jobs = Number(flags["--jobs"] ?? Math.max(1, Math.min(3, Math.floor(cpus().length / 8))));
  const timeoutMs = Number(flags["--timeout-s"] ?? 900) * 1000;
  const testTimeoutMs = Number(flags["--test-timeout-s"] ?? 30) * 1000;
  if (!Number.isInteger(jobs) || jobs < 1 || !(timeoutMs > 0) || !(testTimeoutMs > 0)) {
    console.error("audit: --jobs, --timeout-s and --test-timeout-s must be positive numbers");
    return 2;
  }
  const scratch =
    typeof flags["--scratch"] === "string"
      ? flags["--scratch"]
      : join(mkdtempSync(join(tmpdir(), "repo-tools-ledger-audit-")), "run");
  let rows: AuditRow[];
  try {
    rows = await auditMutations(root, mutations, {
      scratch,
      jobs,
      timeoutMs,
      testTimeoutMs,
      baseline: !flags["--no-baseline"],
      log: (line) => console.error(line),
    });
  } catch (error) {
    if (!(error instanceof AuditError)) throw error;
    console.error(`audit: ${error.message}`);
    return 1;
  }
  const report = renderReport(rows, flags["--only"] ? [] : ledger.notApplicable);
  if (typeof flags["--out"] === "string") writeFileSync(join(root, flags["--out"]), report);
  if (typeof flags["--json"] === "string") {
    writeFileSync(
      join(root, flags["--json"]),
      `${JSON.stringify(rows, null, 2)}
`,
    );
  }
  console.log(report);
  return rows.every((r) => r.verdict === "caught-by-own") ? 0 : 1;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
