/**
 * The npm package supports Node 20 (`engines`), and `npx @danielsimonjr/repo-tools` runs the
 * bundle under the Node of the user. A regex modifier group (`(?i:...)`) compiles on Bun and on
 * Node 24, but Node 20 and Node 22 refuse it. A regex that compiles when its module loads then
 * stops every subcommand of the bundle, not only its own. This static test keeps the syntax out
 * of `src/`. Comments are removed first, so a comment can name the syntax.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "../../src/mask.ts";
import { ci } from "../../src/ste/py.ts";

const SRC = join(import.meta.dir, "../../src");

/** A regex modifier group, as a regex literal or as regex source text in a string. */
const MODIFIER_GROUP = /\(\?[imsx]*-?[imsx]+:/g;

/** Every `.ts` file below `dir`. */
function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return tsFiles(full);
    return e.name.endsWith(".ts") ? [full] : [];
  });
}

/** The modifier groups in the code of `source`, without its comments. */
function modifierGroups(source: string): string[] {
  return [...stripComments(source).matchAll(MODIFIER_GROUP)].map((m) => m[0]);
}

describe("node-compat: no regex modifier group in src/", () => {
  test("no source file uses a regex modifier group", () => {
    const found = tsFiles(SRC).flatMap((f) =>
      modifierGroups(readFileSync(f, "utf8")).map((g) => `${f.slice(SRC.length + 1)}: ${g}`),
    );
    expect(found).toEqual([]);
  });

  test("the scan finds each form (positive controls)", () => {
    for (const plant of [
      "const r = /(?i:is|are)/;",
      'const s = "(?i:the)";',
      "const t = /(?-i:A)/;",
      "const u = `(?im:x)`;",
    ]) {
      expect({ plant, found: modifierGroups(plant).length > 0 }).toEqual({ plant, found: true });
    }
    expect(modifierGroups("// a comment that names (?i:is)\nconst ok = /(?:is)/;\n")).toEqual([]);
  });
});

describe("ci: the Python case-insensitive letters", () => {
  const dotless = String.fromCharCode(0x131);
  const dotted = String.fromCharCode(0x130);
  const longS = String.fromCharCode(0x17f);
  const kelvin = String.fromCharCode(0x212a);

  test("each ASCII letter becomes a class of its cases", () => {
    expect(ci("by")).toBe("[bB][yY]");
    expect(ci("is|en")).toBe(`[iI${dotless}${dotted}][sS${longS}]|[eE][nN]`);
  });

  test("the extra letters match as CPython's re.IGNORECASE matches them", () => {
    // CPython 3.13: (?i:i) matches U+0131 and U+0130, (?i:s) U+017F, (?i:k) U+212A.
    const re = (p: string) => new RegExp(`^${ci(p)}$`, "u");
    expect(re("is").test(`${dotless}S`)).toBe(true);
    expect(re("is").test(`${dotted}${longS}`)).toBe(true);
    expect(re("k").test(kelvin)).toBe(true);
    expect(re("is").test("iz")).toBe(false);
  });
});
