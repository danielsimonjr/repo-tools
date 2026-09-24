/** Unit tests for the `compress` fixes and the round trip (T5 steps 2 and 3). */
import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CompressDeps, run } from "../../src/compress/index.ts";

const fixtures = join(import.meta.dir, "../fixtures/compress");
const work = mkdtempSync(join(tmpdir(), "repo-tools-compress-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

let serial = 0;
/** Returns a new empty folder, with copies of the named fixtures. */
function folder(...names: string[]): string {
  const dir = join(work, `case-${serial++}`);
  mkdirSync(dir, { recursive: true });
  for (const n of names) copyFileSync(join(fixtures, n), join(dir, n));
  return dir;
}

/** Runs the subcommand with captured output. */
async function compress(args: string[], deps?: CompressDeps) {
  let out = "";
  let err = "";
  const io = {
    stdout: (s: string) => {
      out += s;
    },
    stderr: (s: string) => {
      err += s;
    },
  };
  const code = deps ? await run(args, io, deps) : await run(args, io);
  return { code, out, err };
}

describe("K5: --level and --format are validated", () => {
  test("an unknown level exits 1 with a message and writes no file", async () => {
    const dir = folder("sample.json");
    const r = await compress([join(dir, "sample.json"), "--level", "fast"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("fast");
    expect(r.err).toContain("light, medium, aggressive");
    expect(readdirSync(dir)).toEqual(["sample.json"]);
  });

  test("an unknown format exits 1 with a message and writes no file", async () => {
    const dir = folder("sample.json");
    const r = await compress([join(dir, "sample.json"), "-f", "toml"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("toml");
    expect(r.err).toContain("json, yaml, markdown");
    expect(readdirSync(dir)).toEqual(["sample.json"]);
  });

  test("batch mode validates too", async () => {
    const dir = folder("sample.json");
    const r = await compress(["-b", "-p", "*.json", dir, "-l", "max"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("max");
    expect(readdirSync(dir)).toEqual(["sample.json"]);
  });

  test("every valid level and format is accepted", async () => {
    for (const level of ["light", "medium", "aggressive"]) {
      const dir = folder("sample.md");
      expect((await compress([join(dir, "sample.md"), "-l", level, "--no-stats"])).code).toBe(0);
    }
    const dir = folder("sample.txt");
    expect((await compress([join(dir, "sample.txt"), "-f", "log", "--no-stats"])).code).toBe(0);
  });
});
