/**
 * `repo-tools map` (design decision D8): the command of the 2.0.0 engine. It builds the graph of
 * a TypeScript/JavaScript, Python, C# or Rust repository and writes every report into the output
 * folder. `repo-tools depgraph` is its deprecated alias through 2.x: the alias prints one
 * deprecation line, and it accepts the 1.x scan-scope flags with a warning, where `map` refuses
 * them.
 *
 * Standard error shows the root as `<root>`, never as an absolute path.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  type DepgraphConfig,
  loadConfigFile,
  mergeMapConfig,
  resolveUnderRoot,
} from "../config.ts";
import {
  type DepgraphOptions,
  type MapCommand,
  parseDepgraphArgs,
  scanScopeText,
  wantsHelp,
} from "../depgraph/args.ts";
import {
  asBaselineNames,
  asDuplicateEntries,
  buildDuplicateBaseline,
  type DuplicateEntries,
  findNewDuplicates,
  trueDuplicateNames,
} from "../depgraph/duplicates.ts";
import {
  loadExtensions,
  preflightContext,
  reportContext,
  runHook,
} from "../depgraph/extensions.ts";
import { maskRoot, OUTPUT_SUBDIR, relativePosix } from "../depgraph/paths.ts";
import { writeReport } from "../io.ts";
import type { Io } from "../io-types.ts";
import { sortCodeUnits } from "../sort.ts";
import {
  emitDependencyGraph,
  emitDuplicateSymbols,
  emitFileInventory,
  emitUnusedAnalysis,
} from "./artifacts.ts";
import { emitTestCoverage } from "./coverage.ts";
import {
  discover,
  type Language,
  UnsupportedRepoLanguage,
  walkedSourceFiles,
} from "./discovery.ts";
import { buildGraph } from "./graph.ts";
import { emitDependencyLayers, subsystemView } from "./layers.ts";
import { emitMarkdownReports } from "./markdown.ts";
import { emitSubsystemReports } from "./reports.ts";
import type { RepoGraph } from "./schema.ts";
import { emitApiSurface, emitExportSurfaces, NO_SURFACE_REASON } from "./surfaces.ts";

/** The help text of `repo-tools map`. */
export const MAP_HELP = `Usage: repo-tools map [options] [project-root]

Build the dependency graph of a TypeScript/JavaScript, Python, C# or Rust
repository, and write the reports into the output folder (default:
<root>/${OUTPUT_SUBDIR}). The census is the set of source files that git tracks
(outside a git work tree, a pruned walk). A flag wins over the config file, and
the config file wins over the default. Every path is relative to the root; a
path can start with ../ to leave the root.

Options:
  --root=<path>        Project root (default: the current directory). An
                       argument that is not a flag also sets the root.
  --config=<path>      Config file, relative to the root (default:
                       repo-tools.config.json at the root, when it exists). Its
                       section is 'map' (the old name 'depgraph' is accepted).
  --out=<dir>          Output folder (default: ${OUTPUT_SUBDIR}).
  --api-surface=<file> Write the per-export facts report to this file.
  --api-entry=<path>   Entry file of the public surface (default: src/index.ts).
  --stability-tags=<a,b>
                       Whole-word JSDoc stability tags; the last tag in a block
                       wins (default: public,internal,experimental,beta,alpha).
  --strict-orphans     Exit 1 when an orphaned source file exists. Without it,
                       an orphan gives a warning. Config: map.strictOrphans.
  --strict-census      Exit 1 when a source file on disk is not in the census
                       (untracked or ignored). Without it, a warning.
  --no-extensions      Load no extension of map.extensions. Without it, each
                       .mjs module there (relative to the root) loads in config
                       order: its preflight hook runs before the first write,
                       and its report hook after the reports.
  --check-census       Check the committed file-inventory.json against the
                       census. Write nothing. Exit 1 on a difference.
  --check-duplicates   Write the reports, then exit 1 when duplicate-symbols.json
                       holds a TRUE_DUPLICATE name that the duplicate baseline
                       does not hold (TypeScript only). Config:
                       map.duplicateBaseline (default:
                       ${OUTPUT_SUBDIR}/duplicate-baseline.json).
  --no-regen           With --check-duplicates: read the committed
                       duplicate-symbols.json. Write nothing.
  --write-duplicate-baseline
                       Write the duplicate baseline from the
                       duplicate-symbols.json of the last run. Write nothing
                       else.
  --help, -h           Show this help.

Input files never come from the output folder: the duplicate allowlist and
baseline and the coverage policy default to ${OUTPUT_SUBDIR}/.

The 1.x scan-scope flags --src, --tests, --exclude, --also-exclude, --all/-a,
--reachable-only and --include-tests/-t have no effect in 2.0.0: map exits 1 on
them, and the deprecated alias 'repo-tools depgraph' warns and continues.

Exit codes: 0 on success. 1 on an unknown or invalid flag (nothing is written),
when the root is not a directory, when the repository has no source file or a
language the engine cannot read (no output folder is made), when the
--api-entry file does not exist, when --strict-census or --strict-orphans
fails, when --check-census or --check-duplicates fails, when a mode reads a
file that does not exist, or when an extension does not load or a hook throws.
`;

