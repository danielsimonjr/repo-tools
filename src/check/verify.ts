/**
 * The verdict of `repo-tools check` (design section 15): each claim of each document against
 * the measured metrics.
 *
 * Every failure mode is a problem line. An empty list means "checked, and every claim matched",
 * never "found nothing to check": a document without a Verification section, a section without a
 * row, an unknown claim, and a metric that the graph build declared unreliable are each reported.
 */
import { NO_VERIFICATION_MARKER, parseClaims, scanVerification } from "./claims.ts";

/** The value of one metric. Only scalar values are metrics. */
export type MetricValue = string | number | boolean;

/** What the graph build measured. */
export interface Measured {
  /** The claim names that a document can hold, and their values. */
  metrics: ReadonlyMap<string, MetricValue>;
  /** The warnings of the graph build, read after every emitter ran. */
  warnings: readonly string[];
}

/** One Markdown document: its file name and its text. */
export interface DocFile {
  name: string;
  text: string;
}

/** The outcome of one check. */
export interface Verdict {
  /** One line per problem, in document order. Empty when every claim matched. */
  problems: string[];
  /** The claims that were compared (and, when `problems` is empty, matched). */
  claimsChecked: number;
  /** The documents whose claims were compared. */
  docsChecked: number;
  /** The documents that opted out with the marker. */
  docsOptedOut: number;
}

/** Metrics whose value is a floor, not a count, when `circularDepsTruncated` is true. */
const TRUNCATABLE = new Set(["runtimeCircularDeps", "typeOnlyCircularDeps"]);

/**
 * Metrics that count files or exports with no importer, or unreached from a root. A drift line
 * for one of them reads as "so these files are dead", which these counts do not say: a file that
 * only a dynamic `import()` with a computed path loads is live and still counts here.
 */
const DEAD_LOOKING = new Set([
  "orphanedFiles",
  "unusedExportsCount",
  "unusedExportCount",
  "dormantFiles",
  "testOnlyFiles",
  "unreferencedAnywhereCount",
  "noImporterFileCount",
]);
const DEAD_LOOKING_NOTE =
  " (this count is not a deletion list -- it can include files reached only via a dynamic " +
  "import() that the static reader cannot see; verify before deleting anything)";

/** The metrics that a build with no root makes unusable. Each one counts from the root set. */
const REACHABILITY = [
  "orphanedFiles",
  "reachableFiles",
  "dormantFiles",
  "testOnlyFiles",
  "entryRoots",
  "noImporterFileCount",
];

/**
 * A warning text that makes metrics unverifiable, and the metrics that it makes so. The list is
 * narrow on purpose: an unknown warning taints nothing, and a package-derivation warning only
 * affects the `package` of a file, which no claim names. `unusedExportsCount` is not in the set:
 * it counts import edges and never reads the roots.
 */
const TAINTING_WARNINGS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["could not determine any entry-point roots", REACHABILITY],
];

/** Claim name to the warning text that makes it unverifiable. */
function taintedMetrics(warnings: readonly string[]): Map<string, string> {
  const tainted = new Map<string, string>();
  for (const warning of warnings) {
    for (const [marker, names] of TAINTING_WARNINGS) {
      if (!warning.includes(marker)) continue;
      for (const name of names) if (!tainted.has(name)) tainted.set(name, warning);
    }
  }
  return tainted;
}

/** The text of a metric as a document states it. */
const textOf = (value: MetricValue): string => String(value);

/** True when a stated value equals the metric. A boolean matches in any letter case. */
function matches(stated: string, actual: MetricValue): boolean {
  if (typeof actual === "boolean") return stated.toLowerCase() === textOf(actual);
  return stated === textOf(actual);
}

/**
 * Checks the claims of `docs` against `measured`. A document that holds a marker of `markers`
 * is skipped: the marker is checked before the sections, so it wins over a heading that happens
 * to look like a Verification heading.
 */
export function verifyDocs(
  docs: readonly DocFile[],
  measured: Measured,
  markers: readonly string[] = [NO_VERIFICATION_MARKER],
): Verdict {
  const { metrics, warnings } = measured;
  const truncated = metrics.get("circularDepsTruncated") === true;
  const tainted = taintedMetrics(warnings);
  const verdict: Verdict = { problems: [], claimsChecked: 0, docsChecked: 0, docsOptedOut: 0 };
  const problem = (line: string): number => verdict.problems.push(line);
  for (const { name, text } of docs) {
    if (markers.some((marker) => text.includes(marker))) {
      verdict.docsOptedOut += 1;
      continue;
    }
    if (!scanVerification(text).found) {
      problem(
        `${name}: no '## Verification' section found -- cannot check this document for drift. ` +
          "This is a failure, not a pass: a missing or mistitled Verification heading must not " +
          "look like 'checked, everything matched'. If this document has no verifiable claim, " +
          `opt out with '${NO_VERIFICATION_MARKER}' in its source.`,
      );
      continue;
    }
    const claims = parseClaims(text);
    if (claims.length === 0) {
      problem(
        `${name}: has a '## Verification' section but no parseable claim rows in it -- an ` +
          "empty or malformed table is reported like a missing section, not as 'nothing to check'.",
      );
      continue;
    }
    verdict.docsChecked += 1;
    for (const { claim, value } of claims) {
      verdict.claimsChecked += 1;
      const actual = metrics.get(claim);
      if (actual === undefined) {
        problem(
          `${name}: unknown claim '${claim}' - cannot verify (no metric by this name; an ` +
            "unrecognised claim is reported, never silently skipped -- check the spelling of the name)",
        );
      } else if (TRUNCATABLE.has(claim) && truncated) {
        problem(
          `${name}: ${claim} claims ${value}, but the cycle enumeration of this repository was ` +
            "truncated (circularDepsTruncated=true) -- the count is a floor, not exact, so this " +
            "claim cannot be verified either way. It is not reported as a match or a mismatch.",
        );
      } else if (tainted.has(claim)) {
        problem(
          `${name}: ${claim} claims ${value}, but the graph build of this repository emitted a ` +
            `warning that makes this metric unusable as ground truth ('${tainted.get(claim)}') ` +
            "-- it cannot be verified either way. It is not reported as a match or a mismatch.",
        );
      } else if (!matches(value, actual)) {
        const note = DEAD_LOOKING.has(claim) ? DEAD_LOOKING_NOTE : "";
        problem(`${name}: ${claim} claims ${value} but actual is ${textOf(actual)}${note}`);
      }
    }
  }
  return verdict;
}
