import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as privacy from "../../scripts/privacy-check.ts";
import { makeTempDir } from "./temp.ts";

// The accept-list (design 10.2) records a reviewed finding in the history of a repository.
// The history cannot change, so a new commit cannot clear the finding. An entry names a full
// commit sha, one finding kind and one line of the commit message. Every plant is built from
// fragments, so this file never holds a literal finding.
const EMAIL = `someone${"@"}example.net`;
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const LIST = "scripts/privacy-accepted.txt";
const WORD = "zorblatt";

const git = (cwd: string, args: string[], stdin?: string) => {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdin: stdin ? Buffer.from(stdin) : undefined });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
};

/** A repository with a denylist of `WORD`, padded to the CLI floor, and one initial commit. */
function makeRepo(): string {
  const dir = makeTempDir("privacy-repo");
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["config", "user.email", `t${"@"}users.noreply.github.com`]);
  git(dir, ["config", "core.autocrlf", "false"]);
  mkdirSync(join(dir, "scripts"));
  const hashes = [`${privacy.hashToken(WORD)} person`];
  for (let i = 0; i < privacy.DENYLIST_FLOOR; i++) {
    hashes.push(`${privacy.hashToken(`filler${i}`)} private`);
  }
  writeFileSync(join(dir, "scripts/privacy-denylist.sha256"), `${hashes.join("\n")}\n`);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "init"]);
  return dir;
}

/**
 * Adds a commit whose message holds an e-mail on line 3 and `WORD` on line 4 (the lines of the
 * message, where line 1 is the subject). Returns the full sha of the new commit.
 */
function addLeakyCommit(dir: string): string {
  git(dir, ["commit", "-q", "--allow-empty", "-F", "-"], `fix: x\n\nthanks ${EMAIL}\nby ${WORD}\n`);
  return git(dir, ["rev-parse", "HEAD"]);
}

/** Writes and stages the accept-list. */
function accept(dir: string, lines: string[]): void {
  writeFileSync(join(dir, LIST), `${lines.join("\n")}\n`);
  git(dir, ["add", LIST]);
}

const wordKind = `denylist:${privacy.hashToken(WORD).slice(0, 12)}`;

