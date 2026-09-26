/**
 * The Python string behaviour of the STE port (`src/ste/py.ts`). Each expected value is the
 * output of CPython 3.13 on the same input. Special characters are built from code points, so the
 * test source holds no raw control or separator character.
 */
import { describe, expect, test } from "bun:test";
import { pyRepr, pySplit, pySplitlines, pyStrip } from "../../src/py.ts";

const ch = (...codes: number[]): string => String.fromCharCode(...codes);
const [LF, CR, VT, FS, NEL, LS] = [ch(10), ch(13), ch(11), ch(0x1c), ch(0x85), ch(0x2028)];

describe("pySplitlines", () => {
  const cases: [string, string[]][] = [
    ["", []],
    ["a", ["a"]],
    [`a${LF}`, ["a"]],
    [`a${CR}${LF}b`, ["a", "b"]],
    [`a${CR}b${LF}`, ["a", "b"]],
    [`a${LF}${LF}b`, ["a", "", "b"]],
    [`a${VT}b${FS}c`, ["a", "b", "c"]],
    [LF, [""]],
    [`a${LS}b`, ["a", "b"]],
    [`a${CR}${LF}`, ["a"]],
    [`x${CR}${CR}${LF}y`, ["x", "", "y"]],
  ];
  for (const [input, want] of cases) {
    test(`splits ${JSON.stringify(input)} as Python does`, () => {
      expect(pySplitlines(input)).toEqual(want);
    });
  }
});

describe("pyRepr", () => {
  test("quotes and escapes as Python does", () => {
    expect(pyRepr("it")).toBe("'it'");
    expect(pyRepr("it's")).toBe(`"it's"`);
    expect(pyRepr('a"b')).toBe(`'a"b'`);
    expect(pyRepr(`tab${ch(9)}here`)).toBe("'tab\\there'");
    expect(pyRepr(FS)).toBe("'\\x1c'");
    expect(pyRepr(ch(0x200b))).toBe("'\\u200b'");
  });
});

describe("pySplit and pyStrip", () => {
  test("treat U+001C and U+0085 as white space, as Python does", () => {
    expect(pySplit(` a${FS}b  c${NEL}d `)).toEqual(["a", "b", "c", "d"]);
    expect(pyStrip(` ${FS}x${NEL} `)).toBe("x");
  });
});
