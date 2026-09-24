/**
 * `repo-tools depgraph`: the pipeline in order, scan, parse, analyze, report, gate.
 *
 * This is the port of the pre-port generator, with no behavior change: the reports equal the
 * characterization goldens byte for byte (dates masked). Standard output names paths relative
 * to the root only.
 *
 * Left out of the port: the WASM, WebGPU and parallel pairing reports and the WASM build gate.
 * They read fixed paths of one consumer repo and write nothing on other repos. They ran after the
 * census gate and before the coverage summary; they come back as an extension (task D10).
 */
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type DepgraphConfig,
  loadConfigFile,
  mergeDepgraphConfig,
  resolveUnderRoot,
} from "../config.ts";
import { withOneLf, writeReport } from "../io.ts";
import type { Io } from "../io-types.ts";
import { sortCodeUnits } from "../sort.ts";
import {
  buildDependencyMatrix,
  categorizeFiles,
  computePublicSurface,
  detectUnused,
  findReachableFiles,
  generateStatistics,
  splitDormant,
} from "./analysis.ts";
import {
  buildApiSurfaceReport,
  createTsResolver,
  extractExportDetails,
  resolveSurface,
  type Surface,
} from "./api-surface.ts";
import { type DepgraphOptions, parseDepgraphArgs, wantsHelp } from "./args.ts";
import { analyzeTestCoverage, type TestCoverageAnalysis } from "./coverage.ts";
import { detectCyclicComponents } from "./cycles.ts";
import { linkLog } from "./dirlist.ts";
import {
  asBaselineNames,
  asDuplicateEntries,
  buildDuplicateBaseline,
  buildDuplicateReport,
  type DuplicateEntries,
  detectDuplicateSymbols,
  findNewDuplicates,
  trueDuplicateNames,
} from "./duplicates.ts";
import {
  buildFileInventory,
  censusFailure,
  censusGapWarning,
  censusOrphanWarning,
  censusPassLine,
  checkCensusNoRegen,
} from "./inventory.ts";
import { parseFile } from "./parser.ts";
import { maskRoot, OUTPUT_SUBDIR, relativePosix, srcDirOf } from "./paths.ts";
import { type BannerOptions, withBanner } from "./reporters/banner.ts";
import { generateTestCoverageJson, generateTestCoverageMarkdown } from "./reporters/coverage.ts";
import {
  generateDuplicateSymbolsJson,
  generateDuplicateSymbolsMarkdown,
} from "./reporters/duplicates.ts";
import { generateFileInventoryJson, generateFileInventoryMarkdown } from "./reporters/inventory.ts";
import { dependencyGraphJsonText, generateCompactSummary, generateJSON } from "./reporters/json.ts";
import {
  generateMarkdown,
  generatePackageDependencySection,
  insertPackageSection,
} from "./reporters/markdown.ts";
import { generateSurfacesJson } from "./reporters/surfaces.ts";
import { generateUnusedReport } from "./reporters/unused.ts";
import { generateYaml } from "./reporters/yaml.ts";
import { collectEntryPoints, isJsonObject, rootPackageEntries, selfPackage } from "./roots.ts";
import { getAllTestFiles, getAllTsFiles, resolveSourceDirs, setWalkSkip } from "./scanner.ts";
import type { PackageJson, ParsedFile, Statistics, UnusedExport } from "./types.ts";
import { detectWorkspaces } from "./workspaces.ts";

export { type DepgraphOptions, parseDepgraphArgs } from "./args.ts";