/** The rules of the findings, with the repository removed after the read. */
async function found(dir: string): Promise<string[]> {
  try {
    return (await privacy.runCheck(dir)).map((f) => f.rule);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("accept-list: what an entry accepts", () => {
  test("(a) a listed sha, kind and line passes", async () => {
    const dir = makeRepo();
    const sha = addLeakyCommit(dir);
    accept(dir, [
      `${sha} email 3 public address of a tool`,
      `${sha} ${wordKind} 4 name of a person in a commit they made`,
    ]);
    expect(await found(dir)).toEqual([]);
  });

  test("(b) the same sha with a different kind still fails, and the entry is stale", async () => {
    const dir = makeRepo();
    const sha = addLeakyCommit(dir);
    accept(dir, [
      `${sha} session-url 3 wrong kind`,
      `${sha} ${wordKind} 4 name of a person in a commit they made`,
    ]);
    expect((await found(dir)).sort()).toEqual(["accepted-stale", "email"]);
  });

  test("(b) the same sha and kind on another line still fails", async () => {
    const dir = makeRepo();
    const sha = addLeakyCommit(dir);
    accept(dir, [
      `${sha} email 2 wrong line`,
      `${sha} ${wordKind} 4 name of a person in a commit they made`,
    ]);
    expect((await found(dir)).sort()).toEqual(["accepted-stale", "email"]);
  });

  test("(b) a denylist entry is keyed by the token, not by the rule", async () => {
    const dir = makeRepo();
    const sha = addLeakyCommit(dir);
    accept(dir, [
      `${sha} email 3 public address of a tool`,
      `${sha} denylist:000000000000 4 wrong`,
    ]);
    expect((await found(dir)).sort()).toEqual(["accepted-stale", "denylist"]);
  });

  test("(c) an unlisted sha still fails, and the entry is stale", async () => {
    const dir = makeRepo();
    const other = git(dir, ["rev-parse", "HEAD"]);
    addLeakyCommit(dir);
    accept(dir, [`${other} email 3 a reachable sha that holds no finding`]);
    expect((await found(dir)).sort()).toEqual(["accepted-stale", "denylist", "email"]);
  });

  test("(d) an entry whose sha is not in the history is stale", async () => {
    const dir = makeRepo();
    try {
      accept(dir, ["# reviewed entries", `${SHA_A} email 3 a commit that is not here`]);
      const findings = await privacy.runCheck(dir);
      expect(findings).toEqual([{ file: LIST, line: 2, rule: "accepted-stale" }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an entry never accepts a finding in a tracked file", async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "notes.md"), `mail ${EMAIL}\n`);
    git(dir, ["add", "notes.md"]);
    accept(dir, [`${git(dir, ["rev-parse", "HEAD"])} email 1 not a commit finding`]);
    expect((await found(dir)).sort()).toEqual(["accepted-stale", "email"]);
  });

  test("a repository without an accept-list has no exemption", async () => {
    const dir = makeRepo();
    addLeakyCommit(dir);
    expect((await found(dir)).sort()).toEqual(["denylist", "email"]);
  });

  test("a malformed accept-list fails the check", async () => {
    const dir = makeRepo();
    accept(dir, ["not-a-sha email 3 reason"]);
    try {
      await expect(privacy.runCheck(dir)).rejects.toThrow("privacy-accepted: malformed line 1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("accept-list: the file format", () => {
  test("a comment, a blank line and an entry parse, with the line of the entry", () => {
    const entries = privacy.parseAccepted(`# why\n\n${SHA_A} email 7 a public tool address\r\n`);
    expect(entries).toEqual([
      { sha: SHA_A, kind: "email", line: 7, reason: "a public tool address", entryLine: 3 },
    ]);
  });

  test("a denylist kind holds the 12 digits of the token hash", () => {
    expect(privacy.parseAccepted(`${SHA_A} denylist:0123456789ab 2 r`)[0]?.kind).toBe(
      "denylist:0123456789ab",
    );
  });

  test.each([
    ["a short sha", `${SHA_A.slice(0, 12)} email 3 reason`],
    ["an upper-case sha", `${"A".repeat(40)} email 3 reason`],
    ["a wildcard sha", `* email 3 reason`],
    ["a wildcard kind", `${SHA_A} * 3 reason`],
    ["an unknown kind", `${SHA_A} binary 3 reason`],
    ["a denylist kind without a token", `${SHA_A} denylist 3 reason`],
    ["a denylist kind with a short token", `${SHA_A} denylist:0123 3 reason`],
    ["a wildcard line", `${SHA_A} email * reason`],
    ["line 0", `${SHA_A} email 0 reason`],
    ["a missing reason", `${SHA_A} email 3`],
    ["a missing line", `${SHA_A} email`],
  ])("%s is rejected", (_name, line) => {
    expect(() => privacy.parseAccepted(line)).toThrow("privacy-accepted: malformed line 1");
  });

  test("a repeated entry is rejected, by line number", () => {
    const text = `${SHA_A} email 3 reason\n${SHA_B} email 3 reason\n${SHA_A} email 3 again\n`;
    expect(() => privacy.parseAccepted(text)).toThrow("privacy-accepted: malformed line 3");
  });

  test("an error names the line and never holds the content", () => {
    try {
      privacy.parseAccepted(`zorblatt-secret email 3 reason`);
      throw new Error("expected a throw");
    } catch (error) {
      expect(String(error)).not.toContain("zorblatt-secret");
    }
  });
});

describe("accept-list: applyAccepted", () => {
  const finding = (over: Partial<privacy.Finding> = {}): privacy.Finding => ({
    file: `commit ${SHA_A.slice(0, 12)}`,
    line: 3,
    rule: "email" as const,
    sha: SHA_A,
    ...over,
  });
  const entry = { sha: SHA_A, kind: "email", line: 3, reason: "r", entryLine: 5 };

  test("an exact match is accepted and leaves no finding", () => {
    const out = privacy.applyAccepted([finding()], [entry]);
    expect(out.findings).toEqual([]);
    expect(out.accepted.map((a) => a.entry)).toEqual([entry]);
  });

  test("a finding without a full sha is never accepted", () => {
    const f = finding({ sha: undefined });
    expect(privacy.applyAccepted([f], [entry]).findings.map((x) => x.rule)).toEqual([
      "email",
      "accepted-stale",
    ]);
  });

  test("an unused entry becomes a stale finding at its own line of the list", () => {
    expect(privacy.applyAccepted([], [entry]).findings).toEqual([
      { file: LIST, line: 5, rule: "accepted-stale" },
    ]);
  });

  test("one entry accepts one finding and nothing else on the commit", () => {
    const other = finding({ line: 4 });
    const out = privacy.applyAccepted([finding(), other], [entry]);
    expect(out.findings).toEqual([other]);
  });

  test("the kind of a finding is its rule, or the rule and the token for a denylist hit", () => {
    expect(privacy.findingKind(finding())).toBe("email");
    expect(privacy.findingKind(finding({ rule: "denylist", detail: "0123456789ab" }))).toBe(
      "denylist:0123456789ab",
    );
  });
});

describe("accept-list: the command line", () => {
  const script = join(import.meta.dir, "../../scripts/privacy-check.ts");
  const run = (dir: string) => {
    const r = Bun.spawnSync([process.execPath, script], { cwd: dir });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  };

  test("an accepted finding exits 0 and is listed with its reason", () => {
    const dir = makeRepo();
    try {
      const sha = addLeakyCommit(dir);
      accept(dir, [
        `${sha} email 3 public address of a tool`,
        `${sha} ${wordKind} 4 name of a person in a commit they made`,
      ]);
      const { code, out, err } = run(dir);
      expect(err).toBe("");
      expect(code).toBe(0);
      expect(out).toContain(`commit ${sha.slice(0, 12)}:3: email (public address of a tool)`);
      expect(out).toContain("0 findings, 2 accepted.");
      expect(out).not.toContain(EMAIL);
      expect(out).not.toContain(WORD);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a stale entry exits 1 and names the line of the list", () => {
    const dir = makeRepo();
    try {
      accept(dir, [`${SHA_A} email 3 a commit that is not here`]);
      const { code, err } = run(dir);
      expect(code).toBe(1);
      expect(err).toContain(`${LIST}:1: accepted-stale`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
