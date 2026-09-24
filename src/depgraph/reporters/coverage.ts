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

/** The TEST_COVERAGE.md body (without the banner). */
export function generateTestCoverageMarkdown(
  coverage: TestCoverageAnalysis,
  today: string,
): string {
  const lines: string[] = [];
  lines.push("# Test Coverage Analysis");
  lines.push("");
  lines.push(`**Generated**: ${today}`);
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
  if (coverage.policy) {
    lines.push(
      `| Coverage (effective, active code only) | **${b.effectivePercent}%** (${b.testedActive} / ${b.activeFiles}) |`,
    );
    lines.push("");
    lines.push(
      "> The raw figure counts every source file the CDG tool finds, including code that is intentionally not direct-imported by a vitest `*.test.ts` (synced mathjs categories, AssemblyScript sources, type-only barrels, …). The **effective** figure excludes those per `docs/architecture/coverage-policy.json` so the number reflects the genuinely-active hand-written code only. See [`COVERAGE_POLICY.md`](./COVERAGE_POLICY.md) for the policy.",
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
  }
  lines.push("---");
  lines.push("");

  lines.push("## Source Files Without Test Coverage");
  lines.push("");
  if (coverage.untestedFiles.length === 0) {
    lines.push("**All source files have test coverage!** 🎉");
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
        lines.push(`- \`${file}\` → Expected test: \`tests/unit/${module}/${fileName}.test.ts\``);
      }
      lines.push("");
    }
  }
  lines.push("---");
  lines.push("");

  lines.push("## Source Files With Test Coverage");
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
export function generateTestCoverageJson(coverage: TestCoverageAnalysis, nowIso: string): object {
  const coverageMapObj: Record<string, string[]> = {};
  for (const [source, tests] of coverage.coverageMap) coverageMapObj[source] = tests;
  const testToSourceObj: Record<string, string[]> = {};
  for (const [test, sources] of coverage.testToSourceMap) testToSourceObj[test] = sources;
  const b = coverage.policyBreakdown;
  return {
    metadata: {
      generatedAt: nowIso,
      totalSourceFiles: coverage.sourceFiles.length,
      totalTestFiles: coverage.testFiles.length,
      testedCount: coverage.testedFiles.length,
      untestedCount: coverage.untestedFiles.length,
      coveragePercent: percent(coverage.testedFiles.length, coverage.sourceFiles.length),
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
