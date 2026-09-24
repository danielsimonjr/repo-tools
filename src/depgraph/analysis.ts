/**
 * Graph analysis: modules, the dependency matrix, reachability, cycles, the public surface,
 * unused files and exports, dormancy and the statistics.
 *
 * Port notes, kept on purpose until the fixes land:
 * - `detectCircularDependencies` is a depth-first search that reports the cycles it meets, so
 *   its result depends on the listing order and can miss cycles (fix F26).
 * - Dormancy exists in monorepo mode only (fix M1).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "../mask.ts";
import { resolvePath, workspaceEntryPath } from "./resolver.ts";
import { configReferencedEntries } from "./roots.ts";
import type {
  CircularDependencyResult,
  DependencyMatrix,
  ModuleMap,
  ParsedFile,
  PublicSurface,
  Statistics,
  UnusedAnalysis,
  UnusedExport,
  WorkspacePackage,
} from "./types.ts";

/**
 * Groups files into modules. Monorepo mode: the package directory for a file directly in
 * `src/`, else `<package>/<first src subdirectory>`. Single-package mode: `entry` for
 * `src/index.ts`, `root` for another file directly in `src/`, else the first `src`
 * subdirectory. A single-package file outside `src/` is in no module.
 */
export function categorizeFiles(
  files: ParsedFile[],
  isMonorepo: boolean,
  workspaces: Map<string, WorkspacePackage>,
): ModuleMap {
  const modules: ModuleMap = {};
  const add = (key: string, file: ParsedFile): void => {
    modules[key] ??= {};
    modules[key][file.path] = file;
  };
  if (isMonorepo) {
    for (const file of files) {
      let pkgKey = "unknown";
      for (const [, ws] of workspaces) {
        if (file.path.startsWith(`${ws.directory}/`)) {
          pkgKey = ws.directory;
          break;
        }
      }
      const afterPkg = file.path.split("/").slice(pkgKey.split("/").length);
      if (afterPkg.length >= 2 && afterPkg[0] === "src") {
        add(afterPkg.length === 2 ? pkgKey : `${pkgKey}/${afterPkg[1]}`, file);
      } else {
        add(pkgKey, file);
      }
    }
  } else {
    for (const file of files) {
      if (file.path === "src/index.ts") {
        add("entry", file);
        continue;
      }
      const parts = file.path.split("/");
      if (parts.length >= 2 && parts[0] === "src") {
        add(parts.length === 2 ? "root" : (parts[1] ?? "").replace(".ts", ""), file);
      } else if (parts.length >= 2) {
        // Fix F12: a repo without `src/` has top-level source folders. `<dir>/x.ts` goes to
        // module `<dir>`, and `<dir>/<sub>/x.ts` goes to module `<dir>/<sub>`.
        add(parts.length === 2 ? (parts[0] ?? "") : `${parts[0]}/${parts[1]}`, file);
      }
    }
  }
  for (const key of Object.keys(modules)) {
    if (Object.keys(modules[key] ?? {}).length === 0) delete modules[key];
  }
  return modules;
}

/**
 * Per file: the specifiers it imports (as written) and the files whose relative imports
 * resolve to it.
 */
export function buildDependencyMatrix(files: ParsedFile[]): DependencyMatrix {
  const matrix: DependencyMatrix = {};
  for (const file of files) {
    const importedFrom = new Set<string>();
    const exportsTo = new Set<string>();
    for (const dep of file.internalDependencies) importedFrom.add(dep.file);
    for (const other of files) {
      if (other.path === file.path) continue;
      for (const dep of other.internalDependencies) {
        const resolved = resolvePath(other.path, dep.file);
        if (resolved === file.path || resolved === file.path.replace(".ts", "")) {
          exportsTo.add(other.path);
        }
      }
    }
    matrix[file.path] = { importsFrom: [...importedFrom], exportsTo: [...exportsTo] };
  }
  return matrix;
}

/**
 * The files reachable from `entryPoints` through relative imports and workspace imports (a
 * workspace import reaches the subpath file, else the package index). The entry points are in
 * the result even when they are not in `allFiles`.
 */
