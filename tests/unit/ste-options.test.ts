/**
 * `repo-tools ste --require=<path>` and `--since=<rev>`.
 *
 * `--require` closes a gap of the folder walk: a document that someone deletes inside a folder
 * that still exists gives no finding and no error. `--since` lets a long document with old
 * findings gate a new edit: only the findings on the lines that the working tree adds or changes
 * since a revision count.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../../src/cli.ts";
import { makeTempDir } from "./temp.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A new empty folder for one test. */
function tmp(): string {
  const dir = makeTempDir("ste-options");
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

/** A sentence far over the 25-word limit. The `prefix` makes its words easy to find in the output. */
function longSentence(prefix: string): string {
  return `You must ${Array.from({ length: 40 }, (_, i) => `${prefix}${i}`).join(" ")} to finish the task.`;
}

const CLEAN = "The tool reads the file. It writes a report.\n";
const MARKER = "<!-- ste:historical-record -->\n";

/** Runs git in `cwd`; throws on a non-zero exit. */
function git(cwd: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

/** A git repository that holds `files` in one commit. */
function repoWith(files: Record<string, string>): string {
  const root = tmp();
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  git(root, "config", "core.autocrlf", "false");
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  return root;
}

describe("repo-tools ste --require", () => {
  test("a required file that exists and is examined passes", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "a.md"), CLEAN);
    const r = await ste(dir, `--require=${join(dir, "a.md")}`);
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
  });

  test("a document deleted inside a folder that still exists is an error", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "a.md"), CLEAN);
    const r = await ste(dir, `--require=${join(dir, "gone.md")}`);
    expect(r.code).toBe(2);
    expect(r.err).toContain("ERROR: required file does not exist: ");
    expect(r.err).toContain("gone.md");
    expect(r.out).toContain("a.md: OK");
  });

  test("a required file that the run did not examine is an error", async () => {
    const inside = tmp();
    const outside = tmp();
    writeFileSync(join(inside, "a.md"), CLEAN);
    writeFileSync(join(outside, "b.md"), CLEAN);
    const r = await ste(inside, `--require=${join(outside, "b.md")}`);
    expect(r.code).toBe(2);
    expect(r.err).toContain("ERROR: required file was not examined: ");
    expect(r.err).toContain("b.md");
  });

  test("a required file that is a historical record counts as examined", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "old.md"), `${MARKER}${longSentence("alpha")}\n`);
    const r = await ste(dir, `--require=${join(dir, "old.md")}`);
    expect(r.code).toBe(2);
    expect(r.err).toContain("no Markdown file was examined");
    expect(r.err).not.toContain("required file");
    writeFileSync(join(dir, "ok.md"), CLEAN);
    expect((await ste(dir, `--require=${join(dir, "old.md")}`)).code).toBe(0);
  });

  test("a relative required path matches the file that the walk finds", async () => {
    const dir = tmp();
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "a.md"), CLEAN);
    const before = process.cwd();
    process.chdir(dir);
    try {
      const r = await ste("docs", "--require=./docs/../docs/a.md");
      expect(r.code).toBe(0);
    } finally {
      process.chdir(before);
    }
  });

  test("the flag repeats, and the run reports every required file that fails", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "a.md"), CLEAN);
    const r = await ste(dir, `--require=${join(dir, "x.md")}`, `--require=${join(dir, "y.md")}`);
    expect(r.code).toBe(2);
    expect(r.err).toContain("x.md");
    expect(r.err).toContain("y.md");
  });

  test("a required file that is a folder is an error", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "a.md"), CLEAN);
    mkdirSync(join(dir, "sub.md"));
    const r = await ste(dir, `--require=${join(dir, "sub.md")}`);
    expect(r.code).toBe(2);
    expect(r.err).toContain("required file does not exist");
  });

  test("a bare --require, an empty value and a finding keep their exit codes", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "a.md"), CLEAN);
    const bare = await ste(dir, "--require");
    expect(bare.code).toBe(2);
    expect(bare.err).toContain("--require needs a path");
    const empty = await ste(dir, "--require=");
    expect(empty.code).toBe(2);
    expect(empty.err).toContain("--require needs a path");
    writeFileSync(join(dir, "b.md"), `${longSentence("alpha")}\n`);
    expect((await ste(dir, `--require=${join(dir, "b.md")}`)).code).toBe(1);
  });
});

