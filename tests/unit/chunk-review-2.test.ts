/**
 * Tests for the second review of the `chunk` fixes: link-safe paths, line-ending round trips and
 * clear chunk errors.
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/chunk/index.ts";

const work = mkdtempSync(join(tmpdir(), "repo-tools-chunk-review-2-"));
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

function manifestOf(sourceFile: string, filename = "001-part.md") {
  return {
    version: "2.0.0",
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

/**
 * Makes `<root>/a/b/chunks/manifest.json` with one chunk and a victim file
 * `<root>/a/victim/target.txt`. The parent folder of the chunk folder is `<root>/a/b`.
 */
function plant(name: string, manifest: Record<string, unknown>) {
  const root = join(work, name);
  const b = join(root, "a", "b");
  const chunks = join(b, "chunks");
  const victim = join(root, "a", "victim");
  const target = put(join(victim, "target.txt"), "ORIGINAL TARGET TEXT\n");
  put(join(chunks, "001-part.md"), "# Part\n\nNew text.\n");
  const path = put(join(chunks, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { root, b, chunks, victim, target, manifest: path };
}

/** Creates a junction at `link` to the folder `target`, runs `body`, and removes the junction. */
async function withJunction(target: string, link: string, body: () => Promise<void>) {
  symlinkSync(target, link, "junction");
  try {
    await body();
  } finally {
    rmdirSync(link);
  }
}

describe("chunk: a link in the source path does not escape the parent folder (finding 1)", () => {
  for (const action of ["merge", "status"]) {
    test(`${action} refuses a sourceFile through a junction to an outside folder`, async () => {
      const p = plant(`junction-${action}`, manifestOf(["..", "link", "target.txt"].join("/")));
      await withJunction(p.victim, join(p.b, "link"), async () => {
        const shrink = action === "merge" ? ["--allow-shrink"] : [];
        const r = await chunk([action, p.manifest, ...shrink]);
        expect(r.code).toBe(1);
        expect(r.err).toContain("outside");
        expect(readFileSync(p.target, "utf8")).toBe("ORIGINAL TARGET TEXT\n");
      });
    });
  }

  test("merge refuses a new file below a junction to an outside folder", async () => {
    const p = plant("junction-new", manifestOf(["..", "link", "new.txt"].join("/")));
    await withJunction(p.victim, join(p.b, "link"), async () => {
      const r = await chunk(["merge", p.manifest]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("outside");
    });
  });

  test("merge accepts a junction to a folder inside the parent folder", async () => {
    const p = plant("junction-inside", manifestOf(["..", "link", "doc.md"].join("/")));
    const inside = join(p.b, "real");
    put(join(inside, "doc.md"), "x\n");
    await withJunction(inside, join(p.b, "link"), async () => {
      const r = await chunk(["merge", p.manifest]);
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      expect(readFileSync(join(inside, "doc.md"), "utf8")).toBe("# Part\n\nNew text.\n");
    });
  });
});

/**
 * Creates a file symbolic link at `link` to `target`, runs `body`, and removes the link. Returns
 * false, and runs nothing, when this machine does not allow the link (EPERM on Windows without
 * the privilege).
 */
async function withFileLink(target: string, link: string, body: () => Promise<void>) {
  try {
    symlinkSync(target, link, "file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") return false;
    throw error;
  }
  try {
    await body();
  } finally {
    unlinkSync(link);
  }
  return true;
}

describe("chunk: a chunk file must be a regular file in the chunk folder (finding 2)", () => {
  for (const action of ["merge", "status"]) {
    test(`${action} refuses a chunk file that is a symbolic link`, async () => {
      const p = plant(`chunk-link-${action}`, manifestOf("../doc.md"));
      put(join(p.b, "doc.md"), "old\n");
      const secret = put(join(p.victim, "secret.txt"), "SECRET TEXT\n");
      rmSync(join(p.chunks, "001-part.md"));
      const ran = await withFileLink(secret, join(p.chunks, "001-part.md"), async () => {
        const r = await chunk([action, p.manifest]);
        expect(r.code).toBe(1);
        expect(r.err).toContain("not a regular file");
        expect(readFileSync(join(p.b, "doc.md"), "utf8")).toBe("old\n");
      });
      if (!ran) console.warn(`skipped: this machine does not allow a file symbolic link`);
    });

    test(`${action} refuses a chunk file that is a junction`, async () => {
      const p = plant(`chunk-junction-${action}`, manifestOf("../doc.md"));
      put(join(p.b, "doc.md"), "old\n");
      rmSync(join(p.chunks, "001-part.md"));
      await withJunction(p.victim, join(p.chunks, "001-part.md"), async () => {
        const r = await chunk([action, p.manifest]);
        expect(r.code).toBe(1);
        expect(r.err).toContain("not a regular file");
      });
    });
  }
});

describe("chunk split: the chunk folder must be on the volume of the source (finding 3)", () => {
  test("split -o on another drive exits 1 and writes nothing", async () => {
    if (process.platform !== "win32") {
      console.warn("skipped: a drive letter exists on Windows only");
      return;
    }
    const src = put(join(work, "volume", "doc.md"), "# A\n\ntext\n");
    // A drive letter that differs from the drive of the source. Split refuses before it writes,
    // so the drive does not need to exist.
    const other = src.toUpperCase().startsWith("Q:") ? "R:" : "Q:";
    const r = await chunk(["split", src, "-o", `${other}chunks`]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("same volume");
    expect(r.out).toBe("");
  });
});
