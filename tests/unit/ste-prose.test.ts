/**
 * The docstring harness of the STE checker (`checkProse`, `proseOf`).
 *
 * Ported from the code-docs skill (`scripts/tests/test_code_docs.py`, the STE section). The
 * test of the stub prompt stays in that skill: it needs the code-docs stub writer.
 */
import { describe, expect, test } from "bun:test";
import { checkProse, proseOf } from "../../src/ste/prose.ts";

/** True when `text` gives a finding of `rule`. */
const flags = (text: string, rule: string): boolean => checkProse(text).some(([r]) => r === rule);

describe("checkProse", () => {
  test("flags a long sentence", () => {
    const longOne = `This function ${Array(25).fill("word").join(" ")}.`;
    expect(flags(longOne, "STE-LEN")).toBe(true);
  });

  test("flags passive voice with a backticked agent", () => {
    // A bare lower-case agent ("by parse") is not flagged: it looks like an adverbial.
    expect(flags("The tree is returned by `parse`.", "STE-VOICE")).toBe(true);
  });

  test("flags an ambiguous reference, but not a named one", () => {
    expect(flags("This disables the cache.", "STE-REF")).toBe(true);
    expect(flags("This flag disables the cache.", "STE-REF")).toBe(false);
  });

  test("flags a wordy form", () => {
    const found = checkProse("Call it in order to reset the state.");
    expect(found.some(([, d]) => d.includes("in order to"))).toBe(true);
  });

  test("clean prose gives no finding", () => {
    expect(
      checkProse("Return the sorted keys. Raise ValueError when tolerance is negative."),
    ).toEqual([]);
  });

  test("a plural noun after a demonstrative is not an ambiguous reference", () => {
    expect(flags("These files are indexed.", "STE-REF")).toBe(false);
    expect(flags("This flag disables the cache.", "STE-REF")).toBe(false);
  });

  test("a word inside an identifier is not flagged", () => {
    expect(checkProse("Call utiliseCache() to warm the cache.")).toEqual([]);
    expect(checkProse("Discovery Adjudication Ledger records each decision.")).toEqual([]);
    expect(checkProse("Call `adjudicateBridgeEntry` to record the verdict.")).toEqual([]);
    expect(flags("Call it in order to reset.", "STE-WORD")).toBe(true);
  });

  test("passive voice needs an explicit agent", () => {
    expect(flags("The file is closed.", "STE-VOICE")).toBe(false);
    expect(flags("The cache is stale.", "STE-VOICE")).toBe(false);
    expect(flags("The tree is returned by the parser.", "STE-VOICE")).toBe(true);
  });

  test("an agent is separated from an adverbial (the 14-case probe)", () => {
    for (const text of [
      "The tree is returned by the parser.",
      "The file is closed by the handler.",
      "The report is written by the generator.",
      "The tests are run by CI.",
      "The cache is cleared by `reset`.",
    ]) {
      expect({ text, flag: flags(text, "STE-VOICE") }).toEqual({ text, flag: true });
    }
    for (const text of [
      "The count is checked by hand.",
      "Results are sorted by name.",
      "Files are grouped by area.",
      "Entries are ordered by priority.",
      "Symbols are keyed by name.",
      "The file is closed.",
      "The cache is stale.",
    ]) {
      expect({ text, flag: flags(text, "STE-VOICE") }).toEqual({ text, flag: false });
    }
  });

  test("the case flags are scoped, not global", () => {
    // A global case-insensitive flag makes [A-Z] match lower case and defeats the guard.
    expect(flags("The bundle is built by Esbuild.", "STE-VOICE")).toBe(true);
    expect(flags("The bundle is built by esbuild.", "STE-VOICE")).toBe(false);
  });

  test("the rules are the union of both skills", () => {
    expect(flags("The behaviour is meant by the spec.", "STE-VOICE")).toBe(true);
    expect(flags("The walk is led by the resolver.", "STE-VOICE")).toBe(true);
    expect(flags("The cache is cleared by these handlers.", "STE-VOICE")).toBe(true);
    expect(flags("The tree is walked by his resolver.", "STE-VOICE")).toBe(true);
    expect(flags("Call it for the purpose of resetting.", "STE-WORD")).toBe(true);
    expect(flags("The parser has the ability to recover.", "STE-WORD")).toBe(true);
    expect(flags("The value is thrown by the guard.", "STE-VOICE")).toBe(true);
    expect(flags("The tree is shown by the viewer.", "STE-VOICE")).toBe(true);
  });

  test("an ambiguous reference after a conjunction, mid-sentence, is caught", () => {
    expect(flags("Set the flag, and this causes a reload.", "STE-REF")).toBe(true);
    expect(flags("This disables the cache.", "STE-REF")).toBe(true);
    expect(flags("These files are indexed.", "STE-REF")).toBe(false);
    expect(flags("Return the value that this handler produced.", "STE-REF")).toBe(false);
  });

  test("the finding texts keep the source wording", () => {
    expect(checkProse("This disables the cache.")).toEqual([
      ["STE-REF", "ambiguous 'This' -- name the thing it refers to"],
    ]);
    expect(checkProse("The tree is returned by the parser.")).toEqual([
      ["STE-VOICE", "possible passive voice 'is returned by the' -- prefer active"],
    ]);
    const long = `A ${Array(30).fill("word").join(" ")}.`;
    expect(checkProse(long)).toEqual([
      ["STE-LEN", `sentence has 31 words (limit 20): '${long.slice(0, 59)}…'`],
    ]);
  });
});

describe("proseOf", () => {
  test("drops tag lines and code fences", () => {
    const doc = "Return the tree.\n\n@param x - A thing.\n\n```\nis returned by foo\n```\n";
    const prose = proseOf(doc);
    expect(prose).not.toContain("@param");
    expect(prose).not.toContain("is returned by");
    expect(prose).toContain("Return the tree.");
  });

  test("drops section headers, doctest lines and rules, and joins the rest", () => {
    const doc = " * Sort the keys.\n *\n * Args:\n *   keys: The keys.\n * >>> sort(k)\n * ---\n";
    expect(proseOf(doc)).toBe("Sort the keys. keys: The keys.");
  });
});
