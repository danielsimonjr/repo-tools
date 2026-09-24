/** FILE_INVENTORY.md and file-inventory.json. */
import type { FileDisposition, FileInventory } from "../inventory.ts";

/** The disposition legend, in report order. */
export const FILE_DISPOSITION_LEGEND: Array<[FileDisposition, string]> = [
  ["reachable", "A `src/` file in the module graph, reachable from a root."],
  [
    "build-entry",
    "A detected build/subpath/`bin`/worker/`tsup.config` root (index, internal, cli, render-file, run-worker, …).",
  ],
  ["test-only", "A `src/` file not reachable from src roots but imported by a test."],
  [
    "orphan",
    "A `src/` file reachable from nothing — a delete/wire candidate (hard-fails the gate).",
  ],
  ["test", "A test source file (under a `tests/` dir, or a `*.test.ts`/`*.spec.ts`)."],
  ["tool", "A file under `tools/` — agent-only meta-tooling (CDG/QDG/benchmarks)."],
  ["config", "A build/test config source (`*.config.ts`: vitest/tsup, per-package or root)."],
  ["example", "An `examples/` or `docs/` reference/illustration source."],
];

/** The file-inventory.json text (2-space JSON, no trailing newline). */
export function generateFileInventoryJson(inv: FileInventory): string {
  return JSON.stringify(inv, null, 2);
}

/** The FILE_INVENTORY.md body (without the banner). */
export function generateFileInventoryMarkdown(inv: FileInventory): string {
  const lines: string[] = [];
  lines.push("# Complete File Inventory");
  lines.push("");
  lines.push(
    "Every tracked `.ts` file in the repo — package `src/` and `tests/`, the repo-root " +
      "cross-package `tests/`, `tools/`, build/test `*.config.ts`, `examples/`, and `docs/` " +
      "reference sources — tagged with a disposition. A completeness census: no `.ts` may be " +
      "silently missing. The self-check gate (`verifyFileCensus`) does a MAXIMAL, " +
      "location-agnostic repo walk (broader than this census’s enumerated discovery) and " +
      "HARD-FAILS `npm run docs:deps` if any `.ts` on disk is unaccounted, or if any `orphan` exists.",
  );
  lines.push("");
  lines.push(
    "**Excluded by design (not source):** `node_modules/`, `dist/`, `*.d.ts` ambient " +
      "declarations, and dot-directories (`.git/`, `.remember/`, `.changeset/`, …). The " +
      "walk set equals the git-tracked `.ts` files, so there is no silent allowlist — every " +
      "tracked `.ts` appears below with an explicit disposition.",
  );
  lines.push("");
  lines.push(`**Total files**: ${inv.totalFiles}`);
  lines.push("");
  lines.push("## Disposition counts");
  lines.push("");
  lines.push("| Disposition | Count | Meaning |");
  lines.push("| --- | --: | --- |");
  for (const [disp, meaning] of FILE_DISPOSITION_LEGEND) {
    lines.push(`| \`${disp}\` | ${inv.byDisposition[disp] ?? 0} | ${meaning} |`);
  }
  lines.push(`| **Total** | **${inv.totalFiles}** | |`);
  lines.push("");
  lines.push("## Per-area counts");
  lines.push("");
  lines.push("| Area | Files |");
  lines.push("| --- | --: |");
  for (const area of Object.keys(inv.byArea).sort()) {
    lines.push(`| \`${area}\` | ${inv.byArea[area]} |`);
  }
  lines.push("");
  lines.push("## Per-package counts");
  lines.push("");
  lines.push("| Package | Files |");
  lines.push("| --- | --: |");
  for (const pkg of Object.keys(inv.byPackage).sort()) {
    lines.push(`| \`${pkg}\` | ${inv.byPackage[pkg]} |`);
  }
  lines.push("");
  lines.push("## All files");
  lines.push("");
  lines.push("| file | package | area | disposition |");
  lines.push("| --- | --- | --- | --- |");
  for (const r of inv.files) {
    lines.push(`| \`${r.file}\` | ${r.package} | ${r.area} | ${r.disposition} |`);
  }
  lines.push("");
  return lines.join("\n");
}
