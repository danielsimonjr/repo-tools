/**
 * The Markdown reports of the map engine (design decisions D4 and D5), for every language:
 * FILE_INVENTORY.md, duplicate-symbols.md and unused-analysis.md. Each one renders the JSON files
 * that the run wrote into the output folder, so a report cannot disagree with its JSON.
 *
 * The TypeScript duplicate report keeps depgraph 1.x's renderer. The other text is new, because
 * the 1.x text described a TypeScript-only census.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DuplicateSymbolsReport } from "../depgraph/duplicates.ts";
import { type BannerOptions, withBanner } from "../depgraph/reporters/banner.ts";
import { generateDuplicateSymbolsMarkdown } from "../depgraph/reporters/duplicates.ts";
import { writeReport } from "../io.ts";
import { sortCodeUnits } from "../sort.ts";
import { MAP_REGENERATE_COMMAND } from "./reports.ts";

// biome-ignore lint/suspicious/noExplicitAny: the reports read untyped JSON.
type Json = any;

/** The disposition legend of the map census, in report order (design decision D5). */
const DISPOSITION_LEGEND: readonly [string, string][] = [
  ["reachable", "A `src`-area file that an entry root reaches."],
  ["build-entry", "A `src`-area file that is an entry root."],
  ["test-only", "A `src`-area file that only a test reaches."],
  ["orphan", "A `src`-area file that nothing reaches. Delete it, or wire it to a root."],
  ["test", "A file in a `tests/` folder, or a `*.test.ts` or `*.spec.ts` file."],
  ["tool", "A file in a `tools/` or `scripts/` folder outside `src/`."],
  ["config", "A `*.config.*` file of TypeScript or JavaScript."],
  ["example", "A file in `examples/` or `docs/`."],
  ["bench", "A file in `bench/` or `benchmarks/`, or a `*.bench.*` file."],
];

/** A list of code spans, or `_None._`. */
function bulletList(lines: string[], items: readonly string[]): void {
  if (items.length === 0) lines.push("_None._");
  for (const item of items) lines.push(`- \`${item}\``);
  lines.push("");
}

/** The FILE_INVENTORY.md body: the census of file-inventory.json. */
export function inventoryMarkdown(inv: Json, language: string): string {
  const lines: string[] = ["# Complete File Inventory", ""];
  lines.push(
    "This report lists each source file that the map census finds, with a disposition. The " +
      "census reads the files that git tracks. Outside a git work tree, it walks the folder. " +
      "The census skips tool state, dependency folders and build output (for example " +
      "`.git/`, `node_modules/`, `dist/` and `target/`), and `obj/` and `bin/` for C#.",
  );
  lines.push("");
  lines.push(`**Language**: ${language}`);
  lines.push("");
  lines.push(`**Total files**: ${inv.totalFiles}`);
  lines.push("");
  lines.push("## Disposition counts", "");
  lines.push("| Disposition | Count | Meaning |", "| --- | --: | --- |");
  for (const [disposition, meaning] of DISPOSITION_LEGEND) {
    lines.push(`| \`${disposition}\` | ${inv.byDisposition[disposition] ?? 0} | ${meaning} |`);
  }
  lines.push(`| **Total** | **${inv.totalFiles}** | |`, "");
  const countTable = (title: string, column: string, counts: Record<string, number>): void => {
    lines.push(`## ${title}`, "", `| ${column} | Files |`, "| --- | --: |");
    for (const key of sortCodeUnits(Object.keys(counts)))
      lines.push(`| \`${key}\` | ${counts[key]} |`);
    lines.push("");
  };
  countTable("Per-area counts", "Area", inv.byArea);
  countTable("Per-package counts", "Package", inv.byPackage ?? {});
  lines.push("## All files", "");
  lines.push("| File | Package | Area | Disposition | Lines |", "| --- | --- | --- | --- | --: |");
  for (const r of inv.files) {
    lines.push(`| \`${r.file}\` | ${r.package} | ${r.area} | ${r.disposition} | ${r.loc} |`);
  }
  lines.push("");
  lines.push("## Skipped links", "");
  lines.push(
    "Links (symbolic links and junctions) that the census did not follow. A link can point to " +
      "another repository, so no file behind a link is in this inventory or in the graph.",
  );
  lines.push("");
  bulletList(lines, inv.skippedLinks ?? []);
  lines.push("## Warnings", "");
  const warnings: string[] = inv.warnings ?? [];
  if (warnings.length === 0) lines.push("_None._");
  for (const w of warnings) lines.push(`- ${w}`);
  return lines.join("\n");
}

/**
 * The duplicate-symbols.md body. A TypeScript file carries depgraph's classified lists and keeps
 * depgraph's report. Another language gets the name-only grouping and its explicit note.
 */
