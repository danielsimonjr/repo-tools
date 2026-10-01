/**
 * The verdict of `repo-tools check` (design section 15): each claim of each document, compared
 * with the measured metrics. These tests feed fixed metrics, so they do not build a graph. The
 * end-to-end cases, with a real graph, are in `check-command.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { NO_VERIFICATION_MARKER } from "../../src/check/claims.ts";
import { type Measured, type MetricValue, verifyDocs } from "../../src/check/verify.ts";

const TABLE = "| Claim | Value | Source |\n|---|---|---|\n";

/** Measured metrics and warnings. */
function measured(
  values: Record<string, MetricValue> = { totalFiles: 1 },
  warnings: string[] = [],
): Measured {
  return { metrics: new Map(Object.entries(values)), warnings };
}

/** A document whose Verification table holds `rows` (`[claim, value]` pairs). */
function doc(name: string, rows: [string, string][]): { name: string; text: string } {
  const body = rows.map(([c, v]) => `| ${c} | ${v} | dependency-graph.json |`).join("\n");
  return { name, text: `## Verification\n${TABLE}${body}\n` };
}

const MARKERS = [NO_VERIFICATION_MARKER];
const verify = (docs: { name: string; text: string }[], m = measured(), markers = MARKERS) =>
  verifyDocs(docs, m, markers);

const ROOTS_WARNING =
  "could not determine any entry-point roots: no package.json main/module/bin/exports resolved " +
  "to a known source file, and no src/index.* fallback was found";

describe("verifyDocs: a matching claim", () => {
  test("gives no problem and counts the claim", () => {
    const r = verify([doc("OVERVIEW.md", [["totalFiles", "1"]])]);
    expect(r.problems).toEqual([]);
    expect(r).toMatchObject({ claimsChecked: 1, docsChecked: 1, docsOptedOut: 0 });
  });

  test("a string metric is compared as text", () => {
    const m = measured({ language: "typescript" });
    expect(verify([doc("A.md", [["language", "typescript"]])], m).problems).toEqual([]);
    expect(verify([doc("A.md", [["language", "python"]])], m).problems).toHaveLength(1);
  });

  test("a boolean metric matches in any letter case", () => {
    const m = measured({ circularDepsTruncated: false });
    for (const value of ["false", "False", "FALSE"]) {
      expect(verify([doc("A.md", [["circularDepsTruncated", value]])], m).problems).toEqual([]);
    }
    const drift = verify([doc("A.md", [["circularDepsTruncated", "true"]])], m).problems;
    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain("actual is false");
  });

  test("a number is compared exactly as text", () => {
    const m = measured({ totalFiles: 10 });
    expect(verify([doc("A.md", [["totalFiles", "10"]])], m).problems).toEqual([]);
    expect(verify([doc("A.md", [["totalFiles", "10.0"]])], m).problems).toHaveLength(1);
    expect(verify([doc("A.md", [["totalFiles", "010"]])], m).problems).toHaveLength(1);
  });
});

describe("verifyDocs: drift", () => {
  test("names the document, the claim, the claimed value and the actual value", () => {
    const problems = verify([doc("OVERVIEW.md", [["totalFiles", "99"]])]).problems;
    expect(problems).toEqual(["OVERVIEW.md: totalFiles claims 99 but actual is 1"]);
  });

  test("a dead-looking metric carries the not-a-deletion-list note", () => {
    for (const name of [
      "orphanedFiles",
      "unusedExportsCount",
      "unusedExportCount",
      "dormantFiles",
      "testOnlyFiles",
      "unreferencedAnywhereCount",
      "noImporterFileCount",
    ]) {
      const problems = verify([doc("A.md", [[name, "5"]])], measured({ [name]: 2 })).problems;
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(`${name} claims 5 but actual is 2`);
      expect(problems[0]).toContain("not a deletion list");
    }
  });

  test("a count metric has no such note", () => {
    const problems = verify([doc("A.md", [["totalFiles", "5"]])]).problems;
    expect(problems[0]).not.toContain("deletion");
  });

  test("every drifting claim is reported, in document order, and every document is read", () => {
    const m = measured({ a: 1, b: 2 });
    const problems = verify(
      [
        doc("ONE.md", [
          ["b", "9"],
          ["a", "9"],
        ]),
        doc("TWO.md", [["a", "1"]]),
        doc("THREE.md", [["a", "8"]]),
      ],
      m,
    ).problems;
    expect(problems).toEqual([
      "ONE.md: b claims 9 but actual is 2",
      "ONE.md: a claims 9 but actual is 1",
      "THREE.md: a claims 8 but actual is 1",
    ]);
  });
});

