/**
 * `repo-tools docs` (design section 16): measure, stub and gate the documentation comments of the
 * source files. The command is a port of `code_docs.py` of the code-docs skill.
 *
 * - `scan` measures the coverage and writes `COVERAGE.md` and `coverage.json`.
 * - `stub` plans skeleton comments for the exported symbols that have none. It writes them only
 *   with `--apply`.
 * - `check` is the gate. It exits 1 on a MUST issue or on a file that does not parse.
 *
 * Standard error shows the root as `<root>`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { wantsHelp } from "../depgraph/args.ts";
import { maskRoot, toPosix } from "../depgraph/paths.ts";
import type { Io } from "../io-types.ts";
import { isDirectory } from "../map/command.ts";
import { analyseRepo } from "./analyse.ts";
import { CONFIG_NAME, languageOf } from "./discovery.ts";
import { type FileReport, isParsed } from "./model.ts";
import { parsesAsPython } from "./python.ts";
import { pctText, summarise, writeOutputs } from "./report.ts";
import { applyInsertions, type Insertion, planPython, planTypeScript, splitLines } from "./stub.ts";
import { parsesAsTypeScript } from "./typescript.ts";

/** The help text of `repo-tools docs`. */
export const DOCS_HELP = `Usage: repo-tools docs scan  [root] [--out=<dir>]
       repo-tools docs stub  [root] [--apply] [--path=<path>]
       repo-tools docs check [root] [--paths <path>... | --paths-from=<file>]

Measure, stub and gate the documentation comments of the TypeScript, JavaScript
and Python files of a repository. The files are the files that git tracks. A
file in a skipped folder (node_modules, dist, build, bundle, out, vendor) or
with a generated name (.d.ts, .min.js, _pb2.py) is not read.

Actions:
  scan   Measure the coverage. Write COVERAGE.md and coverage.json.
  stub   Plan a skeleton comment for each exported symbol that has none. The
         default is a dry run. Every stub holds the marker TODO:, which check
         fails on.
  check  The gate. Exit 1 on a MUST issue or on a file that does not parse.

Options:
  --root=<path>        The repository (default: the current folder). An argument
                       that is not a flag also sets the root.
  --out=<dir>          scan: the output folder (default: docs/code-docs below
                       the root). A relative path is relative to the current
                       folder.
  --apply              stub: write the stubs. A file that would not parse after
                       the change is not changed.
  --path=<path>        stub: only this file, or the files below this folder.
  --paths <path>...    check: gate only these files, for example the files of a
                       pull request. Put the root before this flag. The flag
                       takes every argument up to the next flag. No path means
                       that the gate checks nothing, and it passes.
  --paths-from=<file>  check: read the paths from a file, one path on each line,
                       as 'git diff --name-only' writes them.
  --help, -h           Show this help.

A flag with a value takes '--name=value' or '--name value'.

The MUST rules decide the exit code:
  M1  An exported symbol has a doc comment. A test file is exempt.
  M2  The doc comment has a summary line.
  M3  The doc comment names no parameter that the signature lacks.
  M4  The doc comment holds no TODO: marker from stub.
  M5  A file uses one doc dialect only (google, numpy, rest, tsdoc or jsdoc).
The SHOULD rules are reported and never gate: S2 (the summary ends with a full
stop), S5 (the comment repeats a type that the signature holds), and S6 (the
prose follows Simplified Technical English).

${CONFIG_NAME} at the root excludes paths from every action. Each entry needs a
reason, and the output names each exclusion:
  { "exclude": [ { "path": "assembly/", "reason": "AssemblyScript" } ] }

Exit codes: 0 when the action succeeded and the gate passed. 1 when the gate
failed, or when the root holds no source file to measure. 2 on a usage error,
when the root is not a folder, or when ${CONFIG_NAME} is malformed.
`;

type Action = "scan" | "stub" | "check";

/** The parsed command line. */
interface DocsOptions {
  action: Action;
  root: string;
  out: string | undefined;
  apply: boolean;
  path: string | undefined;
  /** The paths to gate. Undefined means that the gate checks the whole repository. */
  paths: string[] | undefined;
  pathsFrom: string | undefined;
}

