/**
 * Fix F5: a probe checks that the loaded js-yaml obeys the quote option before the YAML report
 * is built. A js-yaml that ignores the option changes the quote character of every quoted
 * scalar, so the probe fails loudly and no report is written with the wrong quotes.
 */
import { describe, expect, test } from "bun:test";
import { dump } from "js-yaml";
import { generateYaml, probeQuoteStyle } from "../../src/depgraph/reporters/yaml.ts";

/** A fake js-yaml `dump` that ignores the quote option: it always uses single quotes. */
const ignoresQuoteOption = ((value: unknown) =>
  dump(value, { quoteStyle: "single" })) as typeof dump;

/** A fake js-yaml `dump` that ignores the quote option: it always uses double quotes. */
const alwaysDouble = ((value: unknown) => dump(value, { quoteStyle: "double" })) as typeof dump;

describe("F5: the YAML quote-style probe", () => {
  test("the loaded js-yaml passes the probe", () => {
    expect(() => probeQuoteStyle(dump)).not.toThrow();
  });

  test("a js-yaml that ignores the quote option fails loudly", () => {
    expect(() => probeQuoteStyle(ignoresQuoteOption)).toThrow(/quote/);
    expect(() => probeQuoteStyle(alwaysDouble)).toThrow(/quote/);
  });

  test("generateYaml runs the probe before it builds the report", () => {
    expect(() => generateYaml({ a: "b: c" }, ignoresQuoteOption)).toThrow(/quote/);
    expect(generateYaml({ a: "b: c" })).toBe("a: 'b: c'\n");
  });
});
