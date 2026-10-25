/**
 * TEST_COVERAGE.md and test-coverage.json.
 *
 * Port note: `generateTestCoverageJson` sorts `coverage.untestedFiles` and
 * `coverage.testedFiles` in place, as the pre-port generator did. Call it after the Markdown
 * report, because the Markdown groups the untested files in their original order.
 */

import { basename } from "node:path";
import { compareCodeUnits } from "../../sort.ts";
import type { TestCoverageAnalysis } from "../coverage.ts";

/** Raw coverage in percent with one decimal place, or `0`. */
function percent(tested: number, total: number): string {
  return total > 0 ? ((tested / total) * 100).toFixed(1) : "0";
}

/** The value of `coverageBasis` in test-coverage.json when an import names a namespace. */
export const NAMESPACE_IMPORT_BASIS = "namespace-import";

/**
 * The note on a report whose import edges name a namespace (a C# `using`). The percentage stays
 * the raw figure. The note says what the figure counts.
 */
export const NAMESPACE_IMPORT_COVERAGE_CAVEAT =
  "Coverage is counted by namespace import. A C# `using` directive usually names a namespace, not a type, so a test covers every file that declares the namespace. A namespace import does not show that a test uses the file. A test in the same namespace, or in a nested namespace, needs no `using` and does not count. The percentage can be too high or too low.";

/** The options that name how the report counts a covered file. */
export interface CoverageBasisOptions {
  /** True when an import names a namespace, not a symbol. Adds the basis and the caveat. */
  namespaceImportBasis?: boolean;
}

