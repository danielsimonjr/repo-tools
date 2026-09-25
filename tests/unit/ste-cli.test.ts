/**
 * `repo-tools ste`: the exit-code contract of the Markdown STE gate.
 *
 * Ported from the architecture-docs skill (`scripts/tests/test_ste_check.py`). Two of these
 * behaviours were live defects there: a crash on a character that the console could not encode,
 * and a vacuous pass ("0 problem(s) in 0 file(s)", exit 0) on a path that matched no Markdown.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../../src/cli.ts";
import { makeTempDir } from "./temp.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A new empty folder for one test. */
function tmp(): string {
  const dir = makeTempDir("ste");
  made.push(dir);
  return dir;
}

/** Runs `repo-tools ste` with captured output streams. */
async function ste(...args: string[]) {
  let out = "";
  let err = "";
  const code = await main(["ste", ...args], {
    stdout: (s) => {
      out += s;
    },
    stderr: (s) => {
      err += s;
    },
  });
  return { code, out, err };
}

/** A procedural sentence far over the 20-word limit. */
const WORDY = `You must ${Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ")} to finish the task.\n`;
const MARKER = "<!-- ste:historical-record -->\n";

describe("repo-tools ste: exit codes", () => {
  test("nothing examined is a failure, not a pass", async () => {
    const r = await ste(join(tmp(), "does-not-exist.md"));
    expect(r.code).toBe(2);
    expect(r.err).toContain("no Markdown file was examined");
  });

  test("an empty directory is also a failure", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "notes.txt"), "not markdown\n");
    expect((await ste(dir)).code).toBe(2);
  });

  test("a clean document exits 0", async () => {
    const doc = join(tmp(), "clean.md");
    writeFileSync(doc, "# Title\n\nThe tool reads the file. It writes a report.\n");
    const r = await ste(doc);
    expect(r.code).toBe(0);
    expect(r.out).toContain("in 1 file(s)");
  });

  test("a document with findings exits 1", async () => {
    const doc = join(tmp(), "wordy.md");
    writeFileSync(doc, `# Title\n\n${WORDY}`);
    expect((await ste(doc)).code).toBe(1);
  });

  test("non-ASCII findings do not crash the run", async () => {
    const doc = join(tmp(), "arrows.md");
    const words = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    writeFileSync(
      doc,
      `# Title\n\nThe value moves from “one” → “two”, and the dash — stays, ${words}.\n`,
    );
    // Through the real process entry, so the console encoding of the host is in the path.
    const bin = join(import.meta.dir, "../../src/bin.ts");
    const r = Bun.spawnSync([process.execPath, bin, "ste", doc]);
    expect([0, 1]).toContain(r.exitCode);
    expect(r.stdout.toString()).toContain("→");
  });

  test("no argument prints the usage and exits 2", async () => {
    const r = await ste();
    expect(r.code).toBe(2);
    expect(r.out).toContain("usage: repo-tools ste <file-or-directory> [...]");
  });
});

describe("repo-tools ste: the historical-record opt-out", () => {
  test("a historical record is skipped and reported", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "old-audit.md"), `${MARKER}# Audit\n\n${WORDY}`);
    writeFileSync(join(dir, "current.md"), "# Title\n\nThe tool reads the file.\n");
    const r = await ste(dir);
    expect(r.code).toBe(0);
    expect(r.out).toContain("old-audit.md: SKIPPED (historical record)");
    expect(r.out).toContain("in 1 file(s); 1 skipped as historical record(s)");
  });

  test("a marker below the header does not skip", async () => {
    const doc = join(tmp(), "buried.md");
    writeFileSync(doc, `# T\n\n${WORDY}\n\n\n\n${MARKER}`);
    expect((await ste(doc)).code).toBe(1);
  });

  test("only historical records is still nothing examined", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "old.md"), `${MARKER}# Old\n\n${WORDY}`);
    expect((await ste(dir)).code).toBe(2);
  });
});

describe("repo-tools ste: file selection", () => {
  test("a directory is walked recursively in code-unit order, Markdown files only", async () => {
    const dir = tmp();
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "b.md"), "# B\n\nThe tool reads the file.\n");
    writeFileSync(join(dir, "A.md"), "# A\n\nThe tool reads the file.\n");
    writeFileSync(join(dir, "sub", "c.md"), "# C\n\nThe tool reads the file.\n");
    writeFileSync(join(dir, "note.txt"), "text\n");
    const r = await ste(dir);
    expect(r.code).toBe(0);
    const order = [...r.out.matchAll(/=== (\S+): OK ===/g)].map((m) => m[1]);
    expect(order).toEqual(["A.md", "b.md", "c.md"]);
    expect(r.out).toContain("TOTAL: 0 problem(s) in 3 file(s)");
  });

  test("a folder named .pytest_cache is skipped", async () => {
    const dir = tmp();
    mkdirSync(join(dir, ".pytest_cache"));
    writeFileSync(join(dir, ".pytest_cache", "README.md"), `# X\n\n${WORDY}`);
    writeFileSync(join(dir, "ok.md"), "# OK\n\nThe tool reads the file.\n");
    const r = await ste(dir);
    expect(r.code).toBe(0);
    expect(r.out).toContain("in 1 file(s)");
  });
});
