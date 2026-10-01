/**
 * The claims parser of `repo-tools check` (design section 15): which table rows of a document
 * are claims. The cases port `test_check.py` of the Python tool, then add the edges of the
 * TypeScript port.
 */
import { describe, expect, test } from "bun:test";
import { hasVerificationSection, parseClaims } from "../../src/check/claims.ts";

const TABLE = "| Claim | Value | Source |\n|---|---|---|\n";

describe("parseClaims", () => {
  test("reads the Verification table", () => {
    const md = `## Verification\n${TABLE}| totalFiles | 1 | file-inventory.json |\n`;
    expect(parseClaims(md)).toEqual([
      { claim: "totalFiles", value: "1", source: "file-inventory.json" },
    ]);
  });

  test("skips the header row in any case and the separator rows", () => {
    const md =
      "## Verification\n| CLAIM | Value | Source |\n| --- | --- | --- |\n| :-: | :-: | :-: |\n" +
      "| a | 1 | s |\n";
    expect(parseClaims(md).map((c) => c.claim)).toEqual(["a"]);
  });

  test("a heading that only mentions the word does not open a section", () => {
    const doc =
      "# Graph\n\n### `core/src/wasm-loader.ts` - SHA-384 integrity verification\n\n" +
      "| File | Imports | Type |\n|---|---|---|\n| `./a.js` | `B` | Import |\n";
    expect(hasVerificationSection(doc)).toBe(false);
    expect(parseClaims(doc)).toEqual([]);
  });

  test("a real Verification heading still opens the section", () => {
    const doc = `# Doc\n\n## Verification\n\n${TABLE}| totalFiles | 7 | dependency-graph.json |\n`;
    expect(hasVerificationSection(doc)).toBe(true);
    expect(parseClaims(doc)).toEqual([
      { claim: "totalFiles", value: "7", source: "dependency-graph.json" },
    ]);
  });

  test.each([
    "## Verification",
    "## Verification:",
    "## verification",
    "## VERIFICATION :",
    "## Verification (repo-tools)",
    "##Verification",
    "# Verification",
    "###### Verification",
  ])("the heading %p opens a section", (heading) => {
    const md = `${heading}\n${TABLE}| a | 1 | s |\n`;
    expect(hasVerificationSection(md)).toBe(true);
    expect(parseClaims(md)).toHaveLength(1);
  });

  test.each([
    "## Verification of the manifest",
    "## Pre-verification",
    "## Verification: counts",
    "## The Verification",
    "## Verification (a) (b)",
  ])("the heading %p does not open a section", (heading) => {
    expect(hasVerificationSection(`${heading}\n${TABLE}| a | 1 | s |\n`)).toBe(false);
  });

  test("an indented heading is not a heading", () => {
    expect(hasVerificationSection(`  ## Verification\n${TABLE}| a | 1 | s |\n`)).toBe(false);
  });

  test("the section ends at the next heading of the same or a shallower level", () => {
    const md =
      `## Verification\n${TABLE}| a | 1 | s |\n\n### Detail\n| b | 2 | s |\n\n` +
      "## Other\n| c | 3 | s |\n";
    // A deeper heading stays inside the section. A heading of the same level ends it.
    expect(parseClaims(md).map((c) => c.claim)).toEqual(["a", "b"]);
  });

  test("a shallower heading ends the section", () => {
    const md = `## A\n### Verification\n| a | 1 | s |\n## B\n| b | 2 | s |\n`;
    expect(parseClaims(md).map((c) => c.claim)).toEqual(["a"]);
  });

  test("a second Verification section adds its rows", () => {
    const md = `## Verification\n| a | 1 | s |\n## Verification\n| b | 2 | s |\n`;
    expect(parseClaims(md).map((c) => c.claim)).toEqual(["a", "b"]);
  });

  test("a table outside a Verification section is not a claim", () => {
    const md = `| a | 1 | s |\n## Notes\n| b | 2 | s |\n`;
    expect(parseClaims(md)).toEqual([]);
    expect(hasVerificationSection(md)).toBe(false);
  });

  test("a section with no table has no claim and is still a section", () => {
    const md = "## Verification\n\nNothing verifiable here yet.\n";
    expect(hasVerificationSection(md)).toBe(true);
    expect(parseClaims(md)).toEqual([]);
  });

  test("a row needs exactly three cells", () => {
    const md = "## Verification\n| a | 1 |\n| b | 2 | s | extra |\n| c | 3 | s |\n";
    expect(parseClaims(md).map((c) => c.claim)).toEqual(["c"]);
  });

  test("CRLF line endings give the same claims", () => {
    const md = `## Verification\r\n${TABLE.replace(/\n/g, "\r\n")}| a | 1 | s |\r\n`;
    expect(parseClaims(md)).toEqual([{ claim: "a", value: "1", source: "s" }]);
  });

  test("a byte-order mark before the first heading does not hide it", () => {
    const md = `﻿## Verification\n${TABLE}| a | 1 | s |\n`;
    expect(hasVerificationSection(md)).toBe(true);
  });

  test("a row keeps the order of the document", () => {
    const md = `## Verification\n| z | 1 | s |\n| a | 2 | s |\n`;
    expect(parseClaims(md).map((c) => c.claim)).toEqual(["z", "a"]);
  });
});
