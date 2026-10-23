/**
 * The `clones` section of the config file and the merge of the flags, the config file and the
 * defaults (design sections 5 and 17.5): every key with its kind, the rejection of a value of the
 * wrong kind, and the precedence.
 */
import { describe, expect, test } from "bun:test";
import { CLONES_DEFAULTS, mergeClonesConfig } from "../../src/clones/settings.ts";
import { parseConfigSections } from "../../src/config.ts";

const LABEL = "<root>/x.json";

describe("clones section: accepted values", () => {
  test("every key loads", () => {
    const clones = {
      src: ["lib", "app"],
      out: "reports/clones",
      minNodes: 30,
      shingleLength: 4,
      nearThreshold: 0.7,
      containmentThreshold: 0.95,
      containmentMinShingles: 10,
      rareShingleLimit: 40,
      minSharedShingles: 2,
    };
    expect(parseConfigSections({ clones }, LABEL).clones).toEqual(clones);
  });

  test("src accepts the word auto, and out accepts null", () => {
    expect(parseConfigSections({ clones: { src: "auto", out: null } }, LABEL).clones).toEqual({
      src: "auto",
      out: null,
    });
  });

  test("a file without the section gives empty clones settings", () => {
    expect(parseConfigSections({ map: { out: "x" } }, LABEL).clones).toEqual({});
  });

  test("the fraction bounds 0 and 1 are accepted", () => {
    const parsed = parseConfigSections(
      { clones: { nearThreshold: 0, containmentThreshold: 1 } },
      LABEL,
    );
    expect(parsed.clones).toEqual({ nearThreshold: 0, containmentThreshold: 1 });
  });
});

describe("clones section: rejected values", () => {
  const invalid: Array<[string, unknown, RegExp]> = [
    ["an unknown key", { clones: { minnodes: 5 } }, /unknown key 'clones.minnodes'/],
    ["a section that is not an object", { clones: [] }, /'clones' must be an object/],
    ["an absolute src path", { clones: { src: ["/abs"] } }, /'clones.src' holds an absolute path/],
    ["an absolute out path", { clones: { out: "C:\\x" } }, /'clones.out' holds an absolute path/],
    ["an empty out", { clones: { out: "" } }, /'clones.out' must be/],
    [
      "a count of 0",
      { clones: { minNodes: 0 } },
      /'clones.minNodes' must be a whole number of 1 or more/,
    ],
    [
      "a negative count",
      { clones: { shingleLength: -2 } },
      /'clones.shingleLength' must be a whole number/,
    ],
    [
      "a fractional count",
      { clones: { rareShingleLimit: 2.5 } },
      /'clones.rareShingleLimit' must be a whole number/,
    ],
    [
      "a count as text",
      { clones: { minSharedShingles: "3" } },
      /'clones.minSharedShingles' must be a whole number/,
    ],
    [
      "a fraction above 1",
      { clones: { nearThreshold: 1.5 } },
      /'clones.nearThreshold' must be a number from 0 to 1/,
    ],
    [
      "a negative fraction",
      { clones: { containmentThreshold: -0.1 } },
      /'clones.containmentThreshold' must be a number from 0 to 1/,
    ],
    [
      "a fraction as text",
      { clones: { nearThreshold: "0.6" } },
      /'clones.nearThreshold' must be a number from 0 to 1/,
    ],
  ];
  for (const [label, value, message] of invalid) {
    test(`${label} is an error`, () => {
      expect(() => parseConfigSections(value, LABEL)).toThrow(message);
    });
  }
});

describe("clones settings: precedence", () => {
  test("the defaults are the documented values", () => {
    expect(CLONES_DEFAULTS).toEqual({
      src: "auto",
      out: null,
      minNodes: 50,
      shingleLength: 6,
      nearThreshold: 0.6,
      containmentThreshold: 0.9,
      containmentMinShingles: 20,
      rareShingleLimit: 60,
      minSharedShingles: 3,
    });
    expect(mergeClonesConfig({}, {})).toEqual(CLONES_DEFAULTS);
  });

  test("a flag wins over the config file, and the config file wins over the default", () => {
    const merged = mergeClonesConfig(
      { minNodes: 10, out: "cli-out" },
      { minNodes: 99, shingleLength: 4, out: "file-out", src: ["lib"] },
    );
    expect(merged.minNodes).toBe(10);
    expect(merged.out).toBe("cli-out");
    expect(merged.shingleLength).toBe(4);
    expect(merged.src).toEqual(["lib"]);
    expect(merged.nearThreshold).toBe(CLONES_DEFAULTS.nearThreshold);
  });

  test("an out of null in the config file stays null, and a flag still overrides it", () => {
    expect(mergeClonesConfig({}, { out: null }).out).toBeNull();
    expect(mergeClonesConfig({ out: "x" }, { out: null }).out).toBe("x");
  });

  test("the merge does not change the defaults", () => {
    const before = JSON.stringify(CLONES_DEFAULTS);
    const merged = mergeClonesConfig({}, {});
    if (Array.isArray(merged.src)) merged.src.push("x");
    expect(JSON.stringify(CLONES_DEFAULTS)).toBe(before);
  });
});
