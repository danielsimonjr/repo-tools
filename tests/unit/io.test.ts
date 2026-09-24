import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toJson, writeLf } from "../../src/io.ts";

const work = mkdtempSync(join(tmpdir(), "repo-tools-io-"));
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

  test("toJson uses 2-space indentation and ends with one LF", () => {
    expect(toJson({ b: 1, a: [2] })).toBe('{\n  "b": 1,\n  "a": [\n    2\n  ]\n}\n');
  });
});
