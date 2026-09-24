/**
 * dependency-graph.json and dependency-summary.compact.json.
 *
 * Port notes: `metadata.lastUpdated` and the compact `m.d` hold the date (fix F1), and neither
 * file ends with a newline (rule R1).
 */
import { cleanExportName, generateFallbackDescription } from "../parser.ts";
import { resolvePath } from "../resolver.ts";
import type {
  CircularDependencyResult,
  ModuleMap,
  PackageJson,
  ParsedFile,
  Statistics,
} from "../types.ts";

/** The dependency-graph.json object. The key order is the report order. */
export function generateJSON(
  files: ParsedFile[],
  modules: ModuleMap,
  stats: Statistics,
  circularDeps: CircularDependencyResult,
  packageJson: PackageJson,
  today: string,
): object {
  const modulesJson: Record<string, Record<string, object>> = {};
  for (const [category, categoryFiles] of Object.entries(modules)) {
    const out: Record<string, object> = {};
    modulesJson[category] = out;
    for (const [path, file] of Object.entries(categoryFiles)) {
      const ex = file.exports;
      const fileData: Record<string, unknown> = {
        description: file.description || generateFallbackDescription(file),
        externalDependencies: file.externalDependencies,
        nodeDependencies: file.nodeDependencies,
        internalDependencies: file.internalDependencies.map((d) => ({
          file: d.file,
          imports: d.imports,
          ...(d.reExport ? { reExport: true } : {}),
          ...(d.typeOnly ? { typeOnly: true } : {}),
        })),
        workspaceDependencies: file.workspaceDependencies,
        exports: ex.named,
        reExported: ex.reExported.length > 0 ? ex.reExported : undefined,
        classes: ex.classes.length > 0 ? ex.classes : undefined,
        interfaces: ex.interfaces.length > 0 ? ex.interfaces : undefined,
        functions: ex.functions.length > 0 ? ex.functions : undefined,
        enums: ex.enums.length > 0 ? ex.enums : undefined,
        constants: ex.constants.length > 0 ? ex.constants : undefined,
      };
      for (const key of Object.keys(fileData)) {
        if (fileData[key] === undefined) delete fileData[key];
      }
      out[path] = fileData;
    }
  }
  const layers = Object.keys(modules)
    .map((name) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      files: Object.keys(modules[name] ?? {}),
    }))
    .filter((l) => l.files.length > 0);
  return {
    metadata: {
      name: packageJson.name,
      version: packageJson.version,
      lastUpdated: today,
      totalFiles: stats.totalTypeScriptFiles,
      totalModules: stats.totalModules,
      totalExports: stats.totalExports,
    },
    entryPoints: files
      .filter((f) => f.path.endsWith("src/index.ts"))
      .map((f) => ({ file: f.path, type: "main", description: f.description || "Entry Point" })),
    modules: modulesJson,
    dependencyGraph: {
      circularDependencies: {
        runtime: circularDeps.runtime,
        typeOnly: circularDeps.typeOnly,
        total: circularDeps.all.length,
        runtimeCount: circularDeps.runtime.length,
        typeOnlyCount: circularDeps.typeOnly.length,
      },
      layers,
    },
    statistics: stats,
  };
}

/** The dependency-graph.json text (2-space JSON, no trailing newline). */
export function dependencyGraphJsonText(json: object): string {
  return JSON.stringify(json, null, 2);
}

/**
 * The compact summary: minified JSON with short keys. `mod` holds at most 20 export names and
 * 10 interfaces per module; `hp` holds the 15 files with the most edges.
 */
export function generateCompactSummary(
  files: ParsedFile[],
  modules: ModuleMap,
  stats: Statistics,
  circularDeps: CircularDependencyResult,
  packageJson: PackageJson,
  today: string,
): string {
  const summary = {
    m: {
      n: packageJson.name,
      v: packageJson.version,
      d: today,
      f: stats.totalTypeScriptFiles,
      e: stats.totalExports,
      re: stats.totalReExports,
    },
    s: {
      loc: stats.totalLinesOfCode,
      cls: stats.totalClasses,
      int: stats.totalInterfaces,
      fn: stats.totalFunctions,
      tg: stats.totalTypeGuards,
      en: stats.totalEnums,
      co: stats.totalConstants,
      toi: stats.totalTypeOnlyImports,
    },
    c: {
      rt: circularDeps.runtime.length,
      to: circularDeps.typeOnly.length,
      rtp: circularDeps.runtime
        .slice(0, 5)
        .map((c) => c.map((p) => p.split("/").pop()?.replace(".ts", "")).join("→")),
    },
    mod: {} as Record<string, { f: number; exp: string[]; cls?: string[]; int?: string[] }>,
    hp: [] as { p: string; i: number; o: number }[],
  };
  for (const [modName, modFiles] of Object.entries(modules)) {
    const fileList = Object.values(modFiles);
    const exports = fileList
      .flatMap((f) => f.exports.named)
      .map(cleanExportName)
      .filter(Boolean)
      .slice(0, 20);
    const classes = fileList.flatMap((f) => f.exports.classes);
    const interfaces = fileList.flatMap((f) => f.exports.interfaces).slice(0, 10);
    const entry: { f: number; exp: string[]; cls?: string[]; int?: string[] } = {
      f: Object.keys(modFiles).length,
      exp: [...new Set(exports)],
    };
    if (classes.length > 0) entry.cls = [...new Set(classes)];
    if (interfaces.length > 0) entry.int = [...new Set(interfaces)];
    summary.mod[modName] = entry;
  }
  summary.hp = files
    .map((f) => ({
      p: f.path.split("/").slice(-2).join("/"),
      i: f.internalDependencies.length,
      o: files.filter((other) =>
        other.internalDependencies.some((d) => resolvePath(other.path, d.file) === f.path),
      ).length,
    }))
    .sort((a, b) => b.i + b.o - (a.i + a.o))
    .slice(0, 15);
  return JSON.stringify(summary);
}
