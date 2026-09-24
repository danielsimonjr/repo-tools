/**
 * DEPENDENCY_GRAPH.md: the module sections, the dependency matrix, the cycles, the Mermaid
 * graph, the statistics and (in monorepo mode) the package dependency section.
 *
 * Fix F21: an export list of more than 8 names renders as a fenced `text` block.
 * Fix F26: the cycle section lists cyclic components, each with its members and one cycle.
 */
import { basename } from "node:path";
import { generateFallbackDescription } from "../parser.ts";
import { resolvePath } from "../resolver.ts";
import type {
  CyclicComponent,
  CyclicComponents,
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
      const targetId = nodeIds.get(resolvePath(file.path, dep.file, nodeIds));
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

/**
 * An export list with more names than this renders as a fenced `text` block under its label
 * (fix F21). A list of names is data, not prose: a long inline list reads as one long sentence
 * to a reader and to a prose checker. A list at or under the threshold stays inline.
 */
export const LONG_EXPORT_LIST_THRESHOLD = 8;

/** The maximum line width of the text inside the fenced block, when a name fits. */
export const EXPORT_LIST_WRAP_WIDTH = 100;

/**
 * Adds one export list to `lines` (fix F21). Up to `LONG_EXPORT_LIST_THRESHOLD` names: one line
 * of code spans. More names: the label, then a fenced `text` block with the names separated by
 * ", " and wrapped at `EXPORT_LIST_WRAP_WIDTH`. The names and their order do not change. An empty
 * list adds nothing.
 */
export function renderExportList(lines: string[], label: string, names: readonly string[]): void {
  if (names.length === 0) return;
  if (names.length <= LONG_EXPORT_LIST_THRESHOLD) {
    lines.push(`- ${label}: \`${names.join("`, `")}\``);
    return;
  }
  lines.push(`- ${label}:`, "", "  ```text");
  let row = "";
  names.forEach((name, i) => {
    const piece = i < names.length - 1 ? `${name},` : name;
    if (row !== "" && row.length + 1 + piece.length > EXPORT_LIST_WRAP_WIDTH) {
      lines.push(`  ${row}`);
      row = piece;
    } else {
      row = row === "" ? piece : `${row} ${piece}`;
    }
  });
  if (row !== "") lines.push(`  ${row}`);
  lines.push("  ```", "");
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
    renderExportList(lines, "Classes", ex.classes);
    renderExportList(lines, "Interfaces", ex.interfaces);
    renderExportList(
      lines,
      "Types",
      ex.types.filter((t) => !ex.interfaces.includes(t)),
    );
    renderExportList(lines, "Enums", ex.enums);
    renderExportList(lines, "Functions", ex.functions);
    renderExportList(lines, "Constants", ex.constants);
    renderExportList(lines, "Re-exports", ex.reExported);
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
  cycles: CyclicComponents,
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
  const total = cycles.runtime.length + cycles.typeOnly.length;
  if (total === 0) {
    lines.push("**No circular dependencies detected.**");
  } else {
    lines.push(
      `**${total} cyclic component${total === 1 ? "" : "s"} detected** ` +
        "(strongly connected components of the import graph):",
    );
    lines.push("");
    lines.push(
      `- **Runtime components**: ${cycles.runtime.length} ` +
        `(${filesLabel(stats.runtimeFilesInCycles)}; require attention)`,
    );
    lines.push(
      `- **Type-only components**: ${cycles.typeOnly.length} ` +
        `(${filesLabel(stats.typeOnlyFilesInCycles)}; a type-only import closes each cycle)`,
    );
    lines.push("");
    const componentList = (title: string, intro: string, list: CyclicComponent[]): void => {
      if (list.length === 0) return;
      lines.push(title, "", intro, "");
      for (const c of list.slice(0, 10)) {
        lines.push(`- ${c.cycle.join(" -> ")}`);
        lines.push(`  - Members (${c.members.length}): \`${c.members.join("`, `")}\``);
      }
      if (list.length > 10) lines.push(`- ... and ${list.length - 10} more`);
      lines.push("");
    };
    componentList(
      "### Runtime Cyclic Components",
      "Each component holds a cycle of runtime imports, and the cycle can cause issues. " +
        "Each line shows the shortest cycle through the first member:",
      cycles.runtime,
    );
    componentList(
      "### Type-Only Cyclic Components",
      "Each component needs a type-only import to close its cycle. Type imports are erased " +
        "at runtime. Each line shows the shortest cycle through the first member:",
      cycles.typeOnly,
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
  lines.push(`| Runtime Cyclic Components | ${stats.runtimeCyclicComponents} |`);
  lines.push(`| Type-only Cyclic Components | ${stats.typeOnlyCyclicComponents} |`);
  lines.push(`| Files in Runtime Cycles | ${stats.runtimeFilesInCycles} |`);
  lines.push(`| Files in Type-only Cycles | ${stats.typeOnlyFilesInCycles} |`);
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
