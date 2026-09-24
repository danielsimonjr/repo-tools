/**
 * The regex parser: imports, side-effect imports, `import()` expressions, re-exports and export
 * declarations of one TypeScript file, over its comment-stripped source.
 *
 * Port notes, kept on purpose until the fixes land:
 * - Comments are removed with the regex functions of `src/mask.ts`, which also cut `//` text
 *   inside strings (fix F6 covers comments in brace blocks).
 * - Every relative `import('...')` is a type-only edge, `await import()` included (fix F25).
 *
 * Fix F23: `import()` reads a backtick specifier that holds no `${` substitution.
 */
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { removeBlockCommentsRegex, removeLineCommentsRegex, stripCommentsRegex } from "../mask.ts";
import { relativePosix } from "./paths.ts";
import { resolveWorkspaceSource } from "./resolver.ts";
import type { ParsedFile, WorkspacePackage } from "./types.ts";

/** The Node built-in module names that the parser classes as node dependencies. */
export const NODE_BUILTINS = [
  "fs",
  "path",
  "url",
  "crypto",
  "util",
  "stream",
  "events",
  "buffer",
  "os",
  "child_process",
  "http",
  "https",
  "net",
  "dns",
  "tls",
  "zlib",
  "readline",
  "assert",
  "cluster",
  "dgram",
  "domain",
  "inspector",
  "module",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "repl",
  "string_decoder",
  "timers",
  "tty",
  "v8",
  "vm",
  "worker_threads",
];

/** The inputs of `parseFile` that do not change between files. */
export interface ParseContext {
  /** The project root (absolute). */
  root: string;
  workspaces: Map<string, WorkspacePackage>;
}

