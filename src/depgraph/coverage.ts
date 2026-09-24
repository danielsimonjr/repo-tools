/**
 * Test coverage by direct import: which source files the test files import, directly or through
 * barrel re-exports, and the optional coverage policy that marks files as intentionally untested.
 *
 * Port note: a side-effect edge does not carry coverage through a chain (fix F10).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePath } from "./resolver.ts";
import type { ParsedFile } from "./types.ts";

/** One category of the coverage policy. */
export interface CoveragePolicyCategory {
  label: string;
  rationale: string;
  pathPrefixes?: string[];
  exactPaths?: string[];
}

/** The coverage policy file (`coverage-policy.json` in the output directory). */
export interface CoveragePolicy {
  description?: string;
  updated?: string;
  categories: Record<string, CoveragePolicyCategory>;
}

/** One untested file and its policy category (null: a real gap). */
export type ClassifiedUntested = { file: string; category: string | null };

/** The untested files by policy category, and the effective coverage. */
export interface CategoryBreakdown {
  /** Count by category id. `active_untested` counts the files that match no category. */
  byCategory: Record<string, number>;
  /** Source files that match a category. */
  excludedTotal: number;
  /** Source files that match no category. */
  activeFiles: number;
  /** Tested files that match no category. */
  testedActive: number;
  /** `testedActive / activeFiles` in percent, one decimal place. */
  effectivePercent: string;
  classifiedUntested: ClassifiedUntested[];
}

/** The coverage result of one run. */
export interface TestCoverageAnalysis {
  sourceFiles: string[];
  testFiles: ParsedFile[];
  /** Source file to the test files that cover it. */
  coverageMap: Map<string, string[]>;
  testedFiles: string[];
  untestedFiles: string[];
  /** Test file to the source files it covers. */
  testToSourceMap: Map<string, string[]>;
  policy: CoveragePolicy | null;
  policyBreakdown: CategoryBreakdown;
}

/** Barrel file to the source files it re-exports, chains expanded. */
export type ReExportMap = Map<string, Set<string>>;

/**
 * Reads `<root>/docs/architecture/coverage-policy.json`. Returns null when the file is absent,
 * not valid JSON, or has no `categories` object.
 */