export function findReachableFiles(
  entryPoints: string[],
  allFiles: ParsedFile[],
  workspaces: Map<string, WorkspacePackage>,
): Set<string> {
  const fileMap = new Map<string, ParsedFile>();
  for (const f of allFiles) fileMap.set(f.path, f);
  const reachable = new Set<string>();
  const queue = [...entryPoints];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (reachable.has(current)) continue;
    reachable.add(current);
    const file = fileMap.get(current);
    if (!file) continue;
    for (const dep of file.internalDependencies) {
      const resolved = resolvePath(current, dep.file);
      if (fileMap.has(resolved) && !reachable.has(resolved)) queue.push(resolved);
    }
    for (const ws of file.workspaceDependencies) {
      const sub = ws.subpath ? workspaceEntryPath(workspaces, ws.package, ws.subpath) : undefined;
      const target = sub && fileMap.has(sub) ? sub : workspaceEntryPath(workspaces, ws.package);
      if (target && fileMap.has(target) && !reachable.has(target)) queue.push(target);
    }
  }
  return reachable;
}

/** The sort key that makes two cycles with the same members equal. */
function cycleKey(cycle: string[]): string {
  return [...cycle].sort().join("->");
}

/** The cycles that a depth-first search meets in `graph`, deduplicated by member set. */
function findCycles(graph: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const dfs = (node: string, path: string[]): void => {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      if (cycleStart !== -1) {
        const cycle = path.slice(cycleStart);
        cycle.push(node);
        const key = cycleKey(cycle);
        if (!cycles.some((c) => cycleKey(c) === key)) cycles.push(cycle);
      }
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    inStack.add(node);
    path.push(node);
    for (const neighbor of graph.get(node) || []) dfs(neighbor, path);
    path.pop();
    inStack.delete(node);
  };
  for (const node of graph.keys()) {
    if (!visited.has(node)) dfs(node, []);
  }
  return cycles;
}

/**
 * The cycles of the relative-import graph. A runtime cycle is a cycle of the graph without
 * type-only edges. A type-only cycle is a cycle of the full graph whose member set is not a
 * runtime cycle.
 */
export function detectCircularDependencies(files: ParsedFile[]): CircularDependencyResult {
  const filePaths = new Set(files.map((f) => f.path));
  const runtimeGraph = new Map<string, string[]>();
  const allGraph = new Map<string, string[]>();
  for (const file of files) {
    const runtimeDeps: string[] = [];
    const allDeps: string[] = [];
    for (const d of file.internalDependencies) {
      const resolved = resolvePath(file.path, d.file);
      if (filePaths.has(resolved)) {
        allDeps.push(resolved);
        if (!d.typeOnly) runtimeDeps.push(resolved);
      }
    }
    runtimeGraph.set(file.path, runtimeDeps);
    allGraph.set(file.path, allDeps);
  }
  const allCycles = findCycles(allGraph);
  const runtimeCycles = findCycles(runtimeGraph);
  const runtimeKeys = new Set(runtimeCycles.map(cycleKey));
  return {
    all: allCycles,
    runtime: runtimeCycles,
    typeOnly: allCycles.filter((c) => !runtimeKeys.has(cycleKey(c))),
  };
}

/**
 * The public surface: each `src/index.ts`, each workspace extra entry and each
 * config-referenced entry is a root. A root and every file that a chain of `export *` from a
 * root reaches is public in full. A named re-export from a public file makes that one name
 * public.
 */
export function computePublicSurface(
  files: ParsedFile[],
  root: string,
  workspaces: Map<string, WorkspacePackage>,
): PublicSurface {
  const byPath = new Map(files.map((f) => [f.path, f] as const));
  const publicWildcardFiles = new Set<string>();
  const publicNamed = new Set<string>();
  const markPublic = (file: ParsedFile, seen: Set<string>): void => {
    if (seen.has(file.path)) return;
    seen.add(file.path);
    publicWildcardFiles.add(file.path);
    for (const dep of file.internalDependencies) {
      if (!dep.reExport) continue;
      const target = byPath.get(resolvePath(file.path, dep.file));
      if (!target) continue;
      if (dep.imports.includes("*")) markPublic(target, seen);
      else for (const name of dep.imports) publicNamed.add(`${target.path}::${name}`);
    }
  };
  const extraEntryPaths = new Set<string>();
  for (const ws of workspaces.values()) {
    for (const entry of ws.extraEntries) extraEntryPaths.add(entry);
  }
  for (const entry of configReferencedEntries(root)) extraEntryPaths.add(entry);
  for (const file of files) {
    if (
      file.path === "src/index.ts" ||
      file.path.endsWith("/src/index.ts") ||
      extraEntryPaths.has(file.path)
    ) {
      markPublic(file, new Set());
    }
  }
  return { publicWildcardFiles, publicNamed, extraEntryPaths };
}

