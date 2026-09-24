/** unused-analysis.md: unused files, dormant files and unused exports. */
import type { DormantSplit } from "../analysis.ts";
import type { UnusedAnalysis, UnusedExport, WorkspacePackage } from "../types.ts";

/** Groups root-relative files by workspace package directory, else `(root)`. */
function groupByPkg(
  files: string[],
  workspaces: Map<string, WorkspacePackage>,
): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const f of files) {
    let pkg = "(root)";
    for (const [, ws] of workspaces) {
      if (f.startsWith(`${ws.directory}/`)) {
        pkg = ws.directory;
        break;
      }
    }
    const list = m.get(pkg) ?? [];
    list.push(f);
    m.set(pkg, list);
  }
  return m;
}

/** One `###` block per file, with an optional note per export. */
function renderByFile(exports: UnusedExport[], note?: (e: UnusedExport) => string): string {
  let out = "";
  const byFile = new Map<string, UnusedExport[]>();
  for (const exp of exports) {
    const list = byFile.get(exp.file) ?? [];
    list.push(exp);
    byFile.set(exp.file, list);
  }
  for (const [file, exps] of byFile) {
    out += `### \`${file}\`\n\n`;
    for (const exp of exps) out += `- \`${exp.name}\` (${exp.type})${note ? note(exp) : ""}\n`;
    out += "\n";
  }
  return out;
}

/** The unused-analysis.md body (without the banner). */
export function generateUnusedReport(
  unused: UnusedAnalysis,
  dormant: DormantSplit,
  workspaces: Map<string, WorkspacePackage>,
  today: string,
): string {
  const deadExports = unused.unusedExports.filter((e) => e.inFileRefs === 0);
  const contractExports = unused.unusedExports.filter((e) => e.inFileRefs > 0);
  const renderDormant = (files: string[]): string => {
    if (files.length === 0) return "_None._\n\n";
    let out = "";
    for (const [pkg, fs] of [...groupByPkg(files, workspaces)].sort()) {
      out += `### \`${pkg}\` (${fs.length})\n\n`;
      for (const f of fs) out += `- \`${f}\`\n`;
      out += "\n";
    }
    return out;
  };

  let r = "# Unused Files and Exports Analysis\n\n";
  r += `**Generated**: ${today}\n\n`;
  r += "## Summary\n\n";
  r += `- **Potentially unused files**: ${unused.unusedFiles.length}\n`;
  r += `- **Dormant files** (runtime code on disk, unreachable from any entry/build root): ${dormant.dormantAll.length}\n`;
  r += `  - **Orphaned (reachable from nothing — delete/wire candidates)**: ${dormant.orphaned.length}\n`;
  r += `  - **Test-only (exercised by a test, ships nothing)**: ${dormant.testOnly.length}\n`;
  r += `- **Potentially unused exports**: ${unused.unusedExports.length}\n`;
  r += `  - **Unreferenced anywhere (deletion candidates)**: ${deadExports.length}\n`;
  r += `  - **Referenced in-module (type contracts / helpers backing live exports)**: ${contractExports.length}\n\n`;

  r += "## Dormant Files — Orphaned (delete/wire candidates)\n\n";
  r += "Runtime source files reachable from NO root and NO test. Each is either dead code\n";
  r += "to delete, or a root the tool cannot see (a new build/worker entry, a\n";
  r += "`new URL()`-loaded script, or a side-effect-only module) — in which case wire it\n";
  r += "or seed it. Verify before deleting.\n\n";
  r += renderDormant(dormant.orphaned);

  r += "## Dormant Files — Test-only (ships nothing, but exercised)\n\n";
  r += "Not reachable from any package entry point, but imported by a test — deliberately\n";
  r += "kept, standalone-tested code (e.g. legacy signal kernels) or a helper a test drives\n";
  r += "directly. Not dead; not shipped. No action needed.\n\n";
  r += renderDormant(dormant.testOnly);

  r += "## Potentially Unused Files\n\n";
  r += "These files are not imported by any other file in the codebase:\n\n";
  for (const file of unused.unusedFiles) r += `- \`${file}\`\n`;

  r += "\n## Unreferenced Anywhere (deletion candidates)\n\n";
  r += "Not imported by any other file AND not referenced within their own module — ";
  r += "the true dead-code candidates. Verify each isn't consumed by a mechanism the\n";
  r +=
    "parser can't see (dynamic access, docs examples, published-API contract) before deleting.\n\n";
  r += renderByFile(deadExports);

  r += "\n## Referenced In-Module (type contracts / helpers backing live exports)\n\n";
  r += "Not imported cross-file, but referenced within their own module — they type or\n";
  r += "support exports that ARE used, so they cannot be deleted in isolation. Mostly\n";
  r += "interfaces typing live guards and per-package API completeness, not rot.\n\n";
  r += renderByFile(
    contractExports,
    (e) => ` — ${e.inFileRefs} in-file ref${e.inFileRefs === 1 ? "" : "s"}`,
  );
  return r;
}