export function loadCoveragePolicy(root: string): CoveragePolicy | null {
  const policyPath = join(root, "docs", "architecture", "coverage-policy.json");
  if (!existsSync(policyPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(policyPath, "utf8")) as CoveragePolicy;
    if (!parsed.categories || typeof parsed.categories !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The policy category of `filePath`: an `exactPaths` match first, then a `pathPrefixes` match.
 * Returns null when nothing matches or there is no policy.
 */
export function classifyAgainstPolicy(
  filePath: string,
  policy: CoveragePolicy | null,
): string | null {
  if (!policy) return null;
  for (const [categoryId, cat] of Object.entries(policy.categories)) {
    if (cat.exactPaths?.includes(filePath)) return categoryId;
  }
  for (const [categoryId, cat] of Object.entries(policy.categories)) {
    for (const prefix of cat.pathPrefixes ?? []) {
      if (filePath.startsWith(prefix)) return categoryId;
    }
  }
  return null;
}

/** Classifies the untested files and computes the effective coverage over the active files. */
export function buildCategoryBreakdown(
  sourceFiles: string[],
  testedFiles: string[],
  untestedFiles: string[],
  policy: CoveragePolicy | null,
): CategoryBreakdown {
  const byCategory: Record<string, number> = {};
  if (policy) {
    for (const id of Object.keys(policy.categories)) byCategory[id] = 0;
  }
  byCategory.active_untested = 0;
  const classifiedUntested: ClassifiedUntested[] = [];
  for (const f of untestedFiles) {
    const cat = classifyAgainstPolicy(f, policy);
    if (cat) byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    else byCategory.active_untested = (byCategory.active_untested ?? 0) + 1;
    classifiedUntested.push({ file: f, category: cat });
  }
  let excludedTotal = 0;
  let testedExcluded = 0;
  const testedSet = new Set(testedFiles);
  for (const f of sourceFiles) {
    if (classifyAgainstPolicy(f, policy)) {
      excludedTotal++;
      if (testedSet.has(f)) testedExcluded++;
    }
  }
  const activeFiles = sourceFiles.length - excludedTotal;
  const testedActive = testedFiles.length - testedExcluded;
  const effectivePercent = activeFiles > 0 ? ((testedActive / activeFiles) * 100).toFixed(1) : "0";
  return {
    byCategory,
    excludedTotal,
    activeFiles,
    testedActive,
    effectivePercent,
    classifiedUntested,
  };
}

/** Maps each barrel file to the source files it re-exports, with chains expanded. */
export function buildReExportMap(sourceFiles: ParsedFile[]): ReExportMap {
  const reExportMap: ReExportMap = new Map();
  const sourceFilePaths = new Set(sourceFiles.map((f) => f.path));
  for (const file of sourceFiles) {
    const reExportedSources = new Set<string>();
    for (const dep of file.internalDependencies) {
      if (!dep.reExport) continue;
      const resolved = resolvePath(file.path, dep.file);
      if (sourceFilePaths.has(resolved)) reExportedSources.add(resolved);
    }
    if (reExportedSources.size > 0) reExportMap.set(file.path, reExportedSources);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [barrelPath, sources] of reExportMap) {
      const expanded = new Set(sources);
      for (const source of sources) {
        for (const nested of reExportMap.get(source) ?? []) {
          if (!expanded.has(nested)) {
            expanded.add(nested);
            changed = true;
          }
        }
      }
      reExportMap.set(barrelPath, expanded);
    }
  }
  return reExportMap;
}

/** The imported file and every source file that it re-exports. */
export function traceReExports(importedPath: string, reExportMap: ReExportMap): Set<string> {
  const result = new Set<string>([importedPath]);
  for (const source of reExportMap.get(importedPath) ?? []) result.add(source);
  return result;
}

/**
 * Maps the source files to the test files that import them, directly or through barrel
 * re-exports, and applies the coverage policy of `root`.
 */
export function analyzeTestCoverage(
  sourceFiles: ParsedFile[],
  testFiles: ParsedFile[],
  root: string,
): TestCoverageAnalysis {
  const sourceFilePaths = new Set(sourceFiles.map((f) => f.path));
  const coverageMap = new Map<string, string[]>();
  const testToSourceMap = new Map<string, string[]>();
  const reExportMap = buildReExportMap(sourceFiles);
  for (const source of sourceFiles) coverageMap.set(source.path, []);

  const addCoverage = (sourcePath: string, testPath: string, importedSources: string[]): void => {
    if (!importedSources.includes(sourcePath)) importedSources.push(sourcePath);
    const tests = coverageMap.get(sourcePath) || [];
    if (!tests.includes(testPath)) {
      tests.push(testPath);
      coverageMap.set(sourcePath, tests);
    }
  };
  const addTraced = (path: string, testPath: string, importedSources: string[]): void => {
    addCoverage(path, testPath, importedSources);
    for (const reExportedPath of traceReExports(path, reExportMap)) {
      if (sourceFilePaths.has(reExportedPath)) {
        addCoverage(reExportedPath, testPath, importedSources);
      }
    }
  };

  for (const testFile of testFiles) {
    const importedSources: string[] = [];
    for (const dep of testFile.internalDependencies) {
      const resolvedPath = resolvePath(testFile.path, dep.file);
      if (sourceFilePaths.has(resolvedPath))
        addTraced(resolvedPath, testFile.path, importedSources);
      const withTs = `${resolvedPath.replace(/\.ts$/, "")}.ts`;
      if (sourceFilePaths.has(withTs)) addTraced(withTs, testFile.path, importedSources);
    }
    testToSourceMap.set(testFile.path, importedSources);
  }

  const testedFiles: string[] = [];
  const untestedFiles: string[] = [];
  for (const [sourcePath, tests] of coverageMap) {
    if (tests.length > 0) testedFiles.push(sourcePath);
    else untestedFiles.push(sourcePath);
  }
  const policy = loadCoveragePolicy(root);
  const sourcePaths = sourceFiles.map((f) => f.path);
  return {
    sourceFiles: sourcePaths,
    testFiles,
    coverageMap,
    testedFiles,
    untestedFiles,
    testToSourceMap,
    policy,
    policyBreakdown: buildCategoryBreakdown(sourcePaths, testedFiles, untestedFiles, policy),
  };
}
