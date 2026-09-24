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
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
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
import { analyzeTestCoverage, type TestCoverageAnalysis } from "./coverage.ts";
import { detectCyclicComponents } from "./cycles.ts";
import { linkLog } from "./dirlist.ts";
import { buildDuplicateReport, detectDuplicateSymbols } from "./duplicates.ts";
import {
  buildFileInventory,
  censusFailure,
  censusOrphanWarning,
  censusPassLine,
  checkCensusNoRegen,
} from "./inventory.ts";
import { parseFile } from "./parser.ts";
import { OUTPUT_SUBDIR, outputDirOf, relativePosix, srcDirOf } from "./paths.ts";
import { withBanner } from "./reporters/banner.ts";
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
import { collectEntryPoints, isJsonObject, rootPackageEntries } from "./roots.ts";
import { getAllTestFiles, getAllTsFiles, resolveSourceDirs, TEST_DIR_NAMES } from "./scanner.ts";
import type { PackageJson, ParsedFile, Statistics, UnusedExport } from "./types.ts";
import { detectWorkspaces } from "./workspaces.ts";

/** The help text of `repo-tools depgraph`. */
export const DEPGRAPH_HELP = `Usage: repo-tools depgraph [options] [project-root]

Write the dependency graph and the architecture reports of a TypeScript tree into
<root>/${OUTPUT_SUBDIR}.

Options:
  --root=<path>        Project root (default: the current directory). A first
                       argument that is an existing path also sets the root.
  --all, -a            Monorepo mode: include dormant and unreachable files.
  --reachable-only     Restrict the graph to the files reachable from a root.
                       Single-package mode analyzes all files by default.
  --strict-orphans     Exit 1 when an orphaned source file exists. Without it,
                       an orphan gives a warning.
  --include-tests, -t  No operation. Kept for compatibility: the test coverage
                       reports are always written.
  --check-census       Check the committed file-inventory.json against a fresh
                       walk of the root. Write nothing. Exit 1 on a difference.
  --help, -h           Show this help.

Exit codes: 0 on success. 1 when no TypeScript file is found, when the census
self-check fails, when an orphan exists with --strict-orphans, or when
--check-census fails.
`;

/** The parsed command line. */
export interface DepgraphOptions {
  root: string;
  includeTests: boolean;
  all: boolean;
  /** Fix M1: restrict the graph to reachable files (single-package mode too). */
  reachableOnly: boolean;
  /** Fix M1: an orphan fails the census self-check. */
  strictOrphans: boolean;
  checkCensus: boolean;
  help: boolean;
}

/**
 * Parses the depgraph arguments as the pre-port generator did: unknown flags are ignored, and
 * a non-flag argument that exists on disk sets the root.
 */