/** The deprecation line of the `depgraph` alias (design decision D8). */
export const DEPGRAPH_DEPRECATION =
  "repo-tools depgraph is deprecated and runs repo-tools map; use repo-tools map.";

/** The config keys of 1.x that have no effect in 2.0.0, and the flag that each one mirrors. */
const SCAN_SCOPE_KEYS: Readonly<Record<string, string>> = {
  src: "--src",
  tests: "--tests",
  exclude: "--exclude",
  alsoExclude: "--also-exclude",
};

/** True when `path` is an existing folder. */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** `<root>/<rel>`: the form of a path in a message. */
const shown = (rel: string): string => `<root>/${rel.replace(/\\/g, "/")}`;

/** Runs `repo-tools map` (or its alias `depgraph`) and returns the exit code. */
export async function runMap(argv: string[], io: Io, command: MapCommand = "map"): Promise<number> {
  if (wantsHelp(argv)) {
    io.stdout(MAP_HELP);
    return 0;
  }
  let root: string | undefined;
  const stderr = (text: string): void => io.stderr(root ? maskRoot(text, root) : text);
  const sinks: Io = { stdout: io.stdout, stderr };
  if (command === "depgraph") stderr(`${DEPGRAPH_DEPRECATION}\n`);
  try {
    const options = parseDepgraphArgs(argv, process.cwd(), command);
    for (const flag of options.ignoredFlags) stderr(`Warning: ${scanScopeText(flag)}\n`);
    if (options.strictOrphans) options.settings.strictOrphans = true;
    root = resolve(options.root);
    if (!isDirectory(root)) throw new Error("the root <root> is not an existing directory");
    const fileSettings = loadConfigFile(root, options.config);
    for (const [key, flag] of Object.entries(SCAN_SCOPE_KEYS)) {
      if (key in fileSettings) {
        stderr(`Warning: config key ${key}: ${scanScopeText(flag).replace(/^flag \S+ /, "")}\n`);
      }
    }
    const config = mergeMapConfig(options.settings, fileSettings);
    if (options.writeDuplicateBaseline) return writeDuplicateBaseline(root, config, sinks);
    if (options.checkCensus) return checkCensus(root, config, sinks);
    if (options.checkDuplicates) return await checkDuplicates(root, options, config, sinks);
    return await runPipeline(root, options, config, sinks);
  } catch (err) {
    stderr(`repo-tools ${command}: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

/** Builds the graph; throws a plain error for an unreadable language or an empty repository. */
async function graphOf(root: string): Promise<RepoGraph> {
  let graph: RepoGraph;
  try {
    graph = await buildGraph(root);
  } catch (err) {
    if (err instanceof UnsupportedRepoLanguage) throw new Error(err.message);
    throw err;
  }
  if (graph.files.size === 0) {
    throw new Error("no source file found (TypeScript/JavaScript, Python, C# or Rust)");
  }
  return graph;
}

/** The census difference of `root`: files on disk that the census leaves out. */
function censusGaps(root: string, graph: RepoGraph): string[] {
  const census = new Set(graph.files.keys());
  return walkedSourceFiles(root, graph.language as Language).filter((p) => !census.has(p));
}

/** The pipeline: every report, then the census gates and the report hooks. */
async function runPipeline(
  root: string,
  options: DepgraphOptions,
  config: DepgraphConfig,
  io: Io,
): Promise<number> {
  const log = (line: string): void => io.stdout(`${line}\n`);
  const outDir = resolveUnderRoot(root, config.out);
  const outRel = relativePosix(root, outDir) || ".";
  // The API-surface entry must exist before the run writes anything (design section 6.2).
  const api = config.apiSurface;
  if (api.out !== null && !existsSync(resolveUnderRoot(root, api.entry))) {
    throw new Error(`the --api-entry file ${shown(api.entry)} does not exist`);
  }
  const extensions = options.noExtensions ? [] : await loadExtensions(root, config.extensions);
  await runHook(extensions, "preflight", preflightContext(root, config));

  const graph = await graphOf(root);
  log(`Language: ${graph.language}; ${graph.files.size} source files; ${graph.roots.length} roots`);
  if (api.out !== null && NO_SURFACE_REASON[graph.language] !== undefined) {
    throw new Error(
      (NO_SURFACE_REASON[graph.language] as string).replace(
        "package-export-surfaces.json",
        "--api-surface",
      ),
    );
  }
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
    log(`Created output directory: ${outRel}`);
  }
  const written: string[] = [];
  const banner = { command: config.regenerateCommand, marker: config.verificationMarker };
  const corePath = emitDependencyGraph(graph, outDir);
  written.push(corePath, emitFileInventory(graph, outDir));
  written.push(
    emitDuplicateSymbols(graph, outDir, {
      allowlistPath: resolveUnderRoot(root, config.duplicateAllowlist),
    }),
  );
  written.push(emitUnusedAnalysis(graph, outDir));
  const view = subsystemView(graph, root, (m) => io.stderr(`Warning: ${m}\n`));
  written.push(emitDependencyLayers(graph, root, outDir, view));
  written.push(...emitSubsystemReports(graph, root, outDir, corePath, { view, banner }));
  written.push(...emitMarkdownReports(outDir, banner));
  written.push(
    ...emitTestCoverage(graph, root, outDir, {
      policyPath: resolveUnderRoot(root, config.coveragePolicy),
      banner,
    }),
  );
  const surfaces = emitExportSurfaces(graph, root, outDir);
  if (surfaces) written.push(surfaces);
  else log(`Note: ${NO_SURFACE_REASON[graph.language] ?? "no export surface for this language."}`);
  if (api.out !== null) {
    const apiPath = resolveUnderRoot(root, api.out);
    const entry = api.entry.replace(/\\/g, "/");
    const count = emitApiSurface(graph, root, apiPath, entry, api.stabilityTags);
    log(`Written: ${relativePosix(root, apiPath)} (${count} surface symbols)`);
  }
  for (const path of written) log(`Written: ${relativePosix(root, path)}`);
  for (const warning of graph.warnings) io.stderr(`Warning: ${warning}\n`);

  const orphans = sortCodeUnits(
    [...graph.files.values()].filter((n) => n.disposition === "orphan").map((n) => n.path),
  );
  const gaps = censusGaps(root, graph);
  let failed = false;
  if (orphans.length > 0) {
    const text = `${orphans.length} orphaned source file(s), reachable from nothing:\n${orphans
      .map((p) => `  - ${p}`)
      .join("\n")}\n`;
    if (config.strictOrphans) {
      io.stderr(`census FAILED (--strict-orphans): ${text}`);
      failed = true;
    } else {
      io.stderr(`Warning: ${text}`);
    }
  }
  if (gaps.length > 0) {
    const text = `${gaps.length} source file(s) on disk are not in the census (untracked or ignored):\n${gaps
      .map((p) => `  - ${p}`)
      .join("\n")}\n`;
    if (options.strictCensus) {
      io.stderr(`census FAILED (--strict-census): ${text}`);
      failed = true;
    } else {
      io.stderr(`Warning: ${text}`);
    }
  }
  if (failed) return 1;
  log(`census passed: ${graph.files.size} files`);
  const core: unknown = JSON.parse(readFileSync(corePath, "utf8"));
  await runHook(extensions, "report", reportContext(root, config, outDir, core));
  return 0;
}

/** `--check-census`: the committed file-inventory.json against the census. Writes nothing. */
function checkCensus(root: string, config: DepgraphConfig, io: Io): number {
  const rel = `${config.out.replace(/[\\/]+$/, "")}/file-inventory.json`;
  const path = resolveUnderRoot(root, rel);
  if (!existsSync(path)) {
    throw new Error(`the inventory ${shown(rel)} does not exist; run repo-tools map first`);
  }
  let committed: Set<string>;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { files?: { file: string }[] };
    committed = new Set((parsed.files ?? []).map((f) => f.file));
  } catch {
    throw new Error(`the inventory ${shown(rel)} is not valid JSON`);
  }
  const census = new Set(discover(root).map((f) => f.path));
  const added = sortCodeUnits([...census].filter((p) => !committed.has(p)));
  const removed = sortCodeUnits([...committed].filter((p) => !census.has(p)));
  if (added.length === 0 && removed.length === 0) {
    io.stdout(`file-census check passed (no-regen): ${census.size} files match ${shown(rel)}.\n`);
    return 0;
  }
  const lines = [`file-census check FAILED: ${shown(rel)} differs from the census.`];
  for (const p of added) lines.push(`  + ${p} (in the census, not in the inventory)`);
  for (const p of removed) lines.push(`  - ${p} (in the inventory, not in the census)`);
  lines.push("Run repo-tools map, and commit the new inventory.");
  io.stderr(`${lines.join("\n")}\n`);
  return 1;
}

/** Reads the duplicate report of the output folder; throws when it is missing or has no lists. */
function readDuplicateReport(root: string, config: DepgraphConfig): DuplicateEntries {
  const rel = `${config.out.replace(/[\\/]+$/, "")}/duplicate-symbols.json`;
  const path = resolveUnderRoot(root, rel);
  if (!existsSync(path)) {
    throw new Error(`the duplicate report ${shown(rel)} does not exist; run repo-tools map first`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`the duplicate report ${shown(rel)} is not valid JSON`);
  }
  const entries = asDuplicateEntries(parsed);
  if (!entries) {
    throw new Error(
      `the duplicate report ${shown(rel)} has no classified lists: the duplicate gate works ` +
        "for TypeScript only",
    );
  }
  return entries;
}

/** `1 TRUE_DUPLICATE name` or `N TRUE_DUPLICATE names`. */
const namesLabel = (n: number): string => `${n} TRUE_DUPLICATE name${n === 1 ? "" : "s"}`;

/** `--check-duplicates`: exit 1 on a TRUE_DUPLICATE name that the baseline does not hold. */
async function checkDuplicates(
  root: string,
  options: DepgraphOptions,
  config: DepgraphConfig,
  io: Io,
): Promise<number> {
  const baselineRel = config.duplicateBaseline;
  const baselinePath = resolveUnderRoot(root, baselineRel);
  if (!existsSync(baselinePath)) {
    throw new Error(
      `the duplicate baseline ${shown(baselineRel)} does not exist; write it with ` +
        "repo-tools map --write-duplicate-baseline",
    );
  }
  let baseline: ReturnType<typeof asBaselineNames>;
  try {
    baseline = asBaselineNames(JSON.parse(readFileSync(baselinePath, "utf8")));
  } catch {
    throw new Error(`the duplicate baseline ${shown(baselineRel)} is not valid JSON`);
  }
  if (!baseline)
    throw new Error(`the duplicate baseline ${shown(baselineRel)} has an unknown shape`);
  if (!options.noRegen) {
    const code = await runPipeline(root, options, config, io);
    if (code !== 0) return code;
  }
  const report = readDuplicateReport(root, config);
  const found = findNewDuplicates(report, baseline);
  const current =
    Object.keys(trueDuplicateNames(report.runtime)).length +
    Object.keys(trueDuplicateNames(report.types)).length;
  const held = Object.keys(baseline.runtime).length + Object.keys(baseline.types).length;
  if (found.length === 0) {
    io.stdout(`duplicate check passed: ${namesLabel(current)}, ${held} in the baseline, 0 new.\n`);
    return 0;
  }
  const lines = [
    `duplicate check FAILED: ${found.length} new TRUE_DUPLICATE ${found.length === 1 ? "name" : "names"} not in ${shown(baselineRel)}:`,
  ];
  for (const f of found) {
    lines.push(`  [${f.kind}] ${f.name}`);
    for (const file of f.files) lines.push(`    - ${file}`);
  }
  lines.push(
    "Reuse one definition, or add the name to the duplicate allowlist. To accept the name " +
      "after review, run repo-tools map --write-duplicate-baseline.",
  );
  io.stderr(`${lines.join("\n")}\n`);
  return 1;
}

/** `--write-duplicate-baseline`: writes the baseline from the current duplicate-symbols.json. */
function writeDuplicateBaseline(root: string, config: DepgraphConfig, io: Io): number {
  const baseline = buildDuplicateBaseline(readDuplicateReport(root, config));
  const path = resolveUnderRoot(root, config.duplicateBaseline);
  writeReport(path, JSON.stringify(baseline, null, 2));
  io.stdout(
    `Written: ${relativePosix(root, path)} (${Object.keys(baseline.runtime).length} runtime, ` +
      `${Object.keys(baseline.types).length} type TRUE_DUPLICATE names)\n`,
  );
  return 0;
}
