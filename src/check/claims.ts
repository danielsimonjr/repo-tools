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

/** Reads the claims of `markdown` and whether it has a Verification section at all. */
export function scanVerification(markdown: string): Scan {
  const claims: Claim[] = [];
  let found = false;
  let inSection = false;
  let sectionLevel = 0;
  for (const raw of markdown.replace(/^﻿/, "").split(/\r\n|\r|\n/)) {
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
      continue;
    }
    if (!inSection) continue;
    const row = ROW.exec(line.trim());
    if (!row) continue;
    const [claim, value, source] = [row[1], row[2], row[3]].map((cell) => (cell as string).trim());
    if (HEADER_CLAIMS.has((claim as string).toLowerCase())) continue;
    if (/^[-: ]*$/.test(claim as string)) continue;
    claims.push({ claim: claim as string, value: value as string, source: source as string });
  }
  return { claims, found };
}

/** The claims of `markdown`, in document order. */
export function parseClaims(markdown: string): Claim[] {
  return scanVerification(markdown).claims;
}

/** True when `markdown` has a Verification heading, even when the section holds no row. */
export function hasVerificationSection(markdown: string): boolean {
  return scanVerification(markdown).found;
}