/** The help text of `repo-tools depgraph`. */
export const DEPGRAPH_HELP = `Usage: repo-tools depgraph [options] [project-root]

Write the dependency graph and the architecture reports of a TypeScript tree into
the output folder (default: <root>/${OUTPUT_SUBDIR}). A flag wins over the
config file, and the config file wins over the default. Every path is relative
to the root. The input files are .ts and .tsx files.

Options:
  --root=<path>        Project root (default: the current directory). An
                       argument that is not a flag also sets the root.
  --config=<path>      Config file, relative to the root (default:
                       repo-tools.config.json at the root, when it exists).
                       An unknown key, an absolute path or invalid JSON exits 1.
  --src=<a,b>          Source folders (default: auto, src/ if present, else each
                       top-level folder with TypeScript). Single-package mode
                       only: in a monorepo, --src or depgraph.src exits 1.
  --tests=<a,b>        Test folders, under the root and each package folder
                       (default: test,tests).
  --out=<dir>          Output folder (default: ${OUTPUT_SUBDIR}).
  --exclude=<a,b>      Replace the folder names that every walk skips (default:
                       node_modules,dist,build,coverage,.git).
  --also-exclude=<a,b> Add folder names that every walk skips.
  --api-surface=<file> Write the per-export facts report (signature, async,
                       stability tag, export path, counts) to this file. Without
                       it, no other output changes.
  --api-entry=<path>   Entry file of the public surface (default: src/index.ts).
                       A missing entry file exits 1 when the report is on.
  --stability-tags=<a,b>
                       Whole-word JSDoc stability tags; the last tag in a block
                       wins (default: public,internal,experimental,beta,alpha).
  --all, -a            Monorepo mode: include dormant and unreachable files.
  --reachable-only     Restrict the graph to the files reachable from a root.
                       Single-package mode analyzes all files by default.
  --strict-orphans     Exit 1 when an orphaned source file exists. Without it,
                       an orphan gives a warning. Config: depgraph.strictOrphans.
  --strict-census      Exit 1 when the file census differs from a full walk of
                       the root. Without it, the difference gives a warning.
  --include-tests, -t  No operation. Kept for compatibility: the test coverage
                       reports are always written.
  --check-census       Check the committed file-inventory.json against a fresh
                       walk of the root. Write nothing. Exit 1 on a difference.
  --check-duplicates   Write the reports, then exit 1 when duplicate-symbols.json
                       holds a TRUE_DUPLICATE name that the duplicate baseline
                       does not hold. Config: depgraph.duplicateBaseline
                       (default: <out>/duplicate-baseline.json). A missing
                       baseline exits 1 before the run writes.
  --no-regen           With --check-duplicates: read the committed
                       duplicate-symbols.json. Write nothing.
  --write-duplicate-baseline
                       Write the duplicate baseline from the current
                       duplicate-symbols.json (run depgraph first). Write
                       nothing else.
  --help, -h           Show this help.

Use one mode in a run: --check-census, --check-duplicates or
--write-duplicate-baseline.

Exit codes: 0 on success. 1 on an unknown flag, a flag without its value or an
invalid value (the run then writes nothing), when the root is not an existing
directory (no folder is made), when no TypeScript file is found (no output folder
is made), when the --api-entry file of --api-surface does not exist,
when the census self-check fails with --strict-census, when an orphan exists
with --strict-orphans, when --check-census fails, when --check-duplicates finds
a new TRUE_DUPLICATE name or no baseline, or when a report that a mode reads
does not exist.
`;

/**
 * Reads the name and version of `<root>/package.json`, or the defaults with a warning. Fix F35:
 * a package.json that is not a JSON object (`null`, an array, a number) gives the defaults.
 */
function readPackageJson(root: string, io: Io): PackageJson {
  let pkg: unknown;
  try {
    pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
  } catch {
    io.stderr("Warning: Could not read package.json, using defaults\n");
    return { name: "unknown", version: "0.0.0" };
  }
  if (!isJsonObject(pkg)) {
    io.stderr("Warning: package.json is not a JSON object, using defaults\n");
    return { name: "unknown", version: "0.0.0" };
  }
  return pkg as unknown as PackageJson;
}

