/**
 * The language registry of `repo-tools docs`: one entry per language, and nothing outside the
 * registry names a language or a style.
 */
import { describe, expect, test } from "bun:test";
import { DOCS_HELP } from "../../src/docs/index.ts";
import { LANGUAGES, specForPath, specOf } from "../../src/docs/languages.ts";
import { STYLES } from "../../src/docs/styles.ts";

// The languages whose analyser is not written yet: their styles exist, their spec does not.
// Each analyser commit removes its id; the set is empty when PR 4 ends.
const PENDING = new Set(["cpp", "php", "ruby"]);

describe("the registry", () => {
  test("each language owns its suffixes alone", () => {
    const seen = new Map<string, string>();
    for (const spec of LANGUAGES) {
      for (const suffix of spec.suffixes) {
        expect(seen.get(suffix)).toBeUndefined();
        seen.set(suffix, spec.id);
      }
    }
  });

  test("each default style is a style of the language, and each style exists", () => {
    for (const spec of LANGUAGES) {
      expect(spec.styles).toContain(spec.defaultStyle);
      for (const id of spec.styles) expect(STYLES[id]?.language).toBe(spec.id);
    }
  });

  test("every style belongs to one language of the registry", () => {
    for (const style of Object.values(STYLES)) {
      if (PENDING.has(style.language)) continue;
      expect(specOf(style.language)?.styles).toContain(style.id);
    }
  });

  test("the defaults are the 2.5.0 stub forms", () => {
    expect(specOf("python")?.defaultStyle).toBe("google");
    expect(specOf("typescript")?.defaultStyle).toBe("tsdoc");
  });

  test("a path maps to the language of its suffix", () => {
    expect(specForPath("pkg/a.py")?.id).toBe("python");
    expect(specForPath("src/a.mjs")?.id).toBe("typescript");
    expect(specForPath("src/a.tsx")?.id).toBe("typescript");
    expect(specForPath("src/a.swift")).toBeUndefined();
  });

  test("the help text names every language and every style", () => {
    for (const name of LANGUAGES.flatMap((s) => s.names)) expect(DOCS_HELP).toContain(name);
    for (const style of Object.values(STYLES)) {
      if (!PENDING.has(style.language)) expect(DOCS_HELP).toContain(style.id);
    }
  });
});