/** A line of three or more separator characters (`===`, `---`, `***`). */
const RULE_LINE = /^[=\-*~#_]{3,}$/;

/**
 * The description of a file: the first text line of its first JSDoc block, else the text of
 * its first `//` line. At most 120 characters. Returns null when neither exists.
 */
export function extractDescription(content: string): string | null {
  const jsdocMatch = content.match(/\/\*\*\s*\n([^*]*(?:\*(?!\/)[^*]*)*)\*\//);
  if (jsdocMatch) {
    const lines = (jsdocMatch[1] ?? "")
      .split("\n")
      .map((line) => line.replace(/^\s*\*\s?/, "").trim())
      .map((line) => {
        // `@scope/pkg - description` lines give their description part.
        if (line.startsWith("@") && line.includes(" - ")) {
          return line.split(" - ").slice(1).join(" - ").trim();
        }
        return line;
      })
      .filter((line) => !line.startsWith("@") && line.length > 0)
      .filter((line) => !RULE_LINE.test(line));
    if (lines.length > 0) return (lines[0] ?? "").slice(0, 120);
  }
  const singleLineMatch = content.match(/^\/\/\s*(.+)$/m);
  if (singleLineMatch) {
    const desc = (singleLineMatch[1] ?? "").trim();
    if (RULE_LINE.test(desc)) return null;
    return desc.slice(0, 120);
  }
  return null;
}

/**
 * Cleans one export name: removes line comments, then block comments, collapses white space,
 * and removes a leading `type ` keyword when the text holds no `{`.
 */
export function cleanExportName(name: string): string {
  let cleaned = removeLineCommentsRegex(name);
  cleaned = removeBlockCommentsRegex(cleaned);
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (cleaned.startsWith("type ") && !cleaned.includes("{")) cleaned = cleaned.slice(5).trim();
  return cleaned;
}

/** A description made from the file name and the export counts, for a file with none. */
export function generateFallbackDescription(file: ParsedFile): string {
  const fileName = basename(file.path, ".ts");
  if (fileName === "index") {
    if (file.exports.reExported.length > 0) {
      const pkgName = file.packageName || dirname(file.path).split("/").pop() || "";
      return `Package entry point for ${pkgName || "module"} (re-exports ${file.exports.reExported.length} symbols)`;
    }
    if (file.exports.named.length > 0) {
      return `Entry point exporting ${file.exports.named.length} symbols`;
    }
    return "Package entry point";
  }
  const hasOnlyTypes =
    file.exports.named.length === 0 &&
    !file.exports.default &&
    (file.exports.interfaces.length > 0 || file.exports.types.length > 0);
  if (hasOnlyTypes) {
    const aliases = file.exports.types.filter((t) => !file.exports.interfaces.includes(t)).length;
    return `Type definitions (${file.exports.interfaces.length} interfaces, ${aliases} type aliases)`;
  }
  return `${fileName} module`;
}

/** Splits `export { a, b as c }` text into cleaned names; `pick` selects the part of `x as y`. */
function splitNames(list: string, pick: (parts: string[]) => string): string[] {
  return list
    .split(",")
    .map((s) => cleanExportName(pick(s.split(" as "))))
    .filter(Boolean);
}

/** Parses the imports and exports of the file at the absolute path `filePath`. */
export function parseFile(ctx: ParseContext, filePath: string): ParsedFile {
  const content = readFileSync(filePath, "utf-8");
  const relativePath = relativePosix(ctx.root, filePath);

  let detectedPackageName: string | null = null;
  for (const [name, ws] of ctx.workspaces) {
    if (relativePath.startsWith(`${ws.directory}/`)) {
      detectedPackageName = name;
      break;
    }
  }

  const code = stripCommentsRegex(content);
  const wsSource = (source: string) => resolveWorkspaceSource(ctx.workspaces, source);

  const result: ParsedFile = {
    path: relativePath,
    name: basename(filePath, ".ts"),
    externalDependencies: [],
    nodeDependencies: [],
    internalDependencies: [],
    workspaceDependencies: [],
    packageName: detectedPackageName,
    exports: {
      named: [],
      default: null,
      types: [],
      interfaces: [],
      enums: [],
      classes: [],
      functions: [],
      constants: [],
      reExported: [],
    },
    description: extractDescription(content),
  };

  // `import type { ... }`, `import { type X, Y }`, `import X from`, `import * as X from`.
  const importRegex =
    /import\s+(type\s+)?(?:(?:{([^}]+)}|(\w+)|\*\s+as\s+(\w+))(?:\s*,\s*(?:{([^}]+)}|(\w+)))?)\s+from\s+['"]([^'"]+)['"]/g;
  for (const match of code.matchAll(importRegex)) {
    const isTypeOnlyImport = !!match[1];
    const namedImports = match[2] || match[5] || "";
    const defaultImport = match[3] || match[6] || "";
    const namespaceImport = match[4] || "";
    const source = match[7] ?? "";

    const imports: string[] = [];
    let hasRuntimeImport = !isTypeOnlyImport;
    if (namedImports) {
      for (const item of namedImports.split(",").map((s) => s.trim())) {
        const isInlineType = item.startsWith("type ");
        const name = (item.replace(/^type\s+/, "").split(" as ")[0] ?? "").trim();
        if (name) {
          imports.push(name);
          if (!isInlineType && !isTypeOnlyImport) hasRuntimeImport = true;
        }
      }
    }
    if (defaultImport) imports.push(defaultImport);
    if (namespaceImport) imports.push(`* as ${namespaceImport}`);
    const typeOnly = isTypeOnlyImport || !hasRuntimeImport;

    const wsResolved = wsSource(source);
    if (source.startsWith(".")) {
      result.internalDependencies.push({ file: source, imports, typeOnly });
    } else if (wsResolved) {
      result.workspaceDependencies.push({
        package: wsResolved.ws.name,
        directory: wsResolved.ws.directory,
        imports,
        ...(wsResolved.subpath ? { subpath: wsResolved.subpath } : {}),
      });
    } else if (source.startsWith("node:") || NODE_BUILTINS.includes(source.split("/")[0] ?? "")) {
      result.nodeDependencies.push({ module: source.replace("node:", ""), imports });
    } else {
      result.externalDependencies.push({ package: source, imports });
    }
  }

  const addInternal = (
    regex: RegExp,
    edge: { typeOnly?: boolean; reExport?: boolean; sideEffect?: boolean },
  ): void => {
    for (const match of code.matchAll(regex)) {
      const source = match[1] ?? "";
      if (!result.internalDependencies.some((d) => d.file === source)) {
        result.internalDependencies.push({ file: source, imports: [], ...edge });
      }
    }
  };
  // Bare side-effect imports: `import './x.js';` (relative only).
  addInternal(/(?:^|\n)\s*import\s+['"](\.[^'"]+)['"]\s*;?/g, {
    typeOnly: false,
    sideEffect: true,
  });
  // `import('./x.js')` in any position, recorded as type-only (fix F25). Fix F23: a backtick
  // specifier counts too, unless it holds a `${` substitution.
  addInternal(/\bimport\s*\(\s*['"`](\.[^'"`${]+)['"`]\s*\)/g, { typeOnly: true });
  // Re-export edges: `export * from`, `export * as ns from`, `export { a } from`,
  // `export type { T } from`.
  addInternal(
    /(?:^|\n)\s*export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['"](\.[^'"]+)['"]/g,
    { reExport: true },
  );

  // Named exports record the exported name (the alias after `as`).
  for (const match of code.matchAll(/export\s*{\s*([^}]+)\s*}/g)) {
    result.exports.named.push(...splitNames(match[1] ?? "", (p) => p[p.length - 1] ?? ""));
  }
  for (const match of code.matchAll(/export\s+(?:const|let|var)\s+(\w+)/g)) {
    result.exports.constants.push(match[1] ?? "");
    result.exports.named.push(match[1] ?? "");
  }
  for (const match of code.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) {
    result.exports.functions.push(match[1] ?? "");
    result.exports.named.push(match[1] ?? "");
  }
  for (const match of code.matchAll(/export\s+class\s+(\w+)/g)) {
    result.exports.classes.push(match[1] ?? "");
    result.exports.named.push(match[1] ?? "");
  }
  for (const match of code.matchAll(/export\s+interface\s+(\w+)/g)) {
    result.exports.interfaces.push(match[1] ?? "");
    result.exports.types.push(match[1] ?? "");
  }
  for (const match of code.matchAll(/export\s+type\s+(\w+)/g)) {
    result.exports.types.push(match[1] ?? "");
  }
  for (const match of code.matchAll(/export\s+enum\s+(\w+)/g)) {
    result.exports.enums.push(match[1] ?? "");
    result.exports.named.push(match[1] ?? "");
  }
  const defaultMatch = code.match(/export\s+default\s+(?:class|function|const|let|var)?\s*(\w+)?/);
  if (defaultMatch) result.exports.default = defaultMatch[1] || "default";

  /** Records a re-export of `names` from `reSource` as a workspace or an internal edge. */
  const addReExport = (reSource: string, names: string[], typeOnly: boolean): void => {
    const reWs = wsSource(reSource);
    if (reWs) {
      result.workspaceDependencies.push({
        package: reWs.ws.name,
        directory: reWs.ws.directory,
        imports: names,
        ...(reWs.subpath ? { subpath: reWs.subpath } : {}),
      });
    } else {
      result.internalDependencies.push({
        file: reSource,
        imports: names,
        reExport: true,
        ...(typeOnly ? { typeOnly: true } : {}),
      });
    }
  };

  for (const match of code.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/g)) {
    const reSource = match[1] ?? "";
    addReExport(reSource, ["*"], false);
    result.exports.reExported.push(`* from ${reSource}`);
  }
  for (const match of code.matchAll(/export\s*{\s*([^}]+)\s*}\s*from\s+['"]([^'"]+)['"]/g)) {
    const names = splitNames(match[1] ?? "", (p) => p[0] ?? "");
    addReExport(match[2] ?? "", names, false);
    result.exports.named.push(...names);
    result.exports.reExported.push(...names);
  }
  for (const match of code.matchAll(/export\s+type\s*{\s*([^}]+)\s*}\s*from\s+['"]([^'"]+)['"]/g)) {
    const names = splitNames(match[1] ?? "", (p) => p[0] ?? "");
    addReExport(match[2] ?? "", names, true);
    result.exports.named.push(...names);
    result.exports.reExported.push(...names);
  }
  for (const match of code.matchAll(/export\s+type\s+\*\s+from\s+['"]([^'"]+)['"]/g)) {
    addReExport(match[1] ?? "", ["*"], true);
    result.exports.reExported.push(`type * from ${match[1]}`);
  }

  result.exports.named = [...new Set(result.exports.named)];
  result.exports.types = [...new Set(result.exports.types)];
  result.exports.reExported = [...new Set(result.exports.reExported)];
  return result;
}