export function parseDepgraphArgs(argv: readonly string[], cwd: string): DepgraphOptions {
  const options: DepgraphOptions = {
    root: cwd,
    includeTests: false,
    all: false,
    reachableOnly: false,
    strictOrphans: false,
    checkCensus: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg.startsWith("--root=")) options.root = arg.slice(7);
    else if (arg === "--include-tests" || arg === "-t") options.includeTests = true;
    else if (arg === "--all" || arg === "-a") options.all = true;
    else if (arg === "--reachable-only") options.reachableOnly = true;
    else if (arg === "--strict-orphans") options.strictOrphans = true;
    else if (arg === "--check-census") options.checkCensus = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (!arg.startsWith("-") && existsSync(arg)) options.root = arg;
  }
  return options;
}

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
  const options = parseDepgraphArgs(argv, process.cwd());
  if (options.help) {
    io.stdout(DEPGRAPH_HELP);
    return 0;
  }
  try {
    return runPipeline(options, io);
  } catch (err) {
    io.stderr(`repo-tools depgraph: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

/** The pipeline. Returns the exit code. */
function runPipeline(options: DepgraphOptions, io: Io): number {
  const log = (line: string): void => io.stdout(`${line}\n`);
  const root = resolve(options.root);
  const outputDir = outputDirOf(root);
  const out = (name: string): string => `${OUTPUT_SUBDIR}/${name}`;
  // Every report ends with exactly one LF (rule R1).
  const write = (name: string, text: string): void => writeReport(join(outputDir, name), text);
  // Fix F34: the walks record each link that they do not follow; this run starts a new list.
  linkLog.skipped.clear();

  if (options.checkCensus) {
    const failure = checkCensusNoRegen(root, outputDir, options.strictOrphans);
    logSkippedLinks(log, skippedLinks(root));
    if (failure) {
      io.stderr(failure);
      return 1;
    }
    log("file-census check passed (no-regen): committed inventory matches the repo.");
    return 0;
  }

  const packageJson = readPackageJson(root, io);

  // Scan.
  log("Scanning codebase for dependencies...");
  if (options.includeTests) log("note: --include-tests is a no-op; test analysis is always on.");
  const warn = (message: string): void => io.stderr(`Warning: ${message}\n`);
  const workspaces = detectWorkspaces(root, warn);
  const isMonorepo = workspaces.size > 0;
  // Fix M1: in single-package mode the root package.json names the extra build roots.
  const rootEntries = isMonorepo ? [] : rootPackageEntries(root, warn);
  if (isMonorepo) {
    log(`Monorepo detected: ${workspaces.size} workspace packages`);
    for (const [name, ws] of workspaces) log(`  - ${name} (${ws.directory}/)`);
    if (options.all) log("Including dormant/unreachable files (--all)");
  }
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
    log(`Created output directory: ${OUTPUT_SUBDIR}`);
  }
  const tsFiles: string[] = [];
  if (isMonorepo) {
    for (const [, ws] of workspaces) {
      const pkgFiles = getAllTsFiles(join(root, ws.srcDir));
      tsFiles.push(...pkgFiles);
      log(`  ${ws.directory}/src: ${pkgFiles.length} files`);
    }
  } else {
    for (const dir of resolveSourceDirs(root)) {
      const found = getAllTsFiles(dir);
      tsFiles.push(...found);
      log(`  ${relative(root, dir) || "."}: ${found.length} files`);
    }
  }
  log(`Found ${tsFiles.length} TypeScript files total`);
  if (tsFiles.length === 0) {
    io.stderr("No TypeScript files found\n");
    return 1;
  }

  // Parse.
  const parseCtx = { root, workspaces };
  const parsedFiles = tsFiles.map((f) => parseFile(parseCtx, f));
  log("Parsed all files");

  // Analyze. Fix M1: reachability and dormancy run in both modes. The monorepo graph holds the
  // reachable files (`--all` widens it). The single-package graph holds every file, and the
  // dormancy is reported (`--reachable-only` restricts it).
  const entryPoints = collectEntryPoints(root, workspaces, parsedFiles, rootEntries);
  log(`Entry points: ${entryPoints.length}`);
  const censusRoots = new Set(entryPoints);
  const reachableSet = findReachableFiles(entryPoints, parsedFiles, workspaces);
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
    for (const name of TEST_DIR_NAMES) testFilePaths.push(...getAllTestFiles(join(base, name)));
  };
  if (isMonorepo) {
    for (const [, ws] of workspaces) {
      pushTestDirs(join(root, ws.directory));
      testFilePaths.push(...getAllTestFiles(join(root, ws.srcDir)));
    }
    pushTestDirs(root);
  } else {
    pushTestDirs(root);
    testFilePaths.push(...getAllTestFiles(srcDirOf(root)));
  }
  const parsedTestFiles: ParsedFile[] = [...new Set(testFilePaths)].map((f) =>
    parseFile(parseCtx, f),
  );

  const unusedAnalysis = detectUnused(
    activeParsedFiles,
    parsedTestFiles,
    root,
    workspaces,
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
  write("DEPENDENCY_GRAPH.md", withBanner(markdown));
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

  const dup = detectDuplicateSymbols(activeParsedFiles, publicSurface, root);
  const duplicateReport = buildDuplicateReport(dup);
  write("duplicate-symbols.json", generateDuplicateSymbolsJson(duplicateReport));
  write("duplicate-symbols.md", withBanner(generateDuplicateSymbolsMarkdown(duplicateReport)));
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
  );
  // The Markdown report first: the JSON report sorts the file lists in place.
  write("TEST_COVERAGE.md", withBanner(generateTestCoverageMarkdown(testCoverage)));
  log(`Written: ${out("TEST_COVERAGE.md")}`);
  const coverageJson = generateTestCoverageJson(testCoverage);
  write("test-coverage.json", JSON.stringify(coverageJson, null, 2));
  log(`Written: ${out("test-coverage.json")}`);

  logSummary(log, {
    isMonorepo,
    workspaceCount: workspaces.size,
    reachable: reachableSet.size,
    dormant: dormantSet.size,
    stats,
    unusedFiles: unusedAnalysis.unusedFiles,
    unusedExports: unusedAnalysis.unusedExports,
  });

  const dormant = splitDormant(dormantSet, parsedFiles, parsedTestFiles, workspaces);
  write(
    "unused-analysis.md",
    withBanner(generateUnusedReport(unusedAnalysis, dormant, workspaces)),
  );
  log(`\nWritten: ${out("unused-analysis.md")}`);

  // Gate: the census and its self-check, in both modes (fix M1).
  const inventory = buildFileInventory(
    root,
    workspaces,
    censusRoots,
    reachableSet,
    dormant.testReachable,
  );
  // The self-check runs before the write: its maximal walk can meet more links (fix F34).
  const failure = censusFailure(root, inventory, options.strictOrphans);
  inventory.skippedLinks = skippedLinks(root);
  write("file-inventory.json", generateFileInventoryJson(inventory));
  write("FILE_INVENTORY.md", withBanner(generateFileInventoryMarkdown(inventory)));
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
  log(censusPassLine(inventory));

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
