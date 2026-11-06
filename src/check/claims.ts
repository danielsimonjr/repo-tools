/**
 * The claims of a document (design section 15): the rows of its `## Verification` table.
 *
 * A claim is a row `| name | value | source |` inside a section whose heading IS "Verification"
 * (with an optional colon and an optional trailing parenthesis). The section ends at the next
 * heading of the same or a shallower level. A table outside such a section is not a claim, and a
 * heading that only mentions the word does not open a section.
 */
import { VERIFICATION_MARKER } from "../depgraph/reporters/banner.ts";

/**
 * The line that opts a document out of the check. `repo-tools map` writes it at the top of each
 * generated report, so the check never reads a generated table as a claim.
 */
export const NO_VERIFICATION_MARKER = VERIFICATION_MARKER;

/** The opt-out markers: the built-in one, and the config key map.verificationMarker when it is set. */
export function verificationMarkers(configured: string | null): string[] {
  return configured === null || configured === NO_VERIFICATION_MARKER
    ? [NO_VERIFICATION_MARKER]
    : [NO_VERIFICATION_MARKER, configured];
}

/** One row of a Verification table. */
export interface Claim {
  /** The metric name. */
  claim: string;
  /** The value that the document states, as text. */
  value: string;
  /** The artifact that the document names as the source. */
  source: string;
}

const ROW = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/;
const HEADING = /^(#{1,6})\s*(.+?)\s*$/;
/** The heading must BE "Verification", not mention it. */
const VERIFICATION_HEADING = /^\s*verification\s*:?\s*(\([^)]*\))?\s*$/i;
/** The header row and the separator rows are not claims. */
const HEADER_CLAIMS = new Set(["claim", "---"]);

/** What one pass over a document finds. */
export interface Scan {
  claims: Claim[];
  /** True when any heading is a Verification heading, whether or not it holds a row. */
  found: boolean;
}

/**
 * Walks the lines of `markdown` and calls `onRow` for each claim row of a Verification section, with
 * the index of its line in `lines`. Returns true when any heading is a Verification heading.
 */
function walkRows(lines: readonly string[], onRow: (claim: Claim, index: number) => void): boolean {
  let found = false;
  let inSection = false;
  let sectionLevel = 0;
  lines.forEach((raw, index) => {
    const line = raw.trimEnd();
    const heading = line.trimStart().startsWith("#") ? HEADING.exec(line) : null;
    if (heading) {
      const level = (heading[1] as string).length;
      if (inSection && level <= sectionLevel) inSection = false;
      if (VERIFICATION_HEADING.test(heading[2] as string)) {
        inSection = true;
        found = true;
        sectionLevel = level;
      }
      return;
    }
    if (!inSection) return;
    const row = ROW.exec(line.trim());
    if (!row) return;
    const [claim, value, source] = [row[1], row[2], row[3]].map((cell) => (cell as string).trim());
    if (HEADER_CLAIMS.has((claim as string).toLowerCase())) return;
    if (/^[-: ]*$/.test(claim as string)) return;
    onRow({ claim: claim as string, value: value as string, source: source as string }, index);
  });
  return found;
}

/** Reads the claims of `markdown` and whether it has a Verification section at all. */
export function scanVerification(markdown: string): Scan {
  const claims: Claim[] = [];
  const found = walkRows(markdown.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/), (claim) =>
    claims.push(claim),
  );
  return { claims, found };
}

/** The value cell of a claim row: the text before it, the value, and the text after it. */
const VALUE_CELL = /^(\s*\|[^|]*\|\s*)([^|]*?)(\s*\|[\s\S]*)$/;

/**
 * Returns `markdown` with the value cell of each claim row replaced by `next(claim)`, when `next`
 * gives a value. Every other character, the line ends and a leading byte order mark included, is kept.
 */
export function rewriteClaimValues(
  markdown: string,
  next: (claim: Claim) => string | undefined,
): string {
  const bom = markdown.startsWith("\uFEFF") ? "\uFEFF" : "";
  const parts = markdown.slice(bom.length).split(/(\r\n|\r|\n)/);
  // Even indexes are lines, odd indexes are the line ends between them.
  const lines = parts.filter((_, i) => i % 2 === 0);
  walkRows(lines, (claim, index) => {
    // The cell match runs first, so `next` sees only a row that can be rewritten.
    const cell = VALUE_CELL.exec(lines[index] as string);
    if (!cell) return;
    const value = next(claim);
    if (value !== undefined) lines[index] = `${cell[1]}${value}${cell[3]}`;
  });
  return bom + parts.map((part, i) => (i % 2 === 0 ? lines[i / 2] : part)).join("");
}

/** The claims of `markdown`, in document order. */
export function parseClaims(markdown: string): Claim[] {
  return scanVerification(markdown).claims;
}

/** True when `markdown` has a Verification heading, even when the section holds no row. */
export function hasVerificationSection(markdown: string): boolean {
  return scanVerification(markdown).found;
}