/** Adds the names of one import to `symbols`. A wildcard or namespace import adds `*`. */
function addImported(symbols: Set<string>, imports: string[]): void {
  for (const imp of imports) symbols.add(imp === "*" || imp.startsWith("* as ") ? "*" : imp);
}

/**
 * The unused files and exports of `files`. The imports of `files` and `testFiles` count as
 * use. A public-surface export is never unused.
 */
export function detectUnused(
  files: ParsedFile[],
  testFiles: ParsedFile[],
  root: string,
  workspaces: Map<string, WorkspacePackage>,
): UnusedAnalysis {
  const filePaths = new Set(files.map((f) => f.path));
  const importedFiles = new Set<string>();
  const importedSymbols = new Map<string, Set<string>>();
  const symbolsOf = (path: string): Set<string> => {
    let set = importedSymbols.get(path);
    if (!set) {
      set = new Set();
      importedSymbols.set(path, set);
    }
    return set;
  };
  for (const file of [...files, ...testFiles]) {
    for (const dep of file.internalDependencies) {
      const resolved = resolvePath(file.path, dep.file);
      if (!filePaths.has(resolved)) continue;
      importedFiles.add(resolved);
      addImported(symbolsOf(resolved), dep.imports);
    }
    for (const ws of file.workspaceDependencies) {
      const sub = ws.subpath ? workspaceEntryPath(workspaces, ws.package, ws.subpath) : undefined;
      const target = sub && filePaths.has(sub) ? sub : workspaceEntryPath(workspaces, ws.package);
      if (!target || !filePaths.has(target)) continue;
      importedFiles.add(target);
      addImported(symbolsOf(target), ws.imports);
    }
  }

  const { publicWildcardFiles, publicNamed, extraEntryPaths } = computePublicSurface(
    files,
    root,
    workspaces,
  );

  const unusedFiles: string[] = [];
  for (const file of files) {
    // Fix F17: every package `src/index.ts` is an entry root, also when it re-exports nothing.
    if (file.path === "src/index.ts" || file.path.endsWith("/src/index.ts")) continue;
    if (file.name === "index" && file.exports.reExported.length > 0) continue;
    if (extraEntryPaths.has(file.path)) continue;
    if (!importedFiles.has(file.path)) unusedFiles.push(file.path);
  }

  const unusedExports: UnusedExport[] = [];
  for (const file of files) {
    if (publicWildcardFiles.has(file.path)) continue;
    const usedSymbols = importedSymbols.get(file.path);
    if (!usedSymbols || usedSymbols.has("*")) continue;
    const isPublic = (name: string): boolean =>
      usedSymbols.has(name) || publicNamed.has(`${file.path}::${name}`);
    let fileContent: string | undefined;
    const inFileRefs = (name: string): number => {
      if (fileContent === undefined) {
        try {
          // Fix F24: a name in a comment (its own JSDoc, a `//` note) is not a use.
          fileContent = stripComments(readFileSync(join(root, file.path), "utf-8"));
        } catch {
          fileContent = "";
        }
      }
      const all = (fileContent.match(new RegExp(`\\b${name}\\b`, "g")) || []).length;
      const defs = (
        fileContent.match(
          new RegExp(
            `export\\s+(?:async\\s+)?(?:function|const|let|var|class|interface|type|enum)\\s+${name}\\b`,
            "g",
          ),
        ) || []
      ).length;
      return Math.max(0, all - defs);
    };
    const push = (name: string, type: UnusedExport["type"]): void => {
      unusedExports.push({ file: file.path, name, type, inFileRefs: inFileRefs(name) });
    };
    for (const fn of file.exports.functions) if (!isPublic(fn)) push(fn, "function");
    for (const cls of file.exports.classes) if (!isPublic(cls)) push(cls, "class");
    for (const iface of file.exports.interfaces) if (!isPublic(iface)) push(iface, "interface");
    for (const type of file.exports.types) {
      if (!isPublic(type) && !file.exports.interfaces.includes(type)) push(type, "type");
    }
    for (const en of file.exports.enums) if (!isPublic(en)) push(en, "enum");
    for (const constant of file.exports.constants) {
      if (!isPublic(constant)) push(constant, "constant");
    }
  }
  return { unusedFiles, unusedExports };
}