describe("verifyDocs: an unknown claim", () => {
  test("is reported, never skipped", () => {
    const problems = verify([doc("A.md", [["notAThing", "3"]])]).problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("A.md: unknown claim 'notAThing'");
    expect(problems[0]).toContain("never silently skipped");
  });

  test.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "the inherited name %p is an unknown claim",
    (name) => {
      const problems = verify([doc("A.md", [[name, "1"]])]).problems;
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("unknown claim");
    },
  );
});

describe("verifyDocs: a metric that cannot be verified", () => {
  const truncated = measured({
    runtimeCircularDeps: 1,
    typeOnlyCircularDeps: 0,
    circularDepsTruncated: true,
    totalFiles: 1,
  });

  test("a cycle count is no match and no mismatch when the enumeration was truncated", () => {
    for (const name of ["runtimeCircularDeps", "typeOnlyCircularDeps"]) {
      // The claim is equal to the floor, and it is still not certified.
      const value = String(truncated.metrics.get(name));
      const problems = verify([doc("A.md", [[name, value]])], truncated).problems;
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(`A.md: ${name} claims ${value}`);
      expect(problems[0]).toContain("circularDepsTruncated=true");
      expect(problems[0]).toContain("cannot be verified");
      expect(problems[0]).not.toContain("but actual is");
    }
  });

  test("another metric still verifies when the enumeration was truncated", () => {
    expect(verify([doc("A.md", [["totalFiles", "1"]])], truncated).problems).toEqual([]);
  });

  test("a cycle count verifies when the enumeration was not truncated", () => {
    const m = measured({ runtimeCircularDeps: 2, circularDepsTruncated: false });
    expect(verify([doc("A.md", [["runtimeCircularDeps", "2"]])], m).problems).toEqual([]);
  });

  const TAINTED = [
    "orphanedFiles",
    "reachableFiles",
    "dormantFiles",
    "testOnlyFiles",
    "entryRoots",
    "noImporterFileCount",
  ];
  const rootless = (): Measured =>
    measured(
      { ...Object.fromEntries(TAINTED.map((n) => [n, 0])), totalFiles: 2, unusedExportsCount: 0 },
      [ROOTS_WARNING],
    );

  test("each reachability metric is unverifiable when no root was found", () => {
    const problems = verify(
      [
        doc(
          "A.md",
          TAINTED.map((n) => [n, "0"]),
        ),
      ],
      rootless(),
    ).problems;
    expect(problems).toHaveLength(TAINTED.length);
    for (const name of TAINTED) {
      const line = problems.find((p) => p.includes(`${name} claims 0`));
      expect(line).toBeDefined();
      expect(line).toContain("cannot be verified");
      expect(line).toContain("could not determine any entry-point roots");
    }
  });

  test("a claim at the emitted value is not a match either", () => {
    const problems = verify([doc("A.md", [["orphanedFiles", "2"]])], {
      metrics: new Map([["orphanedFiles", 2]]),
      warnings: [ROOTS_WARNING],
    }).problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]).not.toContain("claims 2 but actual is 2");
    expect(problems[0]).toContain("cannot be verified");
  });

  test("a metric outside that set still verifies despite the roots warning", () => {
    const m = rootless();
    expect(verify([doc("A.md", [["totalFiles", "2"]])], m).problems).toEqual([]);
    // The unused-export count does not read the roots, so the warning does not taint it.
    expect(verify([doc("A.md", [["unusedExportsCount", "0"]])], m).problems).toEqual([]);
  });

  test("a warning of another kind taints nothing", () => {
    const m = measured({ orphanedFiles: 0, totalFiles: 1 }, [
      "no readable package.json at the root -- package derivation skipped",
      "workspace candidate 'x' skipped",
    ]);
    expect(verify([doc("A.md", [["orphanedFiles", "0"]])], m).problems).toEqual([]);
    expect(verify([doc("A.md", [["totalFiles", "1"]])], m).problems).toEqual([]);
  });
});