/** The flags that take a value, and the action that each one belongs to. */
const VALUE_FLAGS: Readonly<Record<string, Action | "all">> = {
  "--root": "all",
  "--out": "scan",
  "--path": "stub",
  "--paths-from": "check",
};

/** Parses the arguments. A strict parser: an unknown flag, a missing value or a repeat throws. */
function parseDocsArgs(argv: readonly string[]): DocsOptions {
  const action = argv[0];
  if (action !== "scan" && action !== "stub" && action !== "check") {
    throw new Error(
      action === undefined
        ? "an action is required: scan, stub or check (see repo-tools docs --help)"
        : `unknown action '${action}': use scan, stub or check`,
    );
  }
  const options: DocsOptions = {
    action,
    root: ".",
    out: undefined,
    apply: false,
    path: undefined,
    paths: undefined,
    pathsFrom: undefined,
  };
  let rootSet = false;
  const setRoot = (value: string): void => {
    if (rootSet)
      throw new Error("the root is set twice (use --root=<path> or one positional path)");
    rootSet = true;
    options.root = value;
  };
  const forbid = (flag: string, owner: Action | "all"): void => {
    if (owner !== "all" && owner !== action)
      throw new Error(`flag ${flag} applies to '${owner}' only`);
  };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("-")) {
      setRoot(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (name === "--apply") {
      forbid(name, "stub");
      if (eq !== -1) throw new Error("flag --apply takes no value");
      options.apply = true;
    } else if (name === "--paths") {
      forbid(name, "check");
      options.paths ??= [];
      if (eq !== -1) {
        options.paths.push(arg.slice(eq + 1));
      } else {
        while (i + 1 < argv.length && !(argv[i + 1] ?? "").startsWith("-"))
          options.paths.push(argv[++i] ?? "");
      }
    } else if (Object.hasOwn(VALUE_FLAGS, name)) {
      forbid(name, VALUE_FLAGS[name] as Action | "all");
      let value = eq === -1 ? undefined : arg.slice(eq + 1);
      if (eq === -1 && i + 1 < argv.length && !(argv[i + 1] ?? "").startsWith("-"))
        value = argv[++i];
      if (value === undefined || value === "") {
        throw new Error(`flag ${name} needs a value: ${name}=<value>`);
      }
      if (name === "--root") setRoot(value);
      else if (name === "--out") options.out = value;
      else if (name === "--path") options.path = value;
      else options.pathsFrom = value;
    } else {
      throw new Error(`unknown flag '${name}' (see repo-tools docs --help)`);
    }
  }
  if (options.paths !== undefined && options.pathsFrom !== undefined) {
    throw new Error("use --paths or --paths-from, not both");
  }
  return options;
}

/** A path of the repository as `scope` and `stub` compare it: POSIX, relative to the root. */
function relativeToRoot(root: string, path: string): string {
  let q = toPosix(path);
  if (isAbsolute(path)) {
    const rel = toPosix(relative(root, path));
    if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) q = rel;
  }
  return q.replace(/^(\.\/)+/, "");
}

/** The form of a path in a message: `<root>/<rel>` below the root, the absolute path otherwise. */
function shown(root: string, path: string): string {
  const rel = relative(root, path);
  return rel.startsWith("..") || isAbsolute(rel) ? path : `<root>/${toPosix(rel)}`;
}

/** The error of a run that found no file to measure. It fails the gate: it is not a misuse. */
class NothingToMeasure extends Error {
  constructor(provenance: string) {
    super(
      "no TypeScript, JavaScript or Python source file was found below <root> " +
        `(${provenance}) -- nothing to measure. This is a failure, not a pass: check the path, ` +
        "or add the files to git.",
    );
    this.name = "NothingToMeasure";
  }
}

