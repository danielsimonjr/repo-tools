/**
 * DEPENDENCY_GRAPH.md: the module sections, the dependency matrix, the cycles, the Mermaid
 * graph, the statistics and (in monorepo mode) the package dependency section.
 *
 * Port notes: the report holds date stamps (fix F1), and long export lists are inline (fix F21).
 */
import { basename } from "node:path";
import { generateFallbackDescription } from "../parser.ts";
import { resolvePath } from "../resolver.ts";
import type {
  CircularDependencyResult,
  DependencyMatrix,
  ModuleMap,
  PackageJson,
  ParsedFile,
  Statistics,
  WorkspacePackage,
} from "../types.ts";

/** The first character upper-cased. */
function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The anchor slug of a module name. */
function slugOf(category: string): string {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** `N file` or `N files`. */
function filesLabel(count: number): string {
  return `${count} file${count !== 1 ? "s" : ""}`;
}

/**
 * The Mermaid graph: one subgraph per module with at most 10 file nodes, then at most 75
 * edges between the drawn nodes.
 */
export function generateMermaidDiagram(modules: ModuleMap, files: ParsedFile[]): string {
  const lines: string[] = ["```mermaid", "graph TD"];
  const nodeIds = new Map<string, string>();
  let nodeCounter = 0;
  for (const moduleName of Object.keys(modules)) {
    lines.push(`    subgraph ${capitalize(moduleName)}`);
    const moduleFiles = Object.keys(modules[moduleName] ?? {});
    for (const filePath of moduleFiles.slice(0, 10)) {
      const nodeId = `N${nodeCounter++}`;
      nodeIds.set(filePath, nodeId);
      lines.push(`        ${nodeId}[${basename(filePath, ".ts")}]`);
    }
    if (moduleFiles.length > 10) {
      lines.push(`        N${nodeCounter++}[...${moduleFiles.length - 10} more]`);
    }
    lines.push("    end");
    lines.push("");
  }
  const addedEdges = new Set<string>();
  let edgeCount = 0;
  const maxEdges = 75;
  for (const file of files) {
    const sourceId = nodeIds.get(file.path);
    if (!sourceId) continue;
    for (const dep of file.internalDependencies) {
      if (edgeCount >= maxEdges) break;
      const targetId = nodeIds.get(resolvePath(file.path, dep.file));
      if (targetId && sourceId !== targetId) {
        const edgeKey = `${sourceId}-${targetId}`;
        if (!addedEdges.has(edgeKey)) {
          lines.push(`    ${sourceId} --> ${targetId}`);
          addedEdges.add(edgeKey);
          edgeCount++;
        }
      }
    }
  }
  lines.push("```");
  return lines.join("\n");
}

/** The per-file section of one module file. */
function fileSection(lines: string[], path: string, file: ParsedFile): void {
  lines.push(`### \`${path}\` - ${file.description || generateFallbackDescription(file)}`);
  lines.push("");
  const table = (title: string, head: string, rule: string, rows: string[]): void => {
    if (rows.length === 0) return;
    lines.push(title, head, rule, ...rows, "");
  };
  table(
    "**External Dependencies:**",
    "| Package | Import |",
    "|---------|--------|",
    file.externalDependencies.map((d) => `| \`${d.package}\` | \`${d.imports.join(", ")}\` |`),
  );
  table(
    "**Workspace Dependencies:**",
    "| Package | Import |",
    "|---------|--------|",
    file.workspaceDependencies.map((d) => `| \`${d.package}\` | \`${d.imports.join(", ")}\` |`),
  );
  table(
    "**Node.js Built-in Dependencies:**",
    "| Module | Import |",
    "|--------|--------|",
    file.nodeDependencies.map((d) => `| \`${d.module}\` | \`${d.imports.join(", ")}\` |`),
  );
  table(
    "**Internal Dependencies:**",
    "| File | Imports | Type |",
    "|------|---------|------|",
    file.internalDependencies.map((d) => {
      let usage = d.reExport ? "Re-export" : "Import";
      if (d.typeOnly) usage += " (type-only)";
      return `| \`${d.file}\` | \`${d.imports.join(", ")}\` | ${usage} |`;
    }),
  );
  const ex = file.exports;
  if (
    ex.named.length > 0 ||
    ex.default ||
    ex.reExported.length > 0 ||
    ex.interfaces.length > 0 ||
    ex.types.length > 0
  ) {
    lines.push("**Exports:**");
    const list = (label: string, names: string[]): void => {
      if (names.length > 0) lines.push(`- ${label}: \`${names.join("`, `")}\``);
    };
    list("Classes", ex.classes);
    list("Interfaces", ex.interfaces);
    list(
      "Types",
      ex.types.filter((t) => !ex.interfaces.includes(t)),
    );
    list("Enums", ex.enums);
    list("Functions", ex.functions);
    list("Constants", ex.constants);
    list("Re-exports", ex.reExported);
    if (ex.default) lines.push(`- Default: \`${ex.default}\``);
    lines.push("");
  }
  lines.push("---");
  lines.push("");
}

/** The DEPENDENCY_GRAPH.md body (without the banner and the package section). */
export function generateMarkdown(
  files: ParsedFile[],
  modules: ModuleMap,
  stats: Statistics,
  circularDeps: CircularDependencyResult,
  matrix: DependencyMatrix,
  packageJson: PackageJson,
): string {
  const lines: string[] = [];
  lines.push(`# ${packageJson.name || "Project"} - Dependency Graph`);
  lines.push("");
  lines.push(`**Version**: ${packageJson.version}`);
  lines.push("");
  lines.push(
    "This document provides a comprehensive dependency graph of all files, components, imports, functions, and variables in the codebase.",
  );
  lines.push("", "---", "");

  lines.push("## Table of Contents");
  lines.push("");
  lines.push("1. [Overview](#overview)");
  lines.push("2. [Package Dependencies](#package-dependencies)");
  let tocIndex = 3;
  for (const category of Object.keys(modules)) {
    const title = capitalize(category).replace(/-/g, " ");
    lines.push(`${tocIndex}. [${title} Dependencies](#${slugOf(category)}-dependencies)`);
    tocIndex++;
  }
  lines.push(`${tocIndex}. [Dependency Matrix](#dependency-matrix)`);
  lines.push(`${tocIndex + 1}. [Circular Dependency Analysis](#circular-dependency-analysis)`);
  lines.push(`${tocIndex + 2}. [Visual Dependency Graph](#visual-dependency-graph)`);
  lines.push(`${tocIndex + 3}. [Summary Statistics](#summary-statistics)`);
  lines.push("", "---", "");

  lines.push('<a id="overview"></a>');
  lines.push("## Overview");
  lines.push("");
  lines.push("The codebase is organized into the following modules:");
  lines.push("");
  for (const [moduleName, moduleFiles] of Object.entries(modules)) {
    lines.push(`- **${moduleName}**: ${filesLabel(Object.keys(moduleFiles).length)}`);
  }
  lines.push("", "---", "");

  for (const [category, categoryFiles] of Object.entries(modules)) {
    const title = capitalize(category).replace(/-/g, " ");
    lines.push(`<a id="${slugOf(category)}-dependencies"></a>`);
    lines.push("");
    lines.push(`## ${title} Dependencies`);
    lines.push("");
    for (const [path, file] of Object.entries(categoryFiles)) fileSection(lines, path, file);
  }

  lines.push('<a id="dependency-matrix"></a>');
  lines.push("## Dependency Matrix");
  lines.push("");
  lines.push("### File Import/Export Matrix");
  lines.push("");
  lines.push("| File | Imports From | Exports To |");
  lines.push("|------|--------------|------------|");
  const matrixEntries = Object.entries(matrix)
    .sort(
      (a, b) =>
        b[1].importsFrom.length +
        b[1].exportsTo.length -
        (a[1].importsFrom.length + a[1].exportsTo.length),
    )
    .slice(0, 40);
  for (const [filePath, deps] of matrixEntries) {
    const shortPath = filePath.replace(/\.ts$/, "");
    lines.push(
      `| \`${shortPath}\` | ${filesLabel(deps.importsFrom.length)} | ${filesLabel(deps.exportsTo.length)} |`,
    );
  }
  lines.push("", "---", "");

  lines.push('<a id="circular-dependency-analysis"></a>');
  lines.push("## Circular Dependency Analysis");
  lines.push("");
  if (circularDeps.all.length === 0) {
    lines.push("**No circular dependencies detected.**");
  } else {
    lines.push(`**${circularDeps.all.length} circular dependencies detected:**`);
    lines.push("");
    lines.push(`- **Runtime cycles**: ${circularDeps.runtime.length} (require attention)`);
    lines.push(`- **Type-only cycles**: ${circularDeps.typeOnly.length} (safe, no runtime impact)`);
    lines.push("");
    const cycleList = (title: string, intro: string, cycles: string[][]): void => {
      if (cycles.length === 0) return;
      lines.push(title, "", intro, "");
      for (const cycle of cycles.slice(0, 10)) lines.push(`- ${cycle.join(" -> ")}`);
      if (cycles.length > 10) lines.push(`- ... and ${cycles.length - 10} more`);
      lines.push("");
    };
    cycleList(
      "### Runtime Circular Dependencies",
      "These cycles involve runtime imports and may cause issues:",
      circularDeps.runtime,
    );
    cycleList(
      "### Type-Only Circular Dependencies",
      "These cycles only involve type imports and are safe (erased at runtime):",
      circularDeps.typeOnly,
    );
  }
  lines.push("---", "");

  lines.push('<a id="visual-dependency-graph"></a>');
  lines.push("## Visual Dependency Graph");
  lines.push("");
  lines.push(generateMermaidDiagram(modules, files));
  lines.push("", "---", "");

  lines.push('<a id="summary-statistics"></a>');
  lines.push("## Summary Statistics");
  lines.push("");
  lines.push("| Category | Count |");
  lines.push("|----------|-------|");
  lines.push(`| Total TypeScript Files | ${stats.totalTypeScriptFiles} |`);
  lines.push(`| Total Modules | ${stats.totalModules} |`);
  lines.push(`| Total Lines of Code | ${stats.totalLinesOfCode} |`);
  lines.push(`| Total Exports | ${stats.totalExports} |`);
  lines.push(`| Total Re-exports | ${stats.totalReExports} |`);
  lines.push(`| Total Classes | ${stats.totalClasses} |`);
  lines.push(`| Total Interfaces | ${stats.totalInterfaces} |`);
  lines.push(`| Total Functions | ${stats.totalFunctions} |`);
  lines.push(`| Total Type Guards | ${stats.totalTypeGuards} |`);
  lines.push(`| Total Enums | ${stats.totalEnums} |`);
  lines.push(`| Type-only Imports | ${stats.totalTypeOnlyImports} |`);
  lines.push(`| Runtime Circular Deps | ${stats.runtimeCircularDeps} |`);
  lines.push(`| Type-only Circular Deps | ${stats.typeOnlyCircularDeps} |`);
  lines.push("", "---", "");
  lines.push(`*Version*: ${packageJson.version}`);
  lines.push("");
  return lines.join("\n");
}

/**
 * The monorepo package section: the package table (dependencies of reachable files only, active
 * and dormant counts) and the Mermaid package graph.
 */
export function generatePackageDependencySection(
  parsedFiles: ParsedFile[],
  workspaces: Map<string, WorkspacePackage>,
  reachableFiles?: Set<string>,
  dormantFiles?: Set<string>,
): string {
  const lines: string[] = ['<a id="package-dependencies"></a>', "## Package Dependencies", ""];
  const pkgDeps = new Map<string, Set<string>>();
  for (const [name] of workspaces) pkgDeps.set(name, new Set());
  for (const file of parsedFiles) {
    if (!file.packageName) continue;
    if (reachableFiles && !reachableFiles.has(file.path)) continue;
    for (const wsDep of file.workspaceDependencies) {
      if (wsDep.package !== file.packageName) pkgDeps.get(file.packageName)?.add(wsDep.package);
    }
  }
  lines.push("| Package | Depends On | Files (Active) | Files (Dormant) |");
  lines.push("|---------|------------|----------------|-----------------|");
  for (const [name, ws] of workspaces) {
    const deps = pkgDeps.get(name);
    const depStr = deps && deps.size > 0 ? [...deps].map((d) => `\`${d}\``).join(", ") : "(none)";
    const pkgFiles = parsedFiles.filter((f) => f.packageName === name);
    const activeCount = reachableFiles
      ? pkgFiles.filter((f) => reachableFiles.has(f.path)).length
      : pkgFiles.length;
    const dormantCount = dormantFiles ? pkgFiles.filter((f) => dormantFiles.has(f.path)).length : 0;
    lines.push(
      `| \`${name}\` (\`${ws.directory}/\`) | ${depStr} | ${activeCount} | ${dormantCount} |`,
    );
  }
  lines.push("");
  lines.push("### Package Dependency Diagram");
  lines.push("");
  lines.push("```mermaid");
  lines.push("graph LR");
  const pkgIds = new Map<string, string>();
  let idx = 0;
  for (const [name, ws] of workspaces) {
    const id = `P${idx++}`;
    pkgIds.set(name, id);
    lines.push(`    ${id}[${ws.directory}]`);
  }
  for (const [name, deps] of pkgDeps) {
    const sourceId = pkgIds.get(name);
    if (!sourceId) continue;
    for (const dep of deps) {
      const targetId = pkgIds.get(dep);
      if (targetId) lines.push(`    ${sourceId} --> ${targetId}`);
    }
  }
  lines.push("```", "", "---", "");
  return lines.join("\n");
}

/**
 * Inserts `pkgSection` after the `---` line that follows `## Overview`, with one blank line in
 * front. Returns `markdown` unchanged when either marker is absent.
 */
export function insertPackageSection(markdown: string, pkgSection: string): string {
  const overviewMarker = "## Overview";
  const overviewIdx = markdown.indexOf(overviewMarker);
  if (overviewIdx === -1) return markdown;
  const sepIdx = markdown.indexOf("\n---\n", overviewIdx + overviewMarker.length);
  if (sepIdx === -1) return markdown;
  const insertPoint = sepIdx + 5;
  return `${markdown.slice(0, insertPoint)}\n${pkgSection}${markdown.slice(insertPoint)}`;
}