/** The totals of one run. Line counts read each file from `root`. */
export function generateStatistics(
  files: ParsedFile[],
  modules: ModuleMap,
  circularDeps: CircularDependencyResult,
  unusedAnalysis: UnusedAnalysis,
  root: string,
): Statistics {
  let totalExports = 0;
  let totalClasses = 0;
  let totalInterfaces = 0;
  let totalFunctions = 0;
  let totalTypeGuards = 0;
  let totalEnums = 0;
  let totalConstants = 0;
  let totalLines = 0;
  let totalReExports = 0;
  let totalTypeOnlyImports = 0;
  for (const file of files) {
    totalExports += file.exports.named.length;
    totalClasses += file.exports.classes.length;
    totalInterfaces += file.exports.interfaces.length;
    totalFunctions += file.exports.functions.length;
    totalEnums += file.exports.enums.length;
    totalConstants += file.exports.constants.length;
    totalReExports += file.exports.reExported.length;
    totalTypeOnlyImports += file.internalDependencies.filter((d) => d.typeOnly).length;
    totalTypeGuards += file.exports.functions.filter((f) => f.startsWith("is")).length;
    try {
      totalLines += readFileSync(join(root, file.path), "utf-8").split("\n").length;
    } catch {
      // A file that cannot be read adds no lines.
    }
  }
  return {
    totalTypeScriptFiles: files.length,
    totalModules: Object.keys(modules).length,
    totalLinesOfCode: totalLines,
    totalExports,
    totalClasses,
    totalInterfaces,
    totalFunctions,
    totalTypeGuards,
    totalEnums,
    totalConstants,
    totalReExports,
    totalTypeOnlyImports,
    runtimeCircularDeps: circularDeps.runtime.length,
    typeOnlyCircularDeps: circularDeps.typeOnly.length,
    unusedFilesCount: unusedAnalysis.unusedFiles.length,
    unusedExportsCount: unusedAnalysis.unusedExports.length,
  };
}

/** The dormant files of a run, split by test reachability. */
export interface DormantSplit {
  /** Files reachable from a test file (empty when there is no dormant set). */
  testReachable: Set<string>;
  /** Dormant runtime files under a `src/` directory, `.d.ts` excluded, sorted. */
  dormantAll: string[];
  /** Dormant files that no test reaches. */
  orphaned: string[];
  /** Dormant files that a test reaches. */
  testOnly: string[];
}

/**
 * Splits `dormantSet` into orphaned and test-only files. Without a dormant set (single-package
 * mode) every list is empty.
 */
export function splitDormant(
  dormantSet: Set<string> | undefined,
  parsedFiles: ParsedFile[],
  parsedTestFiles: ParsedFile[],
  workspaces: Map<string, WorkspacePackage>,
): DormantSplit {
  const testReachable = dormantSet
    ? findReachableFiles(
        parsedTestFiles.map((f) => f.path),
        [...parsedFiles, ...parsedTestFiles],
        workspaces,
      )
    : new Set<string>();
  const dormantAll = dormantSet
    ? [...dormantSet].filter((f) => /(^|\/)src\//.test(f) && !f.endsWith(".d.ts")).sort()
    : [];
  return {
    testReachable,
    dormantAll,
    orphaned: dormantAll.filter((f) => !testReachable.has(f)),
    testOnly: dormantAll.filter((f) => testReachable.has(f)),
  };
}