/** Runs `repo-tools depgraph` and returns the exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  if (wantsHelp(argv)) {
    io.stdout(DEPGRAPH_HELP);
    return 0;
  }
  // Design criterion 4: standard error shows the root as `<root>`, never as an absolute path.
  let root: string | undefined;
  const stderr = (text: string): void => io.stderr(root ? maskRoot(text, root) : text);
  try {
    const options = parseDepgraphArgs(argv, process.cwd());
    // `--strict-orphans` is the command-line form of `depgraph.strictOrphans`.
    if (options.strictOrphans) options.settings.strictOrphans = true;
    root = resolve(options.root);
    // Before any read or write: a missing root must not get an output folder.
    if (!isDirectory(root)) throw new Error("the root <root> is not an existing directory");
    const config = mergeDepgraphConfig(options.settings, loadConfigFile(root, options.config));
    setWalkSkip([...config.exclude, ...config.alsoExclude]);
    const sinks: Io = { stdout: io.stdout, stderr };
    if (options.writeDuplicateBaseline) return writeDuplicateBaseline(root, config, sinks);
    if (options.checkDuplicates) return checkDuplicates(options, config, sinks);
    return runPipeline(options, config, sinks);
  } catch (err) {
    stderr(`repo-tools depgraph: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  } finally {
    setWalkSkip();
  }
}

/** `<root>/<rel>` with forward slashes: the form of a path in a message. */
function shown(rel: string): string {
  return `<root>/${rel.replace(/\\/g, "/")}`;
}

/**
 * Reads and parses the JSON file `rel` (relative to the root). Throws when the file does not
 * exist (the text then ends with `missingHint`), cannot be read or is not valid JSON.
 */
function readJsonFile(root: string, rel: string, what: string, missingHint: string): unknown {
  const path = resolveUnderRoot(root, rel);
  if (!isFile(path)) throw new Error(`the ${what} ${shown(rel)} does not exist; ${missingHint}`);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`the ${what} ${shown(rel)} cannot be read`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`the ${what} ${shown(rel)} is not valid JSON`);
  }
}

/** The root-relative path of duplicate-symbols.json in the output folder of `config`. */
function duplicateReportPath(config: DepgraphConfig): string {
  return `${config.out.replace(/[\\/]+$/, "")}/duplicate-symbols.json`;
}

/** Reads the duplicate-symbols.json of the output folder. Throws when it is missing or bad. */
function readDuplicateReport(root: string, config: DepgraphConfig): DuplicateEntries {
  const rel = duplicateReportPath(config);
  const parsed = readJsonFile(root, rel, "duplicate report", "run repo-tools depgraph first");
  const entries = asDuplicateEntries(parsed);
  if (!entries) throw new Error(`the duplicate report ${shown(rel)} has an unknown shape`);
  return entries;
}

/** `1 TRUE_DUPLICATE name` or `N TRUE_DUPLICATE names`. */
function namesLabel(count: number): string {
  return `${count} TRUE_DUPLICATE name${count === 1 ? "" : "s"}`;
}

/**
 * `--check-duplicates`: exit 1 on a TRUE_DUPLICATE name that the baseline does not hold. The
 * baseline is read first, so a missing baseline stops the run before it writes. Without
 * `--no-regen` the pipeline then writes every report, and the gate reads the fresh
 * duplicate-symbols.json. With `--no-regen` the gate reads the committed report and writes
 * nothing. A missing baseline exits 1: the source gate also stops when it cannot read it.
 */