/** The TEST_COVERAGE.md body (without the banner). */
export function generateTestCoverageMarkdown(
  coverage: TestCoverageAnalysis,
  options: CoverageBasisOptions & { expectedTestHint?: boolean; policyPath?: string } = {},
): string {
  const hint = options.expectedTestHint ?? true;
  const lines: string[] = [];
  lines.push("# Test Coverage Analysis");
  lines.push("");
  const totalSource = coverage.sourceFiles.length;
  const totalTested = coverage.testedFiles.length;
  const totalUntested = coverage.untestedFiles.length;
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("|--------|-------|");
  lines.push(`| Total Source Files | ${totalSource} |`);
  lines.push(`| Total Test Files | ${coverage.testFiles.length} |`);
  lines.push(`| Source Files with Tests | ${totalTested} |`);
  lines.push(`| Source Files without Tests | ${totalUntested} |`);
  lines.push(`| Coverage (raw, direct-import) | **${percent(totalTested, totalSource)}%** |`);

  const b = coverage.policyBreakdown;
  // The note about the basis follows the summary table and comes before any policy text.
  const basisNote = options.namespaceImportBasis
    ? [`> ${NAMESPACE_IMPORT_COVERAGE_CAVEAT}`, ""]
    : [];
  if (coverage.policy) {
    lines.push(
      `| Coverage (effective, active code only) | **${b.effectivePercent}%** (${b.testedActive} / ${b.activeFiles}) |`,
    );
    lines.push("");
    lines.push(...basisNote);
    const policyPath = options.policyPath ?? "docs/architecture/coverage-policy.json";
    lines.push(
      "> The raw figure counts every source file the map finds, including files that no test " +
        "imports directly by design (for example generated code, type-only barrels and code in " +
        `another language). The **effective** figure excludes the files that \`${policyPath}\` ` +
        "classifies, so it shows the active code only.",
    );
    lines.push("");
    lines.push("### Untested-file breakdown by category");
    lines.push("");
    lines.push("| Category | Count | Why it is intentionally untested |");
    lines.push("|---|---:|---|");
    for (const [id, cat] of Object.entries(coverage.policy.categories)) {
      const count = b.byCategory[id] ?? 0;
      if (count === 0) continue;
      lines.push(`| **${cat.label}** | ${count} | ${cat.rationale.split(".")[0]}. |`);
    }
    lines.push(
      `| **Active (real gap — needs a test)** | ${b.byCategory.active_untested ?? 0} | These are the files that should grow a direct-import test. |`,
    );
    lines.push("");
  } else if (basisNote.length > 0) {
    // The table has no closing blank line when no policy is loaded.
    lines.push("", ...basisNote);
  }
  lines.push("---");
  lines.push("");

  // The headings state what the analyzer measures: an import from a test file. A file that only an
  // end-to-end spec exercises, with no import, is on this list.
  lines.push("## Source Files Not Imported By A Test");
  lines.push("");
  if (coverage.untestedFiles.length === 0) {
    lines.push("**Every source file is imported by a test file.** 🎉");
  } else {
    lines.push(
      `The following ${coverage.untestedFiles.length} source files are not directly imported by any test file:`,
    );
    lines.push("");
    const byModule = new Map<string, string[]>();
    for (const file of coverage.untestedFiles) {
      const parts = file.split("/");
      const module = parts.length >= 3 ? (parts[1] ?? "") : "root";
      const list = byModule.get(module) ?? [];
      list.push(file);
      byModule.set(module, list);
    }
    for (const [module, files] of byModule) {
      lines.push(`### ${module}/`);
      lines.push("");
      for (const file of files.sort()) {
        const fileName = basename(file, ".ts");
        lines.push(
          hint
            ? `- \`${file}\` → Expected test: \`tests/unit/${module}/${fileName}.test.ts\``
            : `- \`${file}\``,
        );
      }
      lines.push("");
    }
  }
  lines.push("---");
  lines.push("");

  lines.push("## Source Files Imported By A Test");
  lines.push("");
  lines.push("| Source File | Test Files |");
  lines.push("|-------------|------------|");
  for (const sourcePath of [...coverage.testedFiles].sort()) {
    const tests = coverage.coverageMap.get(sourcePath) || [];
    const shortSource = sourcePath.split("/").slice(-2).join("/");
    const shortTests = tests.map((t) => `\`${basename(t)}\``).join(", ");
    lines.push(`| \`${shortSource}\` | ${shortTests} |`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push("## Test File Details");
  lines.push("");
  lines.push("| Test File | Imports from Source |");
  lines.push("|-----------|---------------------|");
  for (const [testPath, sources] of coverage.testToSourceMap) {
    const shortTest = testPath.split("/").slice(-2).join("/");
    lines.push(`| \`${shortTest}\` | ${sources.length} files |`);
  }
  lines.push("");
  return lines.join("\n");
}

/** The test-coverage.json object. Sorts the tested and untested lists in place. */
export function generateTestCoverageJson(
  coverage: TestCoverageAnalysis,
  options: CoverageBasisOptions = {},
): object {
  const coverageMapObj: Record<string, string[]> = {};
  for (const [source, tests] of coverage.coverageMap) coverageMapObj[source] = tests;
  const testToSourceObj: Record<string, string[]> = {};
  for (const [test, sources] of coverage.testToSourceMap) testToSourceObj[test] = sources;
  const b = coverage.policyBreakdown;
  return {
    metadata: {
      totalSourceFiles: coverage.sourceFiles.length,
      totalTestFiles: coverage.testFiles.length,
      testedCount: coverage.testedFiles.length,
      untestedCount: coverage.untestedFiles.length,
      coveragePercent: percent(coverage.testedFiles.length, coverage.sourceFiles.length),
      ...(options.namespaceImportBasis
        ? {
            coverageBasis: NAMESPACE_IMPORT_BASIS,
            coverageCaveat: NAMESPACE_IMPORT_COVERAGE_CAVEAT,
          }
        : {}),
      effectiveCoverage: {
        policyLoaded: coverage.policy !== null,
        activeFiles: b.activeFiles,
        testedActive: b.testedActive,
        activeUntested: b.byCategory.active_untested ?? 0,
        excludedTotal: b.excludedTotal,
        percent: b.effectivePercent,
        breakdown: b.byCategory,
      },
    },
    untestedFiles: coverage.untestedFiles.sort(),
    testedFiles: coverage.testedFiles.sort(),
    coverageMap: coverageMapObj,
    testToSourceMap: testToSourceObj,
    classifiedUntested: b.classifiedUntested
      .slice()
      .sort((a, c) => compareCodeUnits(a.file, c.file)),
  };
}