/** `scan`: measures the coverage and writes the report. */
async function runScan(root: string, options: DocsOptions, io: Io): Promise<number> {
  const { reports, provenance } = await analyseRepo(root);
  if (reports.length === 0) throw new NothingToMeasure(provenance);
  const stats = summarise(reports);
  const outDir = resolve(options.out ?? join(root, "docs", "code-docs"));
  const written = writeOutputs(outDir, reports, stats, provenance, basename(root));
  io.stdout(`scanned ${stats.filesScanned} file(s) via ${provenance}\n`);
  io.stdout(`  exported symbols   : ${stats.exportedSymbols}\n`);
  io.stdout(
    `  documented         : ${stats.exportedDocumented} (${pctText(stats.exportedDocumentedPct)}%)\n`,
  );
  io.stdout(`  MUST issues        : ${stats.mustIssues}\n`);
  io.stdout(`  SHOULD issues      : ${stats.shouldIssues}\n`);
  if (stats.filesUnparsed > 0) {
    io.stdout(`  UNPARSED (unknown) : ${stats.filesUnparsed}  <- not counted as clean\n`);
  }
  io.stdout(`wrote ${shown(root, written.markdown)}\n`);
  io.stdout(`wrote ${shown(root, written.json)}\n`);
  return 0;
}

/** True when `report.path` is below `scope`, or is `scope`. */
function inScope(report: FileReport, scope: string): boolean {
  const prefix = `${scope.replace(/\/+$/, "")}/`;
  return report.path.startsWith(prefix) || report.path === scope;
}

/** `stub`: plans the skeleton comments, and writes them only with `--apply`. */
async function runStub(root: string, options: DocsOptions, io: Io): Promise<number> {
  const analysis = await analyseRepo(root);
  const scope = options.path === undefined ? undefined : relativeToRoot(root, options.path);
  const reports =
    scope === undefined ? analysis.reports : analysis.reports.filter((r) => inScope(r, scope));
  let planned = 0;
  let changed = 0;
  for (const report of reports) {
    if (!isParsed(report)) continue;
    // A stub documents the symbols that carry an M1 issue: an exported symbol with no doc, and not
    // in a test file. A stub elsewhere would fail the gate on M4 for a symbol the gate never asked
    // about.
    const targets = report.symbols.filter((s) => s.issues.some((i) => i.rule === "M1"));
    if (targets.length === 0) continue;
    const file = join(root, report.path);
    const raw = readFileSync(file, "utf8");
    if (/\r(?!\n)/.test(raw)) {
      io.stdout(`  SKIPPED ${report.path}: the file holds a carriage return with no line feed\n`);
      continue;
    }
    const lines = splitLines(raw);
    const plan = report.language === "python" ? planPython : planTypeScript;
    const insertions = targets.map((s) => plan(s, lines)).filter((i): i is Insertion => i !== null);
    planned += insertions.length;
    if (!options.apply) {
      for (const ins of insertions) {
        io.stdout(`  would document ${report.path}:${ins.lineIndex + 1} ${ins.symbol}\n`);
      }
      continue;
    }
    const verify =
      report.language === "python"
        ? parsesAsPython
        : (text: string): boolean => parsesAsTypeScript(report.path, text);
    const result = applyInsertions(raw, insertions, verify);
    if (result.ok) writeFileSync(file, result.text);
    io.stdout(`  ${result.ok ? "wrote" : "SKIPPED"} ${report.path}: ${result.message}\n`);
    if (result.ok) changed += 1;
  }
  const mode = options.apply ? "APPLIED" : "DRY RUN (pass --apply to write)";
  io.stdout(
    `${mode}: ${planned} stub(s) planned across ${reports.length} file(s); ${changed} file(s) modified\n`,
  );
  if (planned > 0 && !options.apply) {
    io.stdout("Every stub carries a TODO: marker, which `check` FAILS on -- fill them in.\n");
  }
  return 0;
}

/** The paths to gate: from `--paths-from`, from `--paths`, or undefined for the whole repository. */
function requestedPaths(root: string, options: DocsOptions): string[] | undefined {
  let raw = options.paths;
  if (options.pathsFrom !== undefined) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(options.pathsFrom));
    } catch {
      throw new Error(`cannot read the paths file ${basename(options.pathsFrom)} as UTF-8 text`);
    }
    raw = text
      .split(/\r\n|\r|\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "");
  }
  return raw?.map((p) => relativeToRoot(root, p));
}

