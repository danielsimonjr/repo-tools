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

/** Splits `text` as `file`, merges the unchanged chunks into a new file, and returns its bytes. */
async function roundTrip(name: string, file: string, text: string) {
  const dir = join(work, name);
  const src = put(join(dir, file), text);
  const s = await chunk(["split", src]);
  expect(s.code).toBe(0);
  const base = file.slice(0, file.lastIndexOf("."));
  const manifest = join(dir, `${base}_chunks`, "manifest.json");
  const out = join(dir, `merged-${file}`);
  const m = await chunk(["merge", manifest, "-o", out]);
  return { manifest, merge: m, bytes: readFileSync(out) };
}

const LINE_BREAK_CASES: [string, string, string][] = [
  ["mixed CRLF and LF", "doc.md", "# A\r\n\r\ntext\n## B\nmore\r\n\r\n## C\r\nend\n"],
  ["CR only", "doc.md", "# A\r\rtext\r## B\rmore\r"],
  ["no final line break", "doc.md", "# A\r\ntext\n## B\r\nend"],
  [
    "mixed TypeScript",
    "code.ts",
    "import a from 'a';\r\n\nexport const x = 1;\r\nfunction f() {\n  return 2;\r\n}\n",
  ],
  ["CR-only TypeScript", "code.ts", "const a = 1;\rconst b = 2;\r"],
  ["mixed JSON object", "data.json", '{\r\n  "a": 1,\n  "b": [\r\n    2\n  ]\r\n}'],
  ["CR-only JSON array", "list.json", "[\r  1,\r  2\r]\r"],
];

describe("chunk: split then merge keeps every line break (finding 4)", () => {
  for (const [what, file, text] of LINE_BREAK_CASES) {
    test(`${what} (${file}) is byte-identical after split and merge`, async () => {
      const r = await roundTrip(`breaks-${what.replace(/\W+/g, "-")}`, file, text);
      expect(r.merge.err).toBe("");
      expect(r.merge.code).toBe(0);
      expect(r.bytes.equals(Buffer.from(text))).toBe(true);
    });
  }

  test("a merge over the mixed source itself passes the shrink guard", async () => {
    const dir = join(work, "breaks-in-place");
    const text = "# A\r\n\r\ntext\n## B\nmore\r\n";
    const src = put(join(dir, "doc.md"), text);
    expect((await chunk(["split", src])).code).toBe(0);
    const m = await chunk(["merge", join(dir, "doc_chunks", "manifest.json")]);
    expect(m.err).toBe("");
    expect(m.code).toBe(0);
    expect(readFileSync(src).equals(Buffer.from(text))).toBe(true);
  });

  test("an edit that adds lines uses the most common line break, with a warning", async () => {
    const dir = join(work, "breaks-edit");
    const src = put(join(dir, "doc.md"), "# A\r\ntext\r\n## B\nend\r\n");
    expect((await chunk(["split", src])).code).toBe(0);
    const chunks = join(dir, "doc_chunks");
    const m = JSON.parse(readFileSync(join(chunks, "manifest.json"), "utf8"));
    writeFileSync(join(chunks, m.chunks[0].filename), "# A\ntext\nnew line");
    const out = join(dir, "out.md");
    const r = await chunk(["merge", join(chunks, "manifest.json"), "-o", out]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("line breaks");
    expect(readFileSync(out, "utf8")).toBe("# A\r\ntext\r\nnew line\r\n## B\r\nend\r\n");
  });
});

test("a manifest with an invalid lineBreaks value exits 1 (finding 4)", async () => {
  const p = plant("breaks-invalid", { ...manifestOf("../doc.md"), lineBreaks: "crlf*0,xx*2" });
  const r = await chunk(["merge", p.manifest]);
  expect(r.code).toBe(1);
  expect(r.err).toContain("lineBreaks");
});

describe("chunk: a manifest cannot target its own chunk folder (finding 6)", () => {
  for (const source of ["001-part.md", "manifest.json", "new.md"]) {
    test(`merge refuses the sourceFile ${source} in the chunk folder`, async () => {
      const p = plant(`self-${source}`, manifestOf(source));
      const before = readFileSync(p.manifest, "utf8");
      const r = await chunk(["merge", p.manifest, "--allow-shrink", "--yes"]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("chunk folder");
      expect(readFileSync(p.manifest, "utf8")).toBe(before);
      expect(readFileSync(join(p.chunks, "001-part.md"), "utf8")).toBe("# Part\n\nNew text.\n");
    });
  }

  test("status refuses a sourceFile in the chunk folder", async () => {
    const p = plant("self-status", manifestOf("001-part.md"));
    const r = await chunk(["status", p.manifest, "--yes"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("chunk folder");
  });

  test("merge refuses a sourceFile that reaches the chunk folder through a junction", async () => {
    const p = plant("self-junction", manifestOf(["..", "link", "001-part.md"].join("/")));
    await withJunction(p.chunks, join(p.b, "link"), async () => {
      const r = await chunk(["merge", p.manifest, "--allow-shrink"]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("chunk folder");
    });
    expect(readFileSync(join(p.chunks, "001-part.md"), "utf8")).toBe("# Part\n\nNew text.\n");
  });

  test("merge refuses -o in the chunk folder", async () => {
    const p = plant("self-output", manifestOf("../doc.md"));
    const r = await chunk(["merge", p.manifest, "-o", join(p.chunks, "out.md")]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("chunk folder");
  });

  for (const name of ["manifest.json", "MANIFEST.JSON", "Manifest.Json"]) {
    test(`merge and status refuse the chunk name ${name}`, async () => {
      const p = plant(`self-name-${name}`, manifestOf("../doc.md", name));
      for (const action of ["merge", "status"]) {
        const r = await chunk([action, p.manifest]);
        expect(r.code).toBe(1);
        expect(r.err).toContain("chunk file name");
      }
    });
  }
});

test("split -o refuses a chunk folder that holds the source file (finding 6)", async () => {
  const dir = join(work, "self-split");
  const src = put(join(dir, "doc.md"), "# A\n\ntext\n");
  const r = await chunk(["split", src, "-o", dir]);
  expect(r.code).toBe(1);
  expect(r.err).toContain("chunk folder");
  expect(r.out).toBe("");
});

describe("chunk: an invalid JSON chunk is named in the error (finding 9)", () => {
  for (const [what, edit, needle] of [
    ["invalid JSON", '{"a": ', "not valid JSON"],
    ["a JSON array", "[1, 2]", "not a JSON object"],
  ] as const) {
    test(`merge names the chunk that holds ${what}`, async () => {
      const dir = join(work, `json-error-${what.replace(/\W+/g, "-")}`);
      const src = put(join(dir, "data.json"), '{\n  "a": 1,\n  "b": 2\n}\n');
      expect((await chunk(["split", src])).code).toBe(0);
      const chunks = join(dir, "data_chunks");
      const m = JSON.parse(readFileSync(join(chunks, "manifest.json"), "utf8"));
      const name = m.chunks[1].filename;
      writeFileSync(join(chunks, name), edit);
      const r = await chunk(["merge", join(chunks, "manifest.json"), "-o", join(dir, "out.json")]);
      expect(r.code).toBe(1);
      expect(r.err).toContain(`chunk 2 (${name})`);
      expect(r.err).toContain(needle);
    });
  }
});
