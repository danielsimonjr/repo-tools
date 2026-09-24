/**
 * Tests for the review fixes of `repo-tools chunk` (review of 486d8f3..5743c5d).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/chunk/index.ts";

const work = mkdtempSync(join(tmpdir(), "repo-tools-chunk-review-"));
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

/** Writes `text` to `path` and creates the parent folder. */
function put(path: string, text: string): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  return path;
}

const ZERO_HASH = "0".repeat(64);

/**
 * Makes `<root>/a/b/chunks/manifest.json` with one chunk, a victim file `<root>/a/victim/target.txt`
 * and a secret file `<root>/a/b/secret.txt`. The parent folder of the chunk folder is `<root>/a/b`.
 */
function plant(name: string, manifest: Record<string, unknown>) {
  const root = join(work, name);
  const chunks = join(root, "a", "b", "chunks");
  const target = put(join(root, "a", "victim", "target.txt"), "ORIGINAL TARGET TEXT\n");
  const secret = put(join(root, "a", "b", "secret.txt"), "SECRET\n");
  put(join(chunks, "001-part.md"), "# Part\n\nNew text.\n");
  const path = put(join(chunks, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { root, chunks, target, secret, manifest: path };
}

function manifestOf(sourceFile: string, filename: string, version = "2.0.0") {
  return {
    version,
    sourceFile,
    sourceHash: ZERO_HASH,
    fileType: "markdown",
    splitLevel: 2,
    chunks: [
      {
        index: 1,
        filename,
        title: "Part",
        level: 1,
        startLine: 1,
        endLine: 3,
        lineCount: 3,
        hash: ZERO_HASH,
        modified: false,
      },
    ],
  };
}

const OUTSIDE = ["..", "..", "victim", "target.txt"].join("/");

describe("chunk path safety (reviewer finding 1)", () => {
  for (const bad of [["..", "secret.txt"].join("/"), "..", ".", "", ["x", "y.md"].join("\\")]) {
    for (const action of ["merge", "status"]) {
      test(`${action} refuses the chunk file name ${JSON.stringify(bad)}`, async () => {
        const p = plant(`name-${action}-${bad.replace(/\W/g, "_")}`, manifestOf("../x.md", bad));
        const r = await chunk([action, p.manifest, "--yes"]);
        expect(r.code).toBe(1);
        expect(r.err).toContain("chunk file name");
        expect(r.out).not.toContain("SECRET");
        expect(readFileSync(p.target, "utf8")).toBe("ORIGINAL TARGET TEXT\n");
      });
    }
  }

  test("merge refuses an absolute chunk file name", async () => {
    const p = plant("name-absolute", manifestOf("../x.md", "001-part.md"));
    const m = JSON.parse(readFileSync(p.manifest, "utf8"));
    m.chunks[0].filename = p.secret;
    writeFileSync(p.manifest, JSON.stringify(m));
    const r = await chunk(["merge", p.manifest, "--yes"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("chunk file name");
  });

  test("merge refuses an absolute sourceFile in a 2.x manifest", async () => {
    const p = plant("abs-source", manifestOf("", "001-part.md"));
    const m = JSON.parse(readFileSync(p.manifest, "utf8"));
    m.sourceFile = p.target;
    writeFileSync(p.manifest, JSON.stringify(m));
    for (const action of ["merge", "status"]) {
      const r = await chunk([action, p.manifest, "--yes"]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("absolute sourceFile");
    }
    expect(readFileSync(p.target, "utf8")).toBe("ORIGINAL TARGET TEXT\n");
  });

  test("merge refuses a target outside the parent of the chunk folder", async () => {
    const p = plant("outside", manifestOf(OUTSIDE, "001-part.md"));
    const r = await chunk(["merge", p.manifest]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("outside");
    expect(readFileSync(p.target, "utf8")).toBe("ORIGINAL TARGET TEXT\n");
    expect(existsSync(join(p.root, "a", "victim"))).toBe(true);
  });

  test("merge writes a target outside the parent folder with --yes", async () => {
    const p = plant("outside-yes", manifestOf(OUTSIDE, "001-part.md"));
    const r = await chunk(["merge", p.manifest, "--yes", "--allow-shrink"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(readFileSync(p.target, "utf8")).toBe("# Part\n\nNew text.\n");
  });

  test("merge with -o writes the named file and does not touch the outside source", async () => {
    const p = plant("outside-o", manifestOf(OUTSIDE, "001-part.md"));
    const out = join(p.root, "merged.md");
    const r = await chunk(["merge", p.manifest, "-o", out]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(readFileSync(out, "utf8")).toBe("# Part\n\nNew text.\n");
    expect(readFileSync(p.target, "utf8")).toBe("ORIGINAL TARGET TEXT\n");
  });

  test("status refuses a source outside the parent folder without --yes", async () => {
    const p = plant("status-outside", manifestOf(OUTSIDE, "001-part.md"));
    const r = await chunk(["status", p.manifest]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("outside");
    const y = await chunk(["status", p.manifest, "--yes"]);
    expect(y.err).toBe("");
    expect(y.code).toBe(0);
  });

  for (const [what, body, needle] of [
    ["no chunks", { version: "2.0.0", sourceFile: "../x.md", sourceHash: ZERO_HASH }, "chunks"],
    ["no sourceFile", { version: "2.0.0", sourceHash: ZERO_HASH, chunks: [] }, "sourceFile"],
    ["no version", { sourceFile: "../x.md", sourceHash: ZERO_HASH, chunks: [] }, "version"],
    [
      "a chunk without a hash",
      { version: "2.0.0", sourceFile: "../x.md", chunks: [{ index: 1, filename: "a.md" }] },
      "hash",
    ],
    ["an array", [], "object"],
  ] as const) {
    test(`a manifest with ${what} exits 1 with a clear message`, async () => {
      const p = plant(`shape-${what.replace(/\W/g, "_")}`, {});
      writeFileSync(p.manifest, JSON.stringify(body));
      for (const action of ["merge", "status"]) {
        const r = await chunk([action, p.manifest]);
        expect(r.code).toBe(1);
        expect(r.err).toContain("invalid manifest");
        expect(r.err).toContain(needle);
        expect(r.err).not.toContain("paths[");
      }
    });
  }
});

const FIXTURES = join(import.meta.dir, "../fixtures/chunk");

/** Copies fixture `file` to `<work>/<name>/`, splits it, merges it, and returns both texts. */
async function splitMerge(name: string, file: string, mergeFlags: string[] = []) {
  const dir = join(work, name);
  const src = put(join(dir, file), readFileSync(join(FIXTURES, file), "utf8"));
  const before = readFileSync(src, "utf8");
  const s = await chunk(["split", src]);
  expect(s.code).toBe(0);
  const base = file.slice(0, file.lastIndexOf("."));
  const manifest = join(dir, `${base}_chunks`, "manifest.json");
  const m = await chunk(["merge", manifest, ...mergeFlags]);
  return { dir, src, manifest, before, after: readFileSync(src, "utf8"), merge: m };
}

describe("chunk K7: no data loss on merge", () => {
  for (const file of ["list.json", "broken.json"]) {
    test(`${file} (one whole-file chunk) merges back to its original text`, async () => {
      const r = await splitMerge(`k7-${file}`, file);
      expect(r.merge.err).toBe("");
      expect(r.merge.code).toBe(0);
      expect(r.after).toBe(r.before);
    });
  }
});

describe("chunk JSON merge keeps a __proto__ key (finding 7)", () => {
  test('{"__proto__":{"k":1},"b":2} round-trips with its __proto__ key', async () => {
    const dir = join(work, "proto");
    const src = put(join(dir, "proto.json"), '{"__proto__":{"k":1},"b":2}\n');
    expect((await chunk(["split", src])).code).toBe(0);
    const m = await chunk(["merge", join(dir, "proto_chunks", "manifest.json")]);
    expect(m.err).toBe("");
    expect(m.code).toBe(0);
    const merged = JSON.parse(readFileSync(src, "utf8"));
    expect(Object.keys(merged)).toEqual(["__proto__", "b"]);
    expect(JSON.stringify(merged)).toBe('{"__proto__":{"k":1},"b":2}');
  });
});