describe("verifyDocs: a document without a usable Verification section", () => {
  test("a mistitled heading is a problem that names the heading rule", () => {
    const text = `## Current Metrics\n${TABLE}| totalFiles | 99 | file-inventory.json |\n`;
    const problems = verify([{ name: "OVERVIEW.md", text }]).problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("OVERVIEW.md: no '## Verification' section found");
    expect(problems[0]).toContain(NO_VERIFICATION_MARKER);
  });

  test("an empty section is a problem with other words", () => {
    const missing = verify([{ name: "A.md", text: "## Notes\nx\n" }]).problems[0] ?? "";
    const empty =
      verify([{ name: "A.md", text: "## Verification\n\nNothing here yet.\n" }]).problems[0] ?? "";
    expect(missing).toContain("no '## Verification' section found");
    expect(empty).not.toContain("no '## Verification' section found");
    expect(empty).toContain("A.md: has a '## Verification' section but no parseable claim rows");
  });

  test("a section with only a header row is empty", () => {
    const empty = verify([{ name: "A.md", text: `## Verification\n${TABLE}` }]).problems;
    expect(empty).toHaveLength(1);
    expect(empty[0]).toContain("no parseable claim rows");
  });

  test("the problems of several documents are all reported", () => {
    const problems = verify([
      { name: "A.md", text: "no heading\n" },
      { name: "B.md", text: "## Verification\n" },
      doc("C.md", [["totalFiles", "5"]]),
    ]).problems;
    expect(problems.map((p) => p.split(":")[0])).toEqual(["A.md", "B.md", "C.md"]);
  });
});

