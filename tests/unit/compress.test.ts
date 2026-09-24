/** Unit tests for the `compress` fixes and the round trip (T5 steps 2 and 3). */
import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";
import { detectFormat, getCompressor, LEVELS } from "../../src/compress/formats.ts";
import { type CompressDeps, run } from "../../src/compress/index.ts";
import { decompress } from "../../src/compress/legend.ts";
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

describe("batch mode does not compress its own output", () => {
  test("a second batch run skips the .compact files", async () => {
    const dir = folder("sample.json", "sample.md");
    const args = ["-b", "-p", "*", ".", "--no-stats"];
    expect((await compressIn(dir, args)).code).toBe(0);
    const second = await compressIn(dir, args);
    expect(second.code).toBe(0);
    expect(second.out).toContain('Skipped 2 file(s) with ".compact" in the name.');
    expect(readdirSync(dir).sort(compareCodeUnits)).toEqual([
      "sample.compact.json",
      "sample.compact.md",
      "sample.json",
      "sample.md",
    ]);
  });

  test("an explicit .compact file in batch mode is skipped, and no file is left exits 1", async () => {
    const dir = folder("sample.json");
    await compressIn(dir, ["sample.json", "--no-stats"]);
    const r = await compressIn(dir, ["-b", "sample.compact.json"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("No files to process");
    expect(readdirSync(dir)).not.toContain("sample.compact.compact.json");
  });

  test("batch decompress still selects the .compact files", async () => {
    const dir = folder("sample.json");
    await compressIn(dir, ["sample.json", "--no-stats"]);
    const r = await compressIn(dir, ["-d", "-b", "-p", "*.compact.json", ".", "--no-stats"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("sample.compact.json → sample.json");
  });
});

describe("directories and --batch", () => {
  test("a directory without --batch exits 1 with a message", async () => {
    const dir = folder("sample.json");
    for (const args of [[dir], ["-d", dir]]) {
      const r = await compress(args);
      expect(r.code).toBe(1);
      expect(r.err).toContain("is a directory");
      expect(r.err).toContain("--batch");
    }
  });

  test("--batch with a directory and no --pattern exits 1 with a message", async () => {
    const dir = folder("sample.json");
    const r = await compress(["-b", dir]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("is a directory");
    expect(r.err).toContain("--pattern");
    expect(readdirSync(dir)).toEqual(["sample.json"]);
  });

  test("--batch --pattern with a file in place of a directory exits 1 with a message", async () => {
    const dir = folder("sample.json");
    const r = await compress(["-b", "-p", "*.json", join(dir, "sample.json")]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("is not a directory");
  });

  test("--batch --pattern with a missing directory exits 1", async () => {
    const r = await compress(["-b", "-p", "*.json", join(work, "no-such-folder")]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Directory not found");
  });

  test("--batch --pattern without a directory searches the working folder", async () => {
    const dir = folder("sample.json");
    const r = await compressIn(dir, ["-b", "-p", "*.json", "--no-stats"]);
    expect(r.code).toBe(0);
    expect(readdirSync(dir).sort(compareCodeUnits)).toEqual(["sample.compact.json", "sample.json"]);
  });

  test("--batch without a pattern and without files exits 1 with a message", async () => {
    const r = await compressIn(folder(), ["-b"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("No files to process");
  });
});

describe("round trip (design 13.3 step 5)", () => {
  for (const level of ["light", "medium", "aggressive"]) {
    test(`JSON at ${level}: compress then -d gives a deep-equal value`, async () => {
      const dir = folder("sample.json");
      const original = JSON.parse(readFileSync(join(dir, "sample.json"), "utf8"));
      expect((await compressIn(dir, ["sample.json", "-l", level, "--no-stats"])).code).toBe(0);
      const args = ["-d", "sample.compact.json", "-o", "restored.json", "--no-stats"];
      expect((await compressIn(dir, args)).code).toBe(0);
      expect(JSON.parse(readFileSync(join(dir, "restored.json"), "utf8"))).toEqual(original);
    });
  }

  // K9: -d restores JSON only. The other formats are tested in "K9: -d supports JSON only".

  test("JSON: a value that equals an abbreviation is not changed", () => {
    const input = JSON.stringify({ name: "n", items: [{ name: "i", count: "name" }] });
    const compact = getCompressor("json")(input, "medium").compressed;
    expect(JSON.parse(decompress(compact, "json"))).toEqual(JSON.parse(input));
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

/** Compresses `value` as JSON at `level` and restores it. Returns the compact text and the value. */
function jsonRoundTrip(value: unknown, level: (typeof LEVELS)[number]) {
  const compact = getCompressor("json")(JSON.stringify(value), level).compressed;
  return { compact, restored: JSON.parse(decompress(compact, "json")) as unknown };
}

describe("JSON: an abbreviation does not collide with a key in the data", () => {
  for (const level of LEVELS) {
    test(`{"name":"a","n":"b"} at ${level} keeps both values in the compact file`, () => {
      const input = { name: "a", n: "b" };
      const { compact, restored } = jsonRoundTrip(input, level);
      const body = JSON.parse(compact) as Record<string, unknown>;
      const values = Object.entries(body)
        .filter(([k]) => k !== "_legend")
        .map(([, v]) => String(v));
      expect(values.sort(compareCodeUnits)).toEqual(["a", "b"]);
      expect(restored).toEqual(input);
    });

    test(`nested short keys and a "_legend" key in the data at ${level}`, () => {
      const input = {
        _legend: "mine",
        items: [{ i: 1, items: 2 }],
        deep: { d: { dog_apple_tree_ant: 3 }, dat: 4 },
      };
      expect(jsonRoundTrip(input, level).restored).toEqual(input);
    });
  }
});

describe("JSON: the shape of the top-level value does not change", () => {
  const values: [string, unknown][] = [
    ["an array", [{ itemName: "a" }, { itemName: "b" }]],
    ["a nested array", [[1, 2], [{ quantity: 3 }], []]],
    ["an empty array", []],
    ["a string", "text"],
    ["a number", 42],
    ["null", null],
    ["true", true],
    ['an object with the one key "data"', { data: [1, 2] }],
    ['an object with the keys "_legend" and "data"', { _legend: 1, data: 2 }],
  ];
  for (const [name, value] of values) {
    for (const level of LEVELS) {
      test(`${name} at ${level}`, () => {
        expect(jsonRoundTrip(value, level).restored).toEqual(value);
      });
    }
  }

  test("the compact file wraps an array as the value of `data`", () => {
    const compact = JSON.parse(jsonRoundTrip([{ itemName: "a" }], "medium").compact);
    expect(compact).toEqual({ _legend: { in: "itemName" }, data: [{ in: "a" }] });
  });
});

describe("K9: -d supports JSON only", () => {
  const JSON_ONLY = "decompress supports JSON only in this version";
  const others = readdirSync(fixtures).filter((f) => extname(f) !== ".json");

  test("there is one fixture for each of the 10 other formats", () => {
    expect(new Set(others.map(detectFormat)).size).toBe(10);
  });

  for (const file of others) {
    test(`-d on ${file} exits 1 with a message and writes nothing`, async () => {
      const dir = folder(file);
      const compact = `sample.compact${extname(file)}`;
      expect((await compressIn(dir, [file, "-l", "aggressive", "--no-stats"])).code).toBe(0);
      const before = snapshot(dir);
      const r = await compressIn(dir, ["-d", compact]);
      expect(r.code).toBe(1);
      expect(r.err).toContain(JSON_ONLY);
      expect(snapshot(dir)).toEqual(before);
    });
  }

  test("-d with --format yaml on a JSON file exits 1", async () => {
    const dir = folder("sample.json");
    await compressIn(dir, ["sample.json", "--no-stats"]);
    const before = snapshot(dir);
    const r = await compressIn(dir, ["-d", "-f", "yaml", "sample.compact.json"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain(JSON_ONLY);
    expect(snapshot(dir)).toEqual(before);
  });

  test("batch -d on a compact Markdown file exits 1 and writes nothing", async () => {
    const dir = folder("sample.md");
    await compressIn(dir, ["sample.md", "--no-stats"]);
    const before = snapshot(dir);
    const r = await compressIn(dir, ["-d", "-b", "-p", "*.compact.md", ".", "--no-stats"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(JSON_ONLY);
    expect(snapshot(dir)).toEqual(before);
  });

  test("the library function decompress throws for a format that is not JSON", () => {
    expect(() => decompress("# a: b\n---\nb: 1\n", "yaml")).toThrow(JSON_ONLY);
  });

  test("the help says that -d supports JSON only", async () => {
    const r = await compress([]);
    expect(r.out).toContain("JSON only");
  });
});