describe("repo-tools ste --since", () => {
  test("an old finding is hidden, counted and does not fail the run", async () => {
    const root = repoWith({ "doc.md": `${longSentence("alpha")}\n` });
    const doc = join(root, "doc.md");
    expect((await ste(doc)).code).toBe(1);
    const r = await ste(doc, "--since=HEAD");
    expect(r.code).toBe(0);
    expect(r.out).toContain("doc.md: OK");
    expect(r.out).toContain(
      "TOTAL: 0 problem(s) in 1 file(s); 1 older finding(s) hidden by --since=HEAD",
    );
    expect(r.out).not.toContain("alpha");
  });

  test("a finding on an added paragraph shows, and the old one stays hidden", async () => {
    const root = repoWith({ "doc.md": `${longSentence("alpha")}\n` });
    const doc = join(root, "doc.md");
    appendFileSync(doc, `\n${longSentence("beta")}\n`);
    const r = await ste(doc, "--since=HEAD");
    expect(r.code).toBe(1);
    expect(r.out).toContain("beta0");
    expect(r.out).not.toContain("alpha0");
    expect(r.out).toContain("doc.md: 1 problem(s)");
    expect(r.out).toContain(
      "TOTAL: 1 problem(s) in 1 file(s); 1 older finding(s) hidden by --since=HEAD",
    );
  });

  test("a sentence-length finding shows when a later line of its paragraph changed", async () => {
    const words = (from: number, to: number) =>
      Array.from({ length: to - from }, (_, i) => `alpha${from + i}`).join(" ");
    const text = `You must ${words(0, 14)}\n${words(14, 28)}\n${words(28, 40)} to finish the task.\n`;
    const root = repoWith({ "doc.md": text });
    const doc = join(root, "doc.md");
    expect((await ste(doc, "--since=HEAD")).code).toBe(0);
    writeFileSync(doc, text.replace("alpha39", "gamma39"));
    const r = await ste(doc, "--since=HEAD");
    expect(r.code).toBe(1);
    expect(r.out).toContain("doc.md:~1:");
  });

  test("a deletion inside a paragraph shows the finding of the paragraph", async () => {
    const words = (from: number, to: number) =>
      Array.from({ length: to - from }, (_, i) => `alpha${from + i}`).join(" ");
    const lines = [
      `You must ${words(0, 14)}`,
      words(14, 28),
      `${words(28, 40)} to finish the task.`,
    ];
    const root = repoWith({ "doc.md": `${lines.join("\n")}\n` });
    const doc = join(root, "doc.md");
    writeFileSync(doc, `${[lines[0], lines[2]].join("\n")}\n`);
    const r = await ste(doc, "--since=HEAD");
    expect(r.code).toBe(1);
    expect(r.out).toContain("doc.md:~1:");
  });

  // Each case commits `before`, writes `after`, and expects the old finding to stay hidden: the
  // deletion cuts between two paragraphs, so it touches neither. Each case runs in its own test
  // because every test makes a git repository, and a loaded machine needs about a second for it.
  const SHORT = "The tool reads the file.";
  const cutCases: [string, string[], string[]][] = [
    [
      "in the middle of the document",
      [longSentence("alpha"), "", SHORT, "", "The tool writes a report."],
      [longSentence("alpha"), "", "The tool writes a report."],
    ],
    ["above the old finding", [SHORT, "", longSentence("alpha")], [longSentence("alpha")]],
    ["below the old finding", [longSentence("alpha"), "", SHORT], [longSentence("alpha")]],
  ];
  for (const [place, before, after] of cutCases) {
    test(`a deletion ${place} leaves the old finding hidden`, async () => {
      const root = repoWith({ "doc.md": `${before.join("\n")}\n` });
      const doc = join(root, "doc.md");
      writeFileSync(doc, `${after.join("\n")}\n`);
      const r = await ste(doc, "--since=HEAD");
      expect(r.code).toBe(0);
      expect(r.out).toContain("1 older finding(s) hidden");
    });
  }

  test("a wordy form on a changed line shows, and the same form on an old line stays hidden", async () => {
    const root = repoWith({ "doc.md": "We use a number of tools.\n" });
    const doc = join(root, "doc.md");
    appendFileSync(doc, "\nWe read a number of files.\n");
    const r = await ste(doc, "--since=HEAD");
    expect(r.code).toBe(1);
    expect(r.out).toContain("doc.md:3: wordy: 'a number of'");
    expect(r.out).not.toContain("doc.md:1:");
    expect(r.out).toContain("1 older finding(s) hidden");
  });

  test("a file that did not exist at the revision counts in full", async () => {
    const root = repoWith({ "base.md": CLEAN });
    const fresh = join(root, "fresh.md");
    writeFileSync(fresh, `${longSentence("alpha")}\n`);
    const untracked = await ste(fresh, "--since=HEAD");
    expect(untracked.code).toBe(1);
    expect(untracked.out).toContain("alpha0");
    git(root, "add", "fresh.md");
    const staged = await ste(fresh, "--since=HEAD");
    expect(staged.code).toBe(1);
    expect(staged.out).toContain("alpha0");
  });

  test("a revision other than HEAD, and a folder argument, work", async () => {
    const root = repoWith({ "doc.md": `${longSentence("alpha")}\n` });
    const doc = join(root, "doc.md");
    appendFileSync(doc, `\n${longSentence("beta")}\n`);
    git(root, "commit", "-q", "-am", "second");
    expect((await ste(root, "--since=HEAD")).code).toBe(0);
    const r = await ste(root, "--since=HEAD~1");
    expect(r.code).toBe(1);
    expect(r.out).toContain("beta0");
    expect(r.out).not.toContain("alpha0");
  });

  test("an unknown revision is an error", async () => {
    const root = repoWith({ "doc.md": CLEAN });
    const r = await ste(join(root, "doc.md"), "--since=no-such-rev");
    expect(r.code).toBe(2);
    expect(r.err).toContain("cannot resolve revision 'no-such-rev'");
  });

  test("a folder outside a git work tree is an error", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "doc.md"), CLEAN);
    const r = await ste(join(dir, "doc.md"), "--since=HEAD");
    expect(r.code).toBe(2);
    expect(r.err).toContain("--since needs a git work tree");
  });

  test("a revision that starts with a dash, and an empty revision, are errors", async () => {
    const root = repoWith({ "doc.md": CLEAN });
    const dash = await ste(join(root, "doc.md"), "--since=--output=x");
    expect(dash.code).toBe(2);
    expect(dash.err).toContain("--since needs a revision");
    const empty = await ste(join(root, "doc.md"), "--since=");
    expect(empty.code).toBe(2);
    expect(empty.err).toContain("--since needs a revision");
  });

  test("--require and --since work together", async () => {
    const root = repoWith({ "doc.md": `${longSentence("alpha")}\n` });
    const doc = join(root, "doc.md");
    const r = await ste(root, `--require=${doc}`, "--since=HEAD");
    expect(r.code).toBe(0);
    const gone = await ste(root, `--require=${join(root, "gone.md")}`, "--since=HEAD");
    expect(gone.code).toBe(2);
  });
});