/** The text of a Python list of strings, as `sorted(...)` prints it: `['jsdoc', 'tsdoc']`. */
const pyList = (items: string[]): string =>
  `[${items
    .sort()
    .map((s) => `'${s}'`)
    .join(", ")}]`;

/** `check`: the gate. `scope` limits it to the given files (the ratchet of a pull request). */
async function runCheck(root: string, options: DocsOptions, io: Io): Promise<number> {
  const scope = requestedPaths(root, options);
  const { reports: all, provenance } = await analyseRepo(root);
  // A scope of no path gates nothing. The whole repository is the audit, and a pull request that
  // changed no source file must not inherit the backlog of the repository.
  if (all.length === 0 && scope === undefined) throw new NothingToMeasure(provenance);
  const stats = summarise(all);
  const wanted = scope === undefined ? undefined : new Set(scope);
  // A deleted file is still a changed file, so a path with no report is skipped, not an error.
  const reports = wanted === undefined ? all : all.filter((r) => wanted.has(r.path));
  const failures: string[] = [];
  for (const report of reports) {
    if (!isParsed(report)) {
      // An unparsed file is unknown. A gate that passes what it could not read has the look of
      // enforcement and none of the substance.
      failures.push(`${report.path}: UNPARSED -- ${report.error}`);
      continue;
    }
    if (report.dialects.size > 1) {
      failures.push(`${report.path}: M5 mixed docstring dialects ${pyList([...report.dialects])}`);
    }
    for (const sym of report.symbols) {
      for (const issue of sym.issues) {
        if (issue.tier === "MUST") {
          failures.push(`${sym.file}:${sym.line} ${sym.name}: ${issue.rule} ${issue.detail}`);
        }
      }
    }
  }
  if (wanted === undefined) {
    io.stdout(`checked ${stats.filesScanned} file(s) via ${provenance}\n`);
  } else {
    io.stdout(
      `checked ${reports.length} changed source file(s) of ${stats.filesScanned} tracked (${provenance})\n`,
    );
    const known = new Set(all.map((r) => r.path));
    const missed = [...wanted].filter((p) => languageOf(p) !== "" && !known.has(p));
    if (missed.length > 0) {
      io.stdout(
        `note: ${missed.length} requested source path(s) were not measured (not tracked, excluded, ` +
          `deleted, or in a skipped folder): ${missed.slice(0, 10).join(", ")}${missed.length > 10 ? ", ..." : ""}\n`,
      );
    }
  }
  if (failures.length === 0) {
    if (wanted === undefined) {
      io.stdout(
        `PASS -- ${stats.exportedDocumented}/${stats.exportedSymbols} exported symbols documented, 0 MUST issues\n`,
      );
      if (stats.shouldIssues > 0) {
        io.stdout(`  (${stats.shouldIssues} SHOULD issue(s) reported, not gated)\n`);
      }
    } else {
      io.stdout("PASS -- 0 MUST issue(s) in the changed files\n");
    }
    return 0;
  }
  io.stdout(`FAIL -- ${failures.length} MUST issue(s):\n`);
  for (const line of failures.slice(0, 100)) io.stdout(`  ${line}\n`);
  if (failures.length > 100) io.stdout(`  ... and ${failures.length - 100} more (TRUNCATED)\n`);
  return 1;
}

/** Runs `repo-tools docs` and returns the exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  if (wantsHelp(argv)) {
    io.stdout(DOCS_HELP);
    return 0;
  }
  let root: string | undefined;
  const stderr = (text: string): void => io.stderr(root ? maskRoot(text, root) : text);
  try {
    const options = parseDocsArgs(argv);
    root = resolve(options.root);
    if (!isDirectory(root)) throw new Error("the root <root> is not an existing directory");
    if (options.action === "scan") return await runScan(root, options, io);
    if (options.action === "stub") return await runStub(root, options, io);
    return await runCheck(root, options, io);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(`repo-tools docs: ${message}\n`);
    // A run that found nothing to measure is a failed gate. Every other error is a misuse.
    return error instanceof NothingToMeasure ? 1 : 2;
  }
}