export function duplicatesMarkdown(dup: Json): string {
  if (Array.isArray(dup.runtime) && Array.isArray(dup.types)) {
    const report: DuplicateSymbolsReport = {
      note: dup.classificationNote,
      summary: {
        runtimeDuplicates: dup.summary.runtimeDuplicates,
        typeDuplicates: dup.summary.typeDuplicates,
        runtimeByTag: dup.summary.runtimeByTag,
        typeByTag: dup.summary.typeByTag,
      },
      runtime: dup.runtime,
      types: dup.types,
    };
    return generateDuplicateSymbolsMarkdown(report);
  }
  const lines: string[] = ["# Duplicate Symbols", ""];
  lines.push(`> **Note:** ${dup.note}`, "", `> ${dup.classificationNote}`, "");
  lines.push(`**Duplicated names**: ${dup.summary.duplicateCount}`, "");
  lines.push(`**Names in the census**: ${dup.summary.totalSymbols}`, "");
  lines.push("## Names defined by two or more files", "");
  const names = Object.keys(dup.duplicates);
  if (names.length === 0) {
    lines.push("_None._");
  } else {
    lines.push("| Name | Defining files |", "| --- | --- |");
    for (const name of names) {
      lines.push(
        `| \`${name}\` | ${dup.duplicates[name].map((f: string) => `\`${f}\``).join(", ")} |`,
      );
    }
  }
  return lines.join("\n");
}

/** One bucket of unused-analysis.json: each file with its names. */
function bucket(
  lines: string[],
  title: string,
  intro: string,
  entries: Record<string, string[]>,
): void {
  lines.push(`## ${title}`, "", intro, "");
  const files = Object.keys(entries);
  if (files.length === 0) lines.push("_None._");
  for (const file of files) lines.push(`- \`${file}\`: \`${entries[file]?.join("`, `")}\``);
  lines.push("");
}

/** The unused-analysis.md body: unused-analysis.json, with the dormant files of the core graph. */
export function unusedMarkdown(unused: Json, graph: Json): string {
  const s = unused.summary;
  const reach = graph.reachability ?? {};
  const orphaned: string[] = reach.orphaned ?? [];
  const testOnly: string[] = reach.testOnly ?? [];
  const lines: string[] = ["# Unused Files and Exports Analysis", "", "## Summary", ""];
  lines.push(`- **Files with no in-repo importer**: ${s.noImporterFileCount}`);
  lines.push(`- **Dormant files**: ${orphaned.length + testOnly.length}`);
  lines.push(`  - **Orphaned (reachable from nothing)**: ${orphaned.length}`);
  lines.push(`  - **Test-only (only a test reaches them)**: ${testOnly.length}`);
  lines.push(`- **Potentially unused exports**: ${s.unusedExportCount}`);
  lines.push(`  - **Unreferenced anywhere**: ${s.unreferencedAnywhereCount}`);
  lines.push(`  - **Referenced in their own module**: ${s.referencedInModuleCount}`);
  lines.push(`  - **Not classified**: ${s.unclassifiedExportCount}`);
  lines.push("");
  lines.push("## Caveats", "");
  for (const caveat of unused.caveats ?? []) lines.push(`- ${caveat}`);
  lines.push("");
  lines.push("## Dormant files: orphaned", "");
  lines.push(
    "Source files that no root and no test reaches. Verify each one before you delete it.",
    "",
  );
  bulletList(lines, orphaned);
  lines.push("## Dormant files: test-only", "");
  lines.push("Source files that only a test reaches. They ship nothing, but a test uses them.", "");
  bulletList(lines, testOnly);
  lines.push("## Files with no in-repo importer", "");
  lines.push("No file of this repository imports these files. This is not a deletion list.", "");
  bulletList(lines, unused.noImporterFiles ?? []);
  bucket(
    lines,
    "Exports unreferenced anywhere",
    "No other file imports these names, and their own module does not use them.",
    unused.unreferencedAnywhere ?? {},
  );
  const notes: Record<string, Record<string, string>> = unused.unreferencedAnywhereNotes ?? {};
  if (Object.keys(notes).length > 0) {
    lines.push("### Notes", "");
    for (const [file, byName] of Object.entries(notes)) {
      for (const [name, note] of Object.entries(byName))
        lines.push(`- \`${file}\` \`${name}\`: ${note}`);
    }
    lines.push("");
  }
  bucket(
    lines,
    "Exports referenced in their own module",
    "No other file imports these names, but their own module uses them.",
    unused.referencedInModule ?? {},
  );
  bucket(
    lines,
    "Exports not classified",
    "The analysis could not read the source of these names.",
    unused.unclassifiedExports ?? {},
  );
  return lines.join("\n");
}

/**
 * Reads the JSON files in `outDir` and writes FILE_INVENTORY.md, duplicate-symbols.md and
 * unused-analysis.md next to them. Returns the paths it wrote.
 */
export function emitMarkdownReports(outDir: string, banner: BannerOptions = {}): string[] {
  const read = (name: string): Json => JSON.parse(readFileSync(join(outDir, name), "utf8"));
  const graph = read("dependency-graph.json");
  const bannerOptions = { command: MAP_REGENERATE_COMMAND, ...banner };
  const reports: [string, string][] = [
    ["FILE_INVENTORY.md", inventoryMarkdown(read("file-inventory.json"), graph.metadata.language)],
    ["duplicate-symbols.md", duplicatesMarkdown(read("duplicate-symbols.json"))],
    ["unused-analysis.md", unusedMarkdown(read("unused-analysis.json"), graph)],
  ];
  return reports.map(([name, body]) => {
    const path = join(outDir, name);
    writeReport(path, withBanner(body, bannerOptions));
    return path;
  });
}