describe("verifyDocs: the no-verification marker", () => {
  test("a document with the marker is a clean pass and is counted as opted out", () => {
    const r = verify([
      { name: "README.md", text: `${NO_VERIFICATION_MARKER}\n# Prose\n\nNo claims.\n` },
    ]);
    expect(r.problems).toEqual([]);
    expect(r).toMatchObject({ claimsChecked: 0, docsChecked: 0, docsOptedOut: 1 });
  });

  test("the marker wins over a claim that would drift", () => {
    const text = `${NO_VERIFICATION_MARKER}\n${doc("X.md", [["totalFiles", "99"]]).text}`;
    expect(verify([{ name: "X.md", text }]).problems).toEqual([]);
  });

  test("the marker wins over a heading that only mentions verification", () => {
    const text =
      `${NO_VERIFICATION_MARKER}\n# Generated\n\n## Verification of the SHA-384 manifest\n\n` +
      "| File | Imports | Type |\n|---|---|---|\n| `./a.js` | `B` | Import |\n";
    expect(verify([{ name: "GENERATED.md", text }]).problems).toEqual([]);
  });

  test("a configured marker opts out too, and the default marker still does", () => {
    const custom = "<!-- my-tool:skip -->";
    const markers = [NO_VERIFICATION_MARKER, custom];
    const a = { name: "A.md", text: `${custom}\n# Prose\n` };
    const b = { name: "B.md", text: `${NO_VERIFICATION_MARKER}\n# Prose\n` };
    expect(verify([a, b], measured(), markers).problems).toEqual([]);
    // Without the custom marker, the same document is a problem.
    expect(verify([a], measured(), MARKERS).problems).toHaveLength(1);
  });

  describe("only a whole line is a marker", () => {
    const STALE = doc("A.md", [["totalFiles", "99"]]).text;
    const DRIFT = ["A.md: totalFiles claims 99 but actual is 1"];

    test("a marker quoted in prose does not opt out, so the stale claim fails", () => {
      const text = `# Notes\n\nThe line ${NO_VERIFICATION_MARKER} opts a document out.\n\n${STALE}`;
      const r = verify([{ name: "A.md", text }]);
      expect(r.problems).toEqual(DRIFT);
      expect(r).toMatchObject({ docsChecked: 1, docsOptedOut: 0 });
    });

    test("a marker in an inline code span does not opt out", () => {
      const text = `Write \`${NO_VERIFICATION_MARKER}\` to opt out.\n\n\`${NO_VERIFICATION_MARKER}\`\n\n${STALE}`;
      expect(verify([{ name: "A.md", text }]).problems).toEqual(DRIFT);
    });

    test("a marker in a claim table cell does not opt out", () => {
      const text = `## Verification\n${TABLE}| totalFiles | 99 | ${NO_VERIFICATION_MARKER} |\n`;
      expect(verify([{ name: "A.md", text }]).problems).toEqual(DRIFT);
    });

    test("text before or after the marker on its line does not opt out", () => {
      for (const line of [`see ${NO_VERIFICATION_MARKER}`, `${NO_VERIFICATION_MARKER} (skip)`]) {
        expect(verify([{ name: "A.md", text: `${line}\n${STALE}` }]).problems).toEqual(DRIFT);
      }
    });

    test("a document without the marker is no different: a stale claim fails", () => {
      expect(verify([{ name: "A.md", text: STALE }]).problems).toEqual(DRIFT);
    });

    test("a marker alone on its line opts out, wherever the line stands", () => {
      const bom = String.fromCharCode(0xfeff);
      const marker = NO_VERIFICATION_MARKER;
      const cases: Record<string, string> = {
        "first line": `${marker}\n${STALE}`,
        "last line, no final newline": `${STALE}\n${marker}`,
        "middle of the document": `# Title\n\n${marker}\n\n${STALE}`,
        "indented, with trailing spaces": `# Title\n   ${marker}  \n${STALE}`,
        "CRLF line ends": `${marker}\r\n${STALE.replaceAll("\n", "\r\n")}`,
        "CR line ends": `# Title\r${marker}\r${STALE.replaceAll("\n", "\r")}`,
        "after a byte-order mark": `${bom}${marker}\n${STALE}`,
      };
      for (const [label, text] of Object.entries(cases)) {
        const r = verify([{ name: "A.md", text }]);
        expect({ label, problems: r.problems, optedOut: r.docsOptedOut }).toEqual({
          label,
          problems: [],
          optedOut: 1,
        });
      }
    });

    test("a configured marker follows the same rule", () => {
      const custom = "<!-- my-tool:skip -->";
      const markers = [NO_VERIFICATION_MARKER, custom];
      const quoted = { name: "A.md", text: `Use ${custom} to skip.\n${STALE}` };
      const alone = { name: "B.md", text: `${STALE}\n${custom}\n` };
      expect(verify([quoted], measured(), markers).problems).toEqual(DRIFT);
      expect(verify([alone], measured(), markers).problems).toEqual([]);
    });

    test("a blank configured marker opts out no document", () => {
      for (const blank of ["", "   "]) {
        const text = `# Title\n\n${STALE}`;
        const markers = [NO_VERIFICATION_MARKER, blank];
        expect(verify([{ name: "A.md", text }], measured(), markers).problems).toEqual(DRIFT);
      }
    });
  });
});