function checkDuplicates(options: DepgraphOptions, config: DepgraphConfig, io: Io): number {
  const root = resolve(options.root);
  const baselineRel = config.duplicateBaseline;
  const baseline = asBaselineNames(
    readJsonFile(
      root,
      baselineRel,
      "duplicate baseline",
      "write it with repo-tools depgraph --write-duplicate-baseline",
    ),
  );
  if (!baseline) {
    throw new Error(`the duplicate baseline ${shown(baselineRel)} has an unknown shape`);
  }
  if (!options.noRegen) {
    const code = runPipeline(options, config, io);
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
  const noun = found.length === 1 ? "name" : "names";
  const lines = [
    `duplicate check FAILED: ${found.length} new TRUE_DUPLICATE ${noun} not in ${shown(baselineRel)}:`,
  ];
  for (const f of found) {
    lines.push(`  [${f.kind}] ${f.name}`);
    for (const file of f.files) lines.push(`    - ${file}`);
  }
  lines.push(
    "Reuse one definition, or add the name to the duplicate allowlist. To accept the name " +
      "after review, run repo-tools depgraph --write-duplicate-baseline.",
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

/** The pipeline. Returns the exit code. */
function runPipeline(options: DepgraphOptions, config: DepgraphConfig, io: Io): number {
  const log = (line: string): void => io.stdout(`${line}\n`);
  const root = resolve(options.root);
  const outputDir = resolveUnderRoot(root, config.out);
  const outRel = relativePosix(root, outputDir) || ".";
  const out = (name: string): string => `${outRel}/${name}`;
  const strictOrphans = config.strictOrphans;
  const banner: BannerOptions = {
    command: config.regenerateCommand,
    marker: config.verificationMarker,
  };
  // Every report ends with exactly one LF (rule R1).
  const write = (name: string, text: string): void => writeReport(join(outputDir, name), text);
  // Fix F34: the walks record each link that they do not follow; this run starts a new list.
  linkLog.skipped.clear();

  if (options.checkCensus) {
    const failure = checkCensusNoRegen(root, outputDir, strictOrphans);
    logSkippedLinks(log, skippedLinks(root));
    if (failure) {
      io.stderr(failure);
      return 1;
    }
    log("file-census check passed (no-regen): committed inventory matches the repo.");
    return 0;
  }

  // The API-surface entry must exist before the run writes anything (design section 6.2).
  const apiEntry = config.apiSurface.entry.replace(/\\/g, "/");
  if (config.apiSurface.out !== null && !isFile(resolveUnderRoot(root, apiEntry))) {
    io.stderr(`repo-tools depgraph: the --api-entry file <root>/${apiEntry} does not exist\n`);
    return 1;
  }

  const warn = (message: string): void => io.stderr(`Warning: ${message}\n`);
  const workspaces = detectWorkspaces(root, warn);
  const isMonorepo = workspaces.size > 0;
  // Ruling (c) of D10a: in monorepo mode the workspace source folders are the roots. The run
  // stops before it writes, because an ignored `--src` hides a typing error.
  if (isMonorepo && config.src !== "auto") {
    io.stderr(
      "repo-tools depgraph: --src (depgraph.src) applies to single-package repos; " +
        "this root is a workspace\n",
    );
    return 1;
  }

  const packageJson = readPackageJson(root, io);

  // Scan.
  log("Scanning codebase for dependencies...");
  if (options.includeTests) log("note: --include-tests is a no-op; test analysis is always on.");
  // Fix M1: in single-package mode the root package.json names the extra build roots.
  const rootEntries = isMonorepo ? [] : rootPackageEntries(root, warn);
  // Fix F43: in single-package mode an import of the package's own name resolves to its source.
  // `resolveWorkspaces` holds the root package then; the mode checks keep using `workspaces`.
  const self = isMonorepo ? undefined : selfPackage(root);
  const resolveWorkspaces = self ? new Map([[self.name, self]]) : workspaces;
  if (isMonorepo) {
    log(`Monorepo detected: ${workspaces.size} workspace packages`);
    for (const [name, ws] of workspaces) log(`  - ${name} (${ws.directory}/)`);
    if (options.all) log("Including dormant/unreachable files (--all)");
  }
  // In single-package mode `depgraph.src` (or `--src`) names the source roots; "auto" finds them.
  const sourceDirs = isMonorepo
    ? []
    : config.src === "auto"
      ? resolveSourceDirs(root)
      : config.src.map((dir) => resolveUnderRoot(root, dir));
  // The scan lines wait until the file count is known: with zero files the run makes no output
  // folder, and with files the "Created" line keeps its place before them.
  const scanLines: string[] = [];
  const tsFiles: string[] = [];
  if (isMonorepo) {
    for (const [, ws] of workspaces) {
      const pkgFiles = getAllTsFiles(join(root, ws.srcDir));
      tsFiles.push(...pkgFiles);
      scanLines.push(`  ${ws.directory}/src: ${pkgFiles.length} files`);
    }
  } else {
    for (const dir of sourceDirs) {
      const found = getAllTsFiles(dir);
      tsFiles.push(...found);
      scanLines.push(`  ${relativePosix(root, dir) || "."}: ${found.length} files`);
    }
  }
  scanLines.push(`Found ${tsFiles.length} TypeScript files total`);
  if (tsFiles.length > 0 && !existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
    log(`Created output directory: ${outRel}`);
  }
  for (const line of scanLines) log(line);
  if (tsFiles.length === 0) {
    io.stderr("No TypeScript files found\n");
    return 1;
  }

  // Parse.
  const parseCtx = { root, workspaces: resolveWorkspaces };
  const parsedFiles = tsFiles.map((f) => parseFile(parseCtx, f));
  log("Parsed all files");

  // Analyze. Fix M1: reachability and dormancy run in both modes. The monorepo graph holds the
  // reachable files (`--all` widens it). The single-package graph holds every file, and the
  // dormancy is reported (`--reachable-only` restricts it).
  const entryPoints = collectEntryPoints(root, workspaces, parsedFiles, rootEntries);
  log(`Entry points: ${entryPoints.length}`);
  const censusRoots = new Set(entryPoints);
  const reachableSet = findReachableFiles(entryPoints, parsedFiles, resolveWorkspaces);
  const dormantSet = new Set(
    parsedFiles.filter((f) => !reachableSet.has(f.path)).map((f) => f.path),
  );
  log(`Reachable files: ${reachableSet.size}`);
  log(`Dormant files: ${dormantSet.size}`);
  let activeParsedFiles = parsedFiles;
  if (options.reachableOnly || (isMonorepo && !options.all)) {
    activeParsedFiles = parsedFiles.filter((f) => reachableSet.has(f.path));
    log(
      options.reachableOnly
        ? `Analyzing ${activeParsedFiles.length} reachable files (--reachable-only)`
        : `Analyzing ${activeParsedFiles.length} reachable files (use --all to include dormant)`,
    );
  } else if (isMonorepo) {
    log(`Analyzing all ${activeParsedFiles.length} files (including dormant)`);
  } else {
    log(
      `Analyzing all ${activeParsedFiles.length} files (dormancy reported; use --reachable-only to restrict)`,
    );
  }

  const modules = categorizeFiles(activeParsedFiles, isMonorepo, workspaces);
  log(`Categorized into ${Object.keys(modules).length} modules`);
  const cycles = detectCyclicComponents(activeParsedFiles);
  log(
    `Found ${componentsLabel(cycles.runtime.length + cycles.typeOnly.length)} ` +
      `(${cycles.runtime.length} runtime, ${cycles.typeOnly.length} type-only)`,
  );

  const testFilePaths: string[] = [];
  const pushTestDirs = (base: string): void => {
    for (const name of config.tests) testFilePaths.push(...getAllTestFiles(join(base, name)));
  };
  if (isMonorepo) {
    for (const [, ws] of workspaces) {
      pushTestDirs(join(root, ws.directory));
      testFilePaths.push(...getAllTestFiles(join(root, ws.srcDir)));
    }
    pushTestDirs(root);
  } else {
    pushTestDirs(root);
    // The tests inside the source roots: `src/` by default, else each configured root.
    const testRoots = config.src === "auto" ? [srcDirOf(root)] : sourceDirs;
    for (const dir of testRoots) testFilePaths.push(...getAllTestFiles(dir));
  }
  const parsedTestFiles: ParsedFile[] = [...new Set(testFilePaths)].map((f) =>
    parseFile(parseCtx, f),
  );

  const unusedAnalysis = detectUnused(
    activeParsedFiles,
    parsedTestFiles,
    root,
    resolveWorkspaces,
    rootEntries,
  );
  const stats = generateStatistics(activeParsedFiles, modules, cycles, unusedAnalysis, root);
  log("Generated statistics");
  const matrix = buildDependencyMatrix(activeParsedFiles);
  log("Built dependency matrix");

  // Report.
  const json = generateJSON(activeParsedFiles, modules, stats, cycles, packageJson);
  let markdown = generateMarkdown(activeParsedFiles, modules, stats, cycles, matrix, packageJson);
  if (isMonorepo) {
    markdown = insertPackageSection(
      markdown,
      generatePackageDependencySection(parsedFiles, workspaces, reachableSet, dormantSet),
    );
  }

  write("dependency-graph.json", dependencyGraphJsonText(json));
  log(`Written: ${out("dependency-graph.json")}`);
  write("dependency-graph.yaml", generateYaml(json));
  log(`Written: ${out("dependency-graph.yaml")}`);
  write("DEPENDENCY_GRAPH.md", withBanner(markdown, banner));
  log(`Written: ${out("DEPENDENCY_GRAPH.md")}`);
  const compactSummary = generateCompactSummary(
    activeParsedFiles,
    modules,
    stats,
    cycles,
    packageJson,
  );
  write("dependency-summary.compact.json", compactSummary);
  const compactKb = (Buffer.byteLength(withOneLf(compactSummary), "utf8") / 1024).toFixed(1);
  log(`Written: ${out("dependency-summary.compact.json")} (${compactKb}KB)`);
  // One public surface for the whole run: the export surfaces (fix F15) and the duplicate
  // detector read it. A per-module surface misses a file that a root in another module
  // re-exports.
  const publicSurface = computePublicSurface(activeParsedFiles, root, workspaces, rootEntries);
  write("package-export-surfaces.json", generateSurfacesJson(modules, publicSurface));
  log(`Written: ${out("package-export-surfaces.json")}`);

  const dup = detectDuplicateSymbols(
    activeParsedFiles,
    publicSurface,
    root,
    resolveUnderRoot(root, config.duplicateAllowlist),
  );
  const duplicateReport = buildDuplicateReport(dup);
  write("duplicate-symbols.json", generateDuplicateSymbolsJson(duplicateReport));
  write(
    "duplicate-symbols.md",
    withBanner(generateDuplicateSymbolsMarkdown(duplicateReport), banner),
  );
  log(
    `Written: ${out("duplicate-symbols.md")} ` +
      `(${duplicateReport.summary.runtimeDuplicates} runtime TRUE_DUPLICATE / ` +
      `${dup.runtime.length} runtime flagged, ` +
      `${duplicateReport.summary.typeDuplicates} type TRUE_DUPLICATE / ` +
      `${dup.types.length} type flagged)`,
  );

  log("\nAnalyzing test coverage...");
  log(`Found ${testFilePaths.length} test files`);
  const testCoverage: TestCoverageAnalysis = analyzeTestCoverage(
    activeParsedFiles,
    parsedTestFiles,
    root,
    resolveUnderRoot(root, config.coveragePolicy),
  );
  // The Markdown report first: the JSON report sorts the file lists in place.
  write("TEST_COVERAGE.md", withBanner(generateTestCoverageMarkdown(testCoverage), banner));
  log(`Written: ${out("TEST_COVERAGE.md")}`);
  const coverageJson = generateTestCoverageJson(testCoverage);
  write("test-coverage.json", JSON.stringify(coverageJson, null, 2));
  log(`Written: ${out("test-coverage.json")}`);

  if (config.apiSurface.out !== null) {
    const apiOut = resolveUnderRoot(root, config.apiSurface.out);
    const surface = writeApiSurface(root, apiEntry, apiOut, parsedFiles, config);
    log(
      `Written: ${relativePosix(root, apiOut)} ` +
        `(${surface.symbols.length} surface symbols, ${surface.unresolved.length} unresolved)`,
    );
  }

  logSummary(log, {
    isMonorepo,
    workspaceCount: workspaces.size,
    reachable: reachableSet.size,
    dormant: dormantSet.size,
    stats,
    unusedFiles: unusedAnalysis.unusedFiles,
    unusedExports: unusedAnalysis.unusedExports,
  });

  const dormant = splitDormant(dormantSet, parsedFiles, parsedTestFiles, resolveWorkspaces);
  write(
    "unused-analysis.md",
    withBanner(generateUnusedReport(unusedAnalysis, dormant, workspaces), banner),
  );
  log(`\nWritten: ${out("unused-analysis.md")}`);

  // Gate: the census and its self-check, in both modes (fix M1).
  const inventory = buildFileInventory(
    root,
    workspaces,
    censusRoots,
    reachableSet,
    dormant.testReachable,
    isMonorepo ? undefined : sourceDirs,
  );
  // The self-check runs before the write: its maximal walk can meet more links (fix F34).
  const failure = censusFailure(root, inventory, strictOrphans, options.strictCensus);
  inventory.skippedLinks = skippedLinks(root);
  write("file-inventory.json", generateFileInventoryJson(inventory));
  write("FILE_INVENTORY.md", withBanner(generateFileInventoryMarkdown(inventory), banner));
  log(
    `Written: ${out("FILE_INVENTORY.md")} (${inventory.totalFiles} files: ` +
      Object.entries(inventory.byDisposition)
        .map(([k, v]) => `${v} ${k}`)
        .join(", ") +
      ")",
  );
  logSkippedLinks(log, inventory.skippedLinks);
  if (failure) {
    io.stderr(failure);
    return 1;
  }
  // Fix M1: without `--strict-orphans` an orphan gives a warning, not a failure.
  const orphanWarning = censusOrphanWarning(inventory);
  if (orphanWarning) io.stderr(orphanWarning);
  // Fix F42: without `--strict-census` a census gap gives a warning, not a failure.
  const gapWarning = options.strictCensus ? null : censusGapWarning(root, inventory);
  if (gapWarning) io.stderr(gapWarning);
  else log(censusPassLine(inventory));

  // The pre-port WASM, parallel and WebGPU pairing reports ran here (see the module comment).

  const coveragePercent =
    testCoverage.sourceFiles.length > 0
      ? ((testCoverage.testedFiles.length / testCoverage.sourceFiles.length) * 100).toFixed(1)
      : "0";
  log("\n=== Test Coverage Analysis ===");
  log(`  - ${testCoverage.testFiles.length} test files analyzed`);
  log(
    `  - ${testCoverage.testedFiles.length}/${testCoverage.sourceFiles.length} source files have tests (${coveragePercent}%)`,
  );
  log(`  - ${testCoverage.untestedFiles.length} source files without tests`);
  if (testCoverage.untestedFiles.length > 0) {
    log("\nSource files without test coverage:");
    for (const file of testCoverage.untestedFiles.slice(0, 15)) log(`  - ${file}`);
    if (testCoverage.untestedFiles.length > 15) {
      log(
        `  ... and ${testCoverage.untestedFiles.length - 15} more (see TEST_COVERAGE.md for full list)`,
      );
    }
  }
  return 0;
}

/** True when `path` is an existing directory. */
function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

/** True when `path` is an existing file. */
function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

/**
 * Writes the per-export facts report (design section 6.2) of the entry `entry` to `outPath`, and
 * returns the surface. The `files` array holds every file of the graph walk (`parsedFiles`).
 */
function writeApiSurface(
  root: string,
  entry: string,
  outPath: string,
  parsedFiles: readonly ParsedFile[],
  config: DepgraphConfig,
): Surface {
  const load = (p: string): string | null => {
    const abs = join(root, p);
    return isFile(abs) ? readFileSync(abs, "utf-8") : null;
  };
  const resolver = createTsResolver((p) => load(p) !== null);
  const opts = { stabilityTags: config.apiSurface.stabilityTags };
  const surface = resolveSurface(entry, load, resolver, opts);
  const files = parsedFiles.map((f) => ({
    path: f.path,
    exports: extractExportDetails(load(f.path) ?? "", opts),
  }));
  const report = buildApiSurfaceReport(surface, files, config.apiSurface.stabilityTags);
  writeReport(outPath, JSON.stringify(report, null, 2));
  return surface;
}

/** The links that the walks of this run did not follow, root-relative and sorted (fix F34). */
function skippedLinks(root: string): string[] {
  return sortCodeUnits([...linkLog.skipped].map((p) => relativePosix(root, p)));
}

/** Lists the skipped links on standard output (fix F34). Writes nothing when there is none. */
function logSkippedLinks(log: (line: string) => void, links: string[]): void {
  if (links.length === 0) return;
  log(`Skipped ${links.length} link${links.length === 1 ? "" : "s"} (not followed):`);
  for (const link of links) log(`  - ${link}`);
}

/** `N cyclic component` or `N cyclic components` (fix F26). */
function componentsLabel(count: number): string {
  return `${count} cyclic component${count === 1 ? "" : "s"}`;
}

/** The completion summary of a run, on standard output. */
function logSummary(
  log: (line: string) => void,
  s: {
    isMonorepo: boolean;
    workspaceCount: number;
    reachable: number;
    dormant: number;
    stats: Statistics;
    unusedFiles: string[];
    unusedExports: UnusedExport[];
  },
): void {
  log("\nDependency graph generation complete!");
  if (s.isMonorepo) log(`  - ${s.workspaceCount} workspace packages scanned`);
  log(`  - ${s.reachable} reachable files, ${s.dormant} dormant files`);
  log(`  - ${s.stats.totalTypeScriptFiles} files analyzed`);
  log(`  - ${s.stats.totalExports} exports found (${s.stats.totalReExports} re-exports)`);
  log(`  - ${s.stats.totalTypeOnlyImports} type-only imports detected`);
  const st = s.stats;
  log(`  - ${componentsLabel(st.runtimeCyclicComponents + st.typeOnlyCyclicComponents)}:`);
  log(
    `      ${st.runtimeCyclicComponents} runtime, ${st.runtimeFilesInCycles} files (require attention)`,
  );
  log(`      ${st.typeOnlyCyclicComponents} type-only, ${st.typeOnlyFilesInCycles} files (safe)`);
  log(`  - ${s.unusedFiles.length} potentially unused files`);
  log(`  - ${s.unusedExports.length} potentially unused exports`);
  if (s.unusedFiles.length > 0) {
    log("\nPotentially unused files:");
    for (const file of s.unusedFiles.slice(0, 20)) log(`  - ${file}`);
    if (s.unusedFiles.length > 20) log(`  ... and ${s.unusedFiles.length - 20} more`);
  }
  if (s.unusedExports.length > 0) {
    log("\nPotentially unused exports:");
    const byFile = new Map<string, UnusedExport[]>();
    for (const exp of s.unusedExports) {
      const list = byFile.get(exp.file) ?? [];
      list.push(exp);
      byFile.set(exp.file, list);
    }
    let shown = 0;
    for (const [file, exports] of byFile) {
      if (shown >= 10) {
        log(`  ... and ${byFile.size - 10} more files with unused exports`);
        break;
      }
      log(`  ${file}:`);
      for (const exp of exports.slice(0, 5)) log(`    - ${exp.name} (${exp.type})`);
      if (exports.length > 5) log(`    ... and ${exports.length - 5} more`);
      shown++;
    }
  }
}
