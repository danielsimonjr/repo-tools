/** Unit tests for the `compress` fixes and the round trip (T5 steps 2 and 3). */
import { afterAll, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";
import { detectFormat, getCompressor, LEVELS } from "../../src/compress/formats.ts";
import { type CompressDeps, findFiles, run } from "../../src/compress/index.ts";
import { decompress, renameKeys } from "../../src/compress/legend.ts";
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

describe("batch -d never writes to its input", () => {
  /** The reviewer's folder, and a JSON file with a legend that is not a .compact file. */
  function reviewerFolder(): string {
    const dir = folder();
    writeFileSync(join(dir, "conf.yaml"), "# name: keep this comment\n---\nname: x\n# tail\n");
    writeFileSync(join(dir, "d.csv"), "#note row\nname,count\nn,1\n");
    writeFileSync(join(dir, "plain.json"), '{"_legend":{"n":"name"},"n":1}');
    return dir;
  }

  test('-b -d -p "*.*" on files without ".compact" exits 1 and changes no byte', async () => {
    const dir = reviewerFolder();
    const before = snapshot(dir);
    const r = await compressIn(dir, ["-b", "-d", "-p", "*.*", "."]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('Skipped 3 file(s) without ".compact" in the name.');
    expect(r.err).toContain("No files to process");
    expect(snapshot(dir)).toEqual(before);
  });

  test("batch -d restores only the .compact file next to the other files", async () => {
    const dir = reviewerFolder();
    copyFileSync(join(fixtures, "sample.json"), join(dir, "sample.json"));
    await compressIn(dir, ["sample.json", "--no-stats"]);
    rmSync(join(dir, "sample.json"));
    const before = snapshot(dir);
    const r = await compressIn(dir, ["-b", "-d", "-p", "*.json", ".", "--no-stats"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Skipped 1 file(s) without ".compact" in the name.');
    const after = new Map(snapshot(dir));
    for (const [name, text] of before) expect(after.get(name)).toBe(text);
    expect([...after.keys()]).toContain("sample.json");
  });
});

describe("-d changes only the base name", () => {
  const COMPACT = '{"_legend":{"n":"name"},"n":1}';

  /** A folder `x.compact` that holds `r.compact.json`. Returns the parent folder. */
  function compactFolder(): string {
    const dir = folder();
    mkdirSync(join(dir, "x.compact"));
    writeFileSync(join(dir, "x.compact", "r.compact.json"), COMPACT);
    return dir;
  }

  test("single mode in a folder named x.compact writes x.compact/r.json", async () => {
    const dir = compactFolder();
    const r = await compressIn(dir, ["-d", "x.compact/r.compact.json", "--no-stats"]);
    expect(r.code).toBe(0);
    expect(snapshot(dir).map(([name]) => name)).toEqual([
      "x.compact/r.compact.json",
      "x.compact/r.json",
    ]);
  });

  test("batch mode in a folder named x.compact writes x.compact/r.json", async () => {
    const dir = compactFolder();
    const r = await compressIn(dir, ["-b", "-d", "-p", "*.json", "x.compact", "--no-stats"]);
    expect(r.code).toBe(0);
    expect(snapshot(dir).map(([name]) => name)).toEqual([
      "x.compact/r.compact.json",
      "x.compact/r.json",
    ]);
  });

  test('a name with ".compact" before other text is written to .restored', async () => {
    const dir = folder();
    const name = "a.compact-old.json";
    writeFileSync(join(dir, name), COMPACT);
    for (const args of [
      ["-d", name],
      ["-b", "-d", name],
    ]) {
      const r = await compressIn(dir, [...args, "--no-stats"]);
      expect(r.code).toBe(0);
      expect(readFileSync(join(dir, name), "utf8")).toBe(COMPACT);
      expect(snapshot(dir).map(([n]) => n)).toEqual([name, "a.compact-old.restored.json"]);
    }
  });

  test('a name that ends in ".compact" loses the suffix', async () => {
    const dir = folder();
    writeFileSync(join(dir, "data.compact"), COMPACT);
    const r = await compressIn(dir, ["-d", "-f", "json", "data.compact", "--no-stats"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "data"), "utf8"))).toEqual({ name: 1 });
  });
});

describe('JSON: a "__proto__" key is kept', () => {
  const input = '{"__proto__":{"k":1},"b":2,"list":[{"__proto__":null}]}';
  for (const level of LEVELS) {
    test(`round trip at ${level}`, () => {
      const compact = getCompressor("json")(input, level).compressed;
      const restored = decompress(compact, "json");
      // Compare the JSON text: an own "__proto__" key and a prototype look the same to toEqual.
      expect(JSON.stringify(JSON.parse(restored))).toBe(input);
    });
  }

  test("renameKeys keeps an own __proto__ key and does not change the prototype", () => {
    const value = JSON.parse('{"__proto__":{"polluted":true},"a":1}') as object;
    const renamed = renameKeys(value, new Map([["a", "b"]])) as Record<string, unknown>;
    expect(Object.hasOwn(renamed, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(renamed)).toBe(Object.prototype);
    expect(renamed.polluted).toBeUndefined();
  });
});

describe("the batch pattern escapes every RegExp metacharacter", () => {
  function names(pattern: string, files: string[]): string[] {
    const dir = folder();
    for (const f of files) writeFileSync(join(dir, f), "x");
    return findFiles(dir, pattern, false).map((f) => relative(dir, f));
  }

  test('"a+b.md" matches only a+b.md, not aab.md', () => {
    expect(names("a+b.md", ["a+b.md", "aab.md", "aaab.md"])).toEqual(["a+b.md"]);
  });

  test('"[x].md" does not throw and matches only [x].md', () => {
    expect(names("[x].md", ["[x].md", "x.md"])).toEqual(["[x].md"]);
  });

  test('"a[.md" does not throw and matches only a[.md', () => {
    expect(names("a[.md", ["a[.md", "a.md"])).toEqual(["a[.md"]);
  });

  test("the other metacharacters are literal too", () => {
    const files = ["(a)$^{1}.md", "a.md", "ab.md"];
    expect(names("(a)$^{1}.md", files)).toEqual(["(a)$^{1}.md"]);
    // "|" is not valid in a Windows file name, so the test uses a pattern that must match nothing.
    expect(names("a|zz.md", files)).toEqual([]);
  });

  test("* and ? keep their glob meaning", () => {
    expect(names("a?.md", ["a.md", "ab.md", "abc.md"])).toEqual(["ab.md"]);
    expect(names("*.md", ["a.md", "b.txt"])).toEqual(["a.md"]);
  });
});

describe("JSON: an unsafe integer is refused", () => {
  const UNSAFE = '{"id":12345678901234567890,"ok":1}';

  test("compress exits 1 with a message that names the integer, and writes no file", async () => {
    const dir = folder();
    writeFileSync(join(dir, "big.json"), UNSAFE);
    const r = await compressIn(dir, ["big.json", "--no-stats"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("12345678901234567890");
    expect(r.err).toContain("safe integer range");
    expect(readdirSync(dir)).toEqual(["big.json"]);
  });

  test("batch compress fails the file and exits 1", async () => {
    const dir = folder();
    writeFileSync(join(dir, "big.json"), UNSAFE);
    const r = await compressIn(dir, ["-b", "big.json", "--no-stats"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("safe integer range");
    expect(readdirSync(dir)).toEqual(["big.json"]);
  });

  test("-d exits 1 on a compact file with an unsafe integer, and writes no file", async () => {
    const dir = folder();
    writeFileSync(join(dir, "big.compact.json"), '{"_legend":{},"n":-9007199254740993}');
    const r = await compressIn(dir, ["-d", "big.compact.json", "--no-stats"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("-9007199254740993");
    expect(readdirSync(dir)).toEqual(["big.compact.json"]);
  });

  test("the edge of the safe range, a string, a float and an exponent are accepted", () => {
    const input = JSON.stringify({
      max: 9007199254740991,
      min: -9007199254740991,
      text: "12345678901234567890",
      float: 0.5,
      exp: 1e300,
      "12345678901234567890": [1, -2],
    });
    expect(jsonRoundTrip(JSON.parse(input), "medium").restored).toEqual(JSON.parse(input));
  });

  test("the help tells that an integer-like key comes first", async () => {
    const r = await compress([]);
    expect(r.out).toContain("integer-like key");
    // The documented behaviour: JSON.parse puts "2" and "10" first, in numeric order.
    const restored = jsonRoundTrip({ b: 1, "10": 2, "2": 3 }, "medium").restored as object;
    expect(Object.keys(restored)).toEqual(["2", "10", "b"]);
  });
});
