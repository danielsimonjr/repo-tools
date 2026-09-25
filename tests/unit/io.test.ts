import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { toJson, withOneLf, writeLf } from "../../src/io.ts";
import { makeTempDir } from "./temp.ts";

const work = makeTempDir("io");
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("deterministic writes", () => {
  test("writeLf converts CRLF and CR to LF and creates the parent folder", () => {
    const file = join(work, "a", "b", "out.txt");
    writeLf(file, "one\r\ntwo\rthree\n");
    expect(readFileSync(file, "utf8")).toBe("one\ntwo\nthree\n");
  });

  test("writeLf keeps the text otherwise unchanged (no added trailing newline)", () => {
    const file = join(work, "exact.txt");
    writeLf(file, "no newline at end");
    expect(readFileSync(file, "utf8")).toBe("no newline at end");
  });

  test("withOneLf ends the text with exactly one LF (rule R1)", () => {
    expect(withOneLf("{}")).toBe("{}\n");
    expect(withOneLf("a\n\n\n")).toBe("a\n");
    expect(withOneLf("a\r\nb\r\n")).toBe("a\nb\n");
  });

  test("toJson uses 2-space indentation and ends with one LF", () => {
    expect(toJson({ b: 1, a: [2] })).toBe('{\n  "b": 1,\n  "a": [\n    2\n  ]\n}\n');
  });
});
