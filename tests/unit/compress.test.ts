/** Unit tests for the `compress` fixes and the round trip (T5 steps 2 and 3). */
import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { type CompressDeps, run } from "../../src/compress/index.ts";
import { compareCodeUnits } from "../../src/sort.ts";

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

/** Runs the subcommand with `cwd` as the working folder, so the output holds relative paths. */
async function compressIn(cwd: string, args: string[], deps?: CompressDeps) {
  const before = process.cwd();
  process.chdir(cwd);
  try {
    return await compress(args, deps);
  } finally {
    process.chdir(before);
  }
}

/** Returns every file below `dir` with its content, in code-unit order of the relative path. */
function snapshot(dir: string): [string, string][] {
  const found = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e): [string, string] => [
      relative(dir, join(e.parentPath, e.name)).replaceAll("\\", "/"),
      readFileSync(join(e.parentPath, e.name), "utf8"),
    ]);
  return found.sort((a, b) => compareCodeUnits(a[0], b[0]));
}

/** A folder tree whose code-unit order differs from a locale order ("B" before "a"). */
function tree(): string {
  const dir = folder();
  mkdirSync(join(dir, "src", "nested"), { recursive: true });
  for (const rel of ["a.json", "B.json", "src/c.json", "src/nested/D.json", "src/nested/b.json"]) {
    copyFileSync(join(fixtures, "sample.json"), join(dir, rel));
  }
  return dir;
}

describe("K6: the batch walk is sorted in code-unit order", () => {
  const forward: CompressDeps = {
    readdir: (d) => readdirSync(d, { withFileTypes: true }),
  };
  const reversed: CompressDeps = {
    readdir: (d) => readdirSync(d, { withFileTypes: true }).reverse(),
  };

  test("a reversed readdir gives the same stdout and the same files", async () => {
    const one = tree();
    const two = tree();
    const args = ["-b", "-r", "-p", "*.json", "."];
    const a = await compressIn(one, args, forward);
    const b = await compressIn(two, args, reversed);
    expect(a.code).toBe(0);
    expect(b).toEqual(a);
    expect(snapshot(two)).toEqual(snapshot(one));
  });

  test("each folder is walked in code-unit order of its entry names", async () => {
    const r = await compressIn(tree(), ["-b", "-r", "-p", "*.json", "."], reversed);
    const order = [...r.out.matchAll(/^✓ (\S+) →/gm)].map((m) =>
      (m[1] ?? "").replaceAll("\\", "/"),
    );
    expect(order).toEqual([
      "B.json",
      "a.json",
      "src/c.json",
      "src/nested/D.json",
      "src/nested/b.json",
    ]);
  });
});

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
