/**
 * Characterization tests for the `compress` port (T5 step 1).
 *
 * The goldens in tests/golden/compress were written by the original tool, run on copies of the
 * fixtures in tests/fixtures/compress. The port must give the same bytes and the same output.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { detectFormat, getCompressor, LEVELS } from "../../src/compress/formats.ts";
import { run } from "../../src/compress/index.ts";
import { decompress } from "../../src/compress/legend.ts";
import { compareCodeUnits } from "../../src/sort.ts";

const fixtures = join(import.meta.dir, "../fixtures/compress");
const golden = join(import.meta.dir, "../golden/compress");
const work = mkdtempSync(join(tmpdir(), "repo-tools-compress-golden-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const read = (path: string) => readFileSync(path, "utf8");
const files = readdirSync(fixtures).sort(compareCodeUnits);

interface GoldenRun {
  args: string[];
  exit: number;
  stdout: string;
  stderr: string;
}
const runs: Record<string, GoldenRun> = JSON.parse(read(join(golden, "stdout.json")));

/** Runs the port with `cwd` as the working folder, as the original was run. */
async function runIn(cwd: string, args: string[]) {
  let stdout = "";
  let stderr = "";
  const before = process.cwd();
  process.chdir(cwd);
  try {
    const exit = await run(args, {
      stdout: (s) => {
        stdout += s;
      },
      stderr: (s) => {
        stderr += s;
      },
    });
    return { args, exit, stdout, stderr };
  } finally {
    process.chdir(before);
  }
}

test("there is one fixture for each of the 11 formats", () => {
  expect(new Set(files.map(detectFormat)).size).toBe(11);
});

describe("compressors and decompress match the goldens", () => {
  for (const file of files) {
    const ext = extname(file);
    const name = ext.slice(1);
    const format = detectFormat(file);
    for (const level of LEVELS) {
      test(`${file} at ${level}`, () => {
        const compact = read(join(golden, `${name}.${level}.compact${ext}`));
        expect(getCompressor(format)(read(join(fixtures, file)), level).compressed).toBe(compact);
        expect(decompress(compact, format)).toBe(
          read(join(golden, `${name}.${level}.restored${ext}`)),
        );
      });
    }
  }
});

describe("the CLI output matches the goldens", () => {
  for (const file of files) {
    const ext = extname(file);
    const name = ext.slice(1);
    for (const level of LEVELS) {
      test(`${file} -l ${level}, then -d`, async () => {
        const dir = join(work, `${file}-${level}`);
        mkdirSync(dir, { recursive: true });
        copyFileSync(join(fixtures, file), join(dir, file));

        const compress = runs[`${file} -l ${level}`];
        expect(await runIn(dir, [file, "-l", level])).toEqual(compress as GoldenRun);
        const compactFile = join(dir, `sample.compact${ext}`);
        expect(read(compactFile)).toBe(read(join(golden, `${name}.${level}.compact${ext}`)));

        const restore = runs[`-d ${file} (${level})`];
        expect(await runIn(dir, ["-d", `sample.compact${ext}`])).toEqual(restore as GoldenRun);
        expect(read(join(dir, file))).toBe(read(join(golden, `${name}.${level}.restored${ext}`)));
      });
    }
  }

  test("--dry-run shows a preview and writes no file", async () => {
    const dir = join(work, "dry-run");
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(fixtures, "sample.md"), join(dir, "sample.md"));
    const expected = runs["sample.md --dry-run"] as GoldenRun;
    expect(await runIn(dir, expected.args)).toEqual(expected);
    expect(readdirSync(dir)).toEqual(["sample.md"]);
  });

  test("batch mode over all fixtures", async () => {
    const dir = join(work, "batch");
    mkdirSync(dir, { recursive: true });
    for (const f of files) copyFileSync(join(fixtures, f), join(dir, f));
    const expected = runs["-b -p sample.*"] as GoldenRun;
    expect(await runIn(dir, expected.args)).toEqual(expected);
  });

  test("every golden run is used by a test", () => {
    expect(Object.keys(runs).length).toBe(files.length * LEVELS.length * 2 + 2);
  });
});
