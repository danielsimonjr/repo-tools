/** duplicate-symbols.md and duplicate-symbols.json. */
import type { DupEntryTag, DuplicateSymbolEntry, DuplicateSymbolsReport } from "../duplicates.ts";

/** The duplicate-symbols.json text (2-space JSON, no trailing newline until fix R1). */
export function generateDuplicateSymbolsJson(report: DuplicateSymbolsReport): string {
  return JSON.stringify(report, null, 2);
}

/** A summary table of one tag tally. */
function summaryTable(byTag: Record<DupEntryTag, number>, total: number): string {
  return (
    "| Category | Count |\n| --- | --: |\n" +
    `| **TRUE_DUPLICATE** (actionable) | ${byTag.TRUE_DUPLICATE} |\n` +
    `| DISPATCH_VARIANT | ${byTag.DISPATCH_VARIANT} |\n` +
    `| ALIAS_DELEGATION | ${byTag.ALIAS_DELEGATION} |\n` +
    `| ALLOWLISTED | ${byTag.ALLOWLISTED} |\n` +
    `| _Total flagged names_ | ${total} |\n\n`
  );
}

/** The entry table, or `_None._`. */
function renderTable(entries: DuplicateSymbolEntry[]): string {
  if (entries.length === 0) return "_None._\n\n";
  let out = "| Name | Category | Defining files (package, public?, sub-tag) | Canonical hint |\n";
  out += "| --- | --- | --- | --- |\n";
  for (const e of entries) {
    const files = e.definers
      .map((d) => {
        const reasonSuffix = d.reason ? `: ${d.reason}` : "";
        return `\`${d.file}\` (${d.package}, ${d.public ? "public" : "internal"}, ${d.tag}${reasonSuffix})`;
      })
      .join("<br>");
    const hint = e.canonicalHint === "AMBIGUOUS" ? "**AMBIGUOUS**" : `\`${e.canonicalHint}\``;
    out += `| \`${e.name}\` | ${e.category} | ${files} | ${hint} |\n`;
  }
  return `${out}\n`;
}

/** One `###` section with the entries of one tag. */
function renderTaggedSection(
  title: string,
  entries: DuplicateSymbolEntry[],
  tag: DupEntryTag,
): string {
  return `### ${title}\n\n${renderTable(entries.filter((e) => e.tag === tag))}`;
}

/** The duplicate-symbols.md body (without the banner). */
export function generateDuplicateSymbolsMarkdown(report: DuplicateSymbolsReport): string {
  let md = "# Duplicate Symbols\n\n";
  md += `**Generated**: ${report.generated} (by tools/create-dependency-graph)\n\n`;
  md += "Names that are OWN-DEFINED (not merely re-exported) by >= 2 distinct files across ";
  md += "the monorepo, then CLASSIFIED (see `DupEntryTag`) so the actionable subset is clear: ";
  md += "`TRUE_DUPLICATE` (real merge targets) vs `DISPATCH_VARIANT` (>=2 `mathTyped(...)` ";
  md += "registrations of the same public name — distinct dispatch surfaces, Bucket C delegation ";
  md += "candidates, not copy-paste bodies), `ALIAS_DELEGATION` (a `const X = importedY` ";
  md += "forward, excluded once <2 real bodies remain), and `ALLOWLISTED` (matches ";
  md += "`duplicate-allowlist.json`: hot-path `is*` guards, AssemblyScript mirrors, ";
  md += "per-package `VERSION` strings).\n\n";
  md += `> **Note:** ${report.note}\n\n`;
  md += "## Summary — runtime (function/constant/class)\n\n";
  md += summaryTable(report.summary.runtimeByTag, report.runtime.length);
  md += "## Summary — types (interface/type/enum)\n\n";
  md += summaryTable(report.summary.typeByTag, report.types.length);
  md += "## Runtime duplicates\n\n";
  md += renderTaggedSection(
    "TRUE_DUPLICATE — actionable merge targets",
    report.runtime,
    "TRUE_DUPLICATE",
  );
  md += renderTaggedSection(
    "DISPATCH_VARIANT — distinct public typed-dispatch surfaces (Bucket C candidates)",
    report.runtime,
    "DISPATCH_VARIANT",
  );
  md += renderTaggedSection(
    "ALIAS_DELEGATION — const-alias forwards (not independent bodies)",
    report.runtime,
    "ALIAS_DELEGATION",
  );
  md += renderTaggedSection(
    "ALLOWLISTED — accepted layering (see duplicate-allowlist.json)",
    report.runtime,
    "ALLOWLISTED",
  );
  md += "## Type duplicates (lower priority)\n\n";
  md += renderTaggedSection("TRUE_DUPLICATE", report.types, "TRUE_DUPLICATE");
  md += renderTaggedSection("DISPATCH_VARIANT", report.types, "DISPATCH_VARIANT");
  md += renderTaggedSection("ALIAS_DELEGATION", report.types, "ALIAS_DELEGATION");
  md += renderTaggedSection("ALLOWLISTED", report.types, "ALLOWLISTED");
  return md;
}
