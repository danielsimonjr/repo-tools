import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { run } from "../../src/chunk/index.ts";
import { main } from "../../src/cli.ts";
import {
  CASES,
  chunkFiles,
  FIXTURES,
  GOLDEN,
  type GoldenCase,
  maskManifest,
  maskOutput,
  readText,
  stageFixture,
} from "./chunk-golden.ts";

const work = mkdtempSync(join(tmpdir(), "repo-tools-chunk-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** Runs `chunk` with captured output streams. */
async function chunk(argv: string[]) {
  let out = "";
  let err = "";
  const code = await run(argv, {
    stdout: (s) => {
      out += s;
    },
    stderr: (s) => {
      err += s;
    },
  });
  return { code, out, err };
}

/** Split, status and merge on a staged copy of the fixture, as the goldens were made. */
async function roundTrip(c: GoldenCase) {
  const dir = join(work, "golden", c.name);
  const src = stageFixture(c, dir);
  const chunks = join(dir, `${c.file.slice(0, -extname(c.file).length)}_chunks`);
  const manifest = join(chunks, "manifest.json");
  const split = await chunk(["split", src, ...c.splitArgs]);
  const status = await chunk(["status", manifest]);
  const merge = await chunk(["merge", manifest]);
  return { dir, src, chunks, manifest, split, status, merge };
}

describe("chunk port reproduces the original chunker (characterization goldens)", () => {
  for (const c of CASES) {
    test(`${c.name}: chunks, manifest, merged file and output equal the goldens`, async () => {
      const r = await roundTrip(c);
      const g = join(GOLDEN, c.name);
      for (const step of [r.split, r.status, r.merge]) {
        expect(step.err).toBe("");
        expect(step.code).toBe(0);
      }
      expect(chunkFiles(r.chunks)).toEqual(chunkFiles(join(g, "chunks")));
      for (const f of chunkFiles(r.chunks)) {
        expect(readText(join(r.chunks, f))).toBe(readText(join(g, "chunks", f)));
      }
      expect(maskManifest(readText(r.manifest))).toBe(readText(join(g, "manifest.json")));
      expect(readText(r.src)).toBe(readText(join(g, `merged${extname(c.file)}`)));
      expect(maskOutput(r.split.out, r.dir)).toBe(readText(join(g, "split.stdout.txt")));
      expect(maskOutput(r.status.out, r.dir)).toBe(readText(join(g, "status.stdout.txt")));
      expect(maskOutput(r.merge.out, r.dir)).toBe(readText(join(g, "merge.stdout.txt")));
    });
  }

  test("K4: the TypeScript split points equal the original's (de3118a lexer cases)", async () => {
    const c = CASES.find((x) => x.name === "typescript") as GoldenCase;
    const dir = join(work, "k4");
    await chunk(["split", stageFixture(c, dir)]);
    const manifest = JSON.parse(readText(join(dir, "parser_chunks", "manifest.json")));
    const golden = JSON.parse(readText(join(GOLDEN, "typescript", "manifest.json")));
    const points = (m: { chunks: { title: string; lineCount: number }[] }) =>
      m.chunks.map((ch) => `${ch.title}:${ch.lineCount}`);
    expect(points(manifest)).toEqual(points(golden));
    // A lexer without the de3118a fix merges everything after `render` into one chunk.
    expect(points(manifest)).toEqual([
      "_imports:8",
      "function:render:9",
      "const:QUOTE_RE:1",
      "function:escaped:5",
      "class:Box:11",
      "interface:Shape:3",
      "type:Pair:1",
      "enum:Color:4",
      "function:helper:3",
      "const:LIMIT:1",
    ]);
  });
});

describe("chunk CLI wiring", () => {
  test("repo-tools chunk --help prints the chunk help", async () => {
    let out = "";
    const code = await main(["chunk", "--help"], {
      stdout: (s) => {
        out += s;
      },
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(out).toContain("repo-tools chunk split <file>");
  });

  test("no action prints the help and exits 0", async () => {
    const r = await chunk([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Usage:");
  });

  test("an unknown action exits 1", async () => {
    const r = await chunk(["explode", "x"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("explode");
  });

  for (const action of ["split", "merge", "status"]) {
    test(`${action} without a target exits 1`, async () => {
      const r = await chunk([action]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("Please specify");
    });
  }

  test("a missing file or manifest exits 1", async () => {
    const missing = join(work, "missing.md");
    expect((await chunk(["split", missing])).code).toBe(1);
    expect((await chunk(["merge", missing])).code).toBe(1);
    expect((await chunk(["status", missing])).code).toBe(1);
  });

  test("merge with a missing chunk file exits 1", async () => {
    const r = await roundTrip(CASES[0] as GoldenCase);
    rmSync(join(r.chunks, "001-preamble.md"));
    const m = await chunk(["merge", r.manifest]);
    expect(m.code).toBe(1);
    expect(m.err).toContain("Missing chunk file");
  });

  test("a manifest that is not JSON exits 1 with a message", async () => {
    const r = await roundTrip(CASES[0] as GoldenCase);
    writeFileSync(r.manifest, "not json");
    const m = await chunk(["status", r.manifest]);
    expect(m.code).toBe(1);
    expect(m.err).toContain("Error:");
  });

  test("--dry-run writes no chunk folder", async () => {
    const dir = join(work, "dry");
    const src = stageFixture(CASES[0] as GoldenCase, dir);
    const r = await chunk(["split", src, "--dry-run"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("[DRY RUN]");
    expect(() => readFileSync(join(dir, "guide_chunks", "manifest.json"))).toThrow();
  });
});

/** Splits a fresh copy of the Markdown fixture in `work/<name>` and returns its paths. */
async function splitGuide(name: string, extra: string[] = []) {
  const dir = join(work, name);
  const src = stageFixture(CASES[0] as GoldenCase, dir);
  const r = await chunk(["split", src, ...extra]);
  expect(r.code).toBe(0);
  const chunks = join(dir, "guide_chunks");
  return { dir, src, chunks, manifest: join(chunks, "manifest.json") };
}

describe("chunk fixes", () => {
  test("K1: the manifest stores sourceFile relative to the manifest folder", async () => {
    const s = await splitGuide("k1/before");
    const text = readText(s.manifest);
    expect(JSON.parse(text).sourceFile).toBe("../guide.md");
    expect(text).not.toContain(JSON.stringify(work).slice(1, -1));

    // Move the source file and its chunk folder together, then merge.
    const moved = join(work, "k1", "after");
    renameSync(s.dir, moved);
    const m = await chunk(["merge", join(moved, "guide_chunks", "manifest.json")]);
    expect(m.err).toBe("");
    expect(m.code).toBe(0);
    expect(m.out).toContain(`Merged file written: ${join(moved, "guide.md")}`);
    expect(readText(join(moved, "guide.md"))).toBe(readText(join(FIXTURES, "guide.md")));
  });

  test("K2: two splits of one file give byte-identical manifests (no createdAt)", async () => {
    const s = await splitGuide("k2");
    const first = readFileSync(s.manifest);
    await Bun.sleep(5);
    expect((await chunk(["split", s.src])).code).toBe(0);
    expect(readFileSync(s.manifest).equals(first)).toBe(true);
    expect(JSON.parse(first.toString())).not.toHaveProperty("createdAt");
  });

  test("K3: status reports a change that the old 32-bit hash cannot see", async () => {
    // The hash of the original chunker: h = h * 31 + code unit, 32-bit, then Math.abs.
    const oldHash = (text: string) => {
      let h = 0;
      for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
      return Math.abs(h).toString(16).padStart(8, "0");
    };
    const before = "# T\n\nAa\n";
    const after = "# T\n\nBB\n";
    expect(oldHash(after)).toBe(oldHash(before)); // "Aa" and "BB" collide.

    const dir = join(work, "k3");
    const src = join(dir, "t.md");
    stageFixture(CASES[0] as GoldenCase, dir);
    writeFileSync(src, before);
    expect((await chunk(["split", src])).code).toBe(0);
    writeFileSync(join(dir, "t_chunks", "001-t.md"), after);
    const s = await chunk(["status", join(dir, "t_chunks", "manifest.json")]);
    expect(s.code).toBe(0);
    expect(s.out).toContain("Modified:        1");
    expect(s.out).toContain("MODIFIED");

    const manifest = JSON.parse(readText(join(dir, "t_chunks", "manifest.json")));
    expect(manifest.chunks[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
