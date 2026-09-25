import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertDenylistFloor,
  type Denylist,
  type Finding,
  formatFinding,
  hashToken,
  parseDenylist,
  runCheck,
  scanCommitMessage,
  scanText,
  scanTrackedFile,
  selfTest,
} from "../../scripts/privacy-check.ts";
import { makeTempDir } from "./temp.ts";

// Every plant is built from fragments, so this file never holds a literal finding and the
// repository's own scan stays clean.
const SEP = "\\";
const WIN_PATH = `C:${SEP}Users${SEP}someone${SEP}project`;
const WIN_PATH_LOWER = `c:/${"users"}/someone/project`;
const HOME_PATH = `/${"home"}/someone/project`;
const MAC_PATH = `/${"Users"}/someone/project`;
const SESSION = `https://claude.ai/code/${"session"}_0123456789`;
const EMAIL = `someone${"@"}example.net`;
const ORG = "danielsimonjr";

const DENY: Denylist = new Map([
  [hashToken("zorblatt"), "person"],
  [hashToken("quuxwiki"), "private"],
  [hashToken(ORG), "person"],
]);

const rules = (fs: Finding[]) => fs.map((f) => f.rule);

describe("scanText rules (design 10.2)", () => {
  test("clean text has no finding", () => {
    expect(scanText("README.md", "A plain sentence about graphs.\n", DENY)).toEqual([]);
  });

  test("a Windows user path fails, in any letter case", () => {
    expect(rules(scanText("a.md", `see ${WIN_PATH}\n`, DENY))).toEqual(["windows-user-path"]);
    expect(rules(scanText("a.md", `see ${WIN_PATH_LOWER}\n`, DENY))).toEqual(["windows-user-path"]);
  });

  test("a POSIX home path fails; a URL path segment does not", () => {
    expect(rules(scanText("a.md", `at ${HOME_PATH}\n`, DENY))).toEqual(["posix-home-path"]);
    expect(rules(scanText("a.md", `"${MAC_PATH}"\n`, DENY))).toEqual(["posix-home-path"]);
    expect(scanText("a.md", "https://example.com/users/foo/bar\n", DENY)).toEqual([]);
  });

  test("the finding reports the correct line number", () => {
    const [f] = scanText("a.md", `one\ntwo\nthree ${HOME_PATH}\n`, DENY);
    expect(f?.line).toBe(3);
  });

  test("a denylisted token fails, whatever its letter case", () => {
    expect(rules(scanText("README.md", "Written by Zorblatt.\n", DENY))).toEqual(["denylist"]);
    expect(rules(scanText("README.md", "uses QUUXWIKI data\n", DENY))).toEqual(["denylist"]);
  });

  test("a denylisted word inside a longer token does not match", () => {
    expect(scanText("README.md", "zorblattjr and quuxwiki2\n", DENY)).toEqual([]);
  });

  test("an email address fails; a noreply address passes", () => {
    expect(rules(scanText("a.md", `mail ${EMAIL}\n`, DENY))).toEqual(["email"]);
    expect(scanText("a.md", `Co-Authored-By: X <noreply${"@"}anthropic.com>\n`, DENY)).toEqual([]);
    expect(scanText("a.md", `1+x${"@"}users.noreply.github.com\n`, DENY)).toEqual([]);
  });

  test("an npm scope is not an email", () => {
    expect(scanText("a.md", `npm i @${ORG}/repo-tools\n`, DENY)).toEqual([]);
  });

  test("a session URL fails in a tracked file", () => {
    expect(rules(scanText("notes.md", `${SESSION}\n`, DENY))).toEqual(["session-url"]);
  });
});

describe("attribution exemptions (person tokens only)", () => {
  test("LICENSE may hold the name; README may not", () => {
    const line = "Copyright (c) 2026 Zorblatt\n";
    expect(scanText("LICENSE", line, DENY)).toEqual([]);
    expect(rules(scanText("README.md", "Maintained by Zorblatt.\n", DENY))).toEqual(["denylist"]);
  });

  test("a copyright line in any file may hold the name", () => {
    expect(scanText("src/x.ts", "// Copyright 2026 Zorblatt\n", DENY)).toEqual([]);
  });

  test("a private token fails even in LICENSE and on a copyright line", () => {
    expect(rules(scanText("LICENSE", "Copyright quuxwiki\n", DENY))).toEqual(["denylist"]);
  });

  test("R11 the exemptions do not reach past their own lines", () => {
    expect(rules(scanText("README.md", "(c) ask zorblatt\n", DENY))).toEqual(["denylist"]);
    expect(rules(scanText("README.md", "see copyrightable zorblatt\n", DENY))).toEqual([
      "denylist",
    ]);
    expect(rules(scanText("docs/notice.md", "by zorblatt\n", DENY))).toEqual(["denylist"]);
    expect(scanText("README.md", "Copyright (c) 2026 Zorblatt\n", DENY)).toEqual([]);
    expect(scanText("README.md", "(c) 2026 Zorblatt\n", DENY)).toEqual([]);
    const pkg = `{\n  "author": "zorblatt",\n  "description": "private notes of zorblatt"\n}\n`;
    const found = scanText("package.json", pkg, DENY);
    expect(rules(found)).toEqual(["denylist"]);
    expect(found[0]?.line).toBe(3);
  });

  test("R11 a multi-line author object is exempt; a later field is not", () => {
    const pkg = `{\n  "author": {\n    "name": "Zorblatt",\n    "url": "x"\n  },\n  "name": "zorblatt"\n}\n`;
    expect(scanText("package.json", pkg, DENY).map((f) => f.line)).toEqual([6]);
  });

  test("the author and owner fields of a JSON manifest may hold the name", () => {
    const pkg = `{\n  "name": "x",\n  "author": "Zorblatt Q",\n  "owner": { "name": "Zorblatt" }\n}\n`;
    expect(scanText("package.json", pkg, DENY)).toEqual([]);
  });

  test("the same name in another JSON field fails", () => {
    const pkg = `{\n  "description": "made by zorblatt",\n  "author": "Zorblatt"\n}\n`;
    const found = scanText("package.json", pkg, DENY);
    expect(rules(found)).toEqual(["denylist"]);
    expect(found[0]?.line).toBe(2);
  });

  test("the org in a GitHub URL and in the npm scope passes; the bare org word fails", () => {
    expect(scanText("README.md", `https://github.com/${ORG}/repo-tools\n`, DENY)).toEqual([]);
    expect(scanText("README.md", `"name": "@${ORG}/repo-tools"\n`, DENY)).toEqual([]);
    expect(rules(scanText("README.md", `Ask ${ORG} about it.\n`, DENY))).toEqual(["denylist"]);
  });
});

describe("commit messages", () => {
  test("a session URL in a commit message fails", () => {
    expect(
      rules(scanCommitMessage("abc1234", `feat: x\n\nClaude-Session: ${SESSION}\n`, DENY)),
    ).toEqual(["session-url"]);
  });

  test("a commit message gets no attribution exemption", () => {
    expect(rules(scanCommitMessage("abc1234", "Copyright Zorblatt\n", DENY))).toEqual(["denylist"]);
  });

  test("the Dependabot sign-off trailer passes; another github.com address fails", () => {
    const signOff = `Signed-off-by: dependabot[bot] <support${"@"}github.com>\n`;
    expect(scanCommitMessage("abc1234", `chore(deps): bump x\n\n${signOff}`, DENY)).toEqual([]);
    expect(rules(scanText("a.md", `mail someone${"@"}github.com\n`, DENY))).toEqual(["email"]);
  });

  test("a normal message with a noreply trailer passes", () => {
    const msg = `feat: x\n\nCo-Authored-By: Claude <noreply${"@"}anthropic.com>\n`;
    expect(scanCommitMessage("abc1234", msg, DENY)).toEqual([]);
  });
});

describe("tracked binaries", () => {
  test("a tracked .exe fails", () => {
    expect(rules(scanTrackedFile("tools/a.EXE", 10))).toEqual(["binary"]);
  });
  test("a tracked file over 5 MB fails", () => {
    expect(rules(scanTrackedFile("big.bin", 5 * 1024 * 1024 + 1))).toEqual(["binary"]);
  });
  test("a small source file passes", () => {
    expect(scanTrackedFile("src/a.ts", 100)).toEqual([]);
  });
});

describe("reporting", () => {
  test("a report line never holds the matched value", () => {
    const text = [WIN_PATH, HOME_PATH, EMAIL, SESSION, "zorblatt"].join("\n");
    const found = scanText("README.md", `${text}\n`, DENY);
    expect(found.length).toBe(5);
    const report = found.map((f) => formatFinding(f, DENY)).join("\n");
    for (const plant of [WIN_PATH, HOME_PATH, EMAIL, SESSION, "someone", "zorblatt"]) {
      expect(report.toLowerCase()).not.toContain(plant.toLowerCase());
    }
  });
});

describe("self-test and the real repository", () => {
  test("the self-test fires every rule", () => {
    expect(selfTest()).toEqual([]);
  });

  test("this repository scans clean", async () => {
    const found = await runCheck(join(import.meta.dir, "../.."));
    expect(found.map((f) => formatFinding(f))).toEqual([]);
  });
});

describe("commit-msg hook mode", () => {
  const script = join(import.meta.dir, "../../scripts/privacy-check.ts");
  const runHook = async (message: string) => {
    const dir = makeTempDir("privacy-hook");
    const file = join(dir, "COMMIT_EDITMSG");
    await Bun.write(file, message);
    try {
      return Bun.spawnSync([process.execPath, script, "--commit-msg", file]).exitCode;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test("a message with a session URL is rejected", async () => {
    expect(await runHook(`feat: x\n\n${SESSION}\n`)).toBe(1);
  });

  test("a clean message is accepted", async () => {
    expect(await runHook("feat: x\n\nbody\n")).toBe(0);
  });

  test("R10 a '#' line is scanned too (cleanup modes can keep it)", async () => {
    expect(await runHook(`feat: x\n# ${SESSION}\n`)).toBe(1);
  });

  test("R10 the diff below the scissors line of 'git commit -v' is not scanned", async () => {
    const scissors = "# ------------------------ >8 ------------------------";
    expect(await runHook(`feat: x\n${scissors}\n+ ${EMAIL}\n`)).toBe(0);
  });
});

describe("review round 1: leaks that passed (regression tests)", () => {
  const U = "Users";
  const H = "home";
  test("R1 Git Bash, WSL, drive-less and unterminated home paths fail", () => {
    for (const text of [
      `cd /c/${U}/someone/Github`,
      `/mnt/c/${U}/someone/x`,
      `${SEP}${U}${SEP}someone${SEP}x`,
      `HOME=/${H}/someone`,
    ]) {
      expect(scanText("a.md", `${text}\n`, DENY).length).toBeGreaterThan(0);
    }
  });

  test("R1 a drive path reports one finding, not two", () => {
    expect(rules(scanText("a.md", `x c:/${U.toLowerCase()}/someone/y\n`, DENY))).toEqual([
      "windows-user-path",
    ]);
  });

  test("R5 the noreply allowance is anchored to the address", () => {
    expect(rules(scanText("a.md", `jane+noreply${"@"}yahoo.com\n`, DENY))).toEqual(["email"]);
    expect(rules(scanText("a.md", `noreply-team${"@"}example.net\n`, DENY))).toEqual(["email"]);
  });

  test("R6 a denylisted name joined to another word fails", () => {
    for (const text of [
      "zorblatt-q",
      "zorblatt_q",
      "ZorblattSmith",
      "smithZorblatt",
      "zorbl\u00e1tt",
      "zorb\u200blatt",
      "x-quuxwiki-2",
    ]) {
      expect(rules(scanText("README.md", `by ${text}\n`, DENY))).toEqual(["denylist"]);
    }
  });

  test("R14 commit messages get no org-mask exemption", () => {
    expect(rules(scanCommitMessage("abc", `https://github.com/${ORG}/x\n`, DENY))).toEqual([
      "denylist",
    ]);
  });

  test("R6 the org name as one word still does not split into a person token", () => {
    const deny: Denylist = new Map([[hashToken(`dan${"iel"}`), "person"]]);
    expect(scanText("README.md", `https://github.com/${ORG}/x and ${ORG}\n`, deny)).toEqual([]);
  });
});

describe("review round 1: collection reads git objects (regression tests)", () => {
  const git = (cwd: string, args: string[], stdin?: string) => {
    const r = Bun.spawnSync(["git", ...args], {
      cwd,
      stdin: stdin ? Buffer.from(stdin) : undefined,
    });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
    return r.stdout.toString().trim();
  };
  const makeRepo = () => {
    const dir = makeTempDir("privacy-repo");
    git(dir, ["init", "-q", "-b", "main"]);
    git(dir, ["config", "user.name", "t"]);
    git(dir, ["config", "user.email", `t${"@"}users.noreply.github.com`]);
    git(dir, ["config", "core.autocrlf", "false"]);
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "scripts/privacy-denylist.sha256"), "");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-q", "-m", "init"]);
    return dir;
  };
  const found = async (dir: string) => {
    try {
      return rules(await runCheck(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test("R2 text after an embedded record separator in a commit message is scanned", async () => {
    const dir = makeRepo();
    git(dir, ["commit", "-q", "--allow-empty", "-F", "-"], `fix\x1eleak ${SESSION}\n`);
    expect(await found(dir)).toContain("session-url");
  });

  test("R2 every commit is scanned", async () => {
    const dir = makeRepo();
    for (let i = 0; i < 3; i++) git(dir, ["commit", "-q", "--allow-empty", "-m", `c${i}`]);
    const { collect } = await import("../../scripts/privacy-check.ts");
    try {
      expect((await collect(dir)).commits).toBe(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("R3 a UTF-16 text file is decoded and scanned", async () => {
    const dir = makeRepo();
    const body = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(`mail ${EMAIL}\n`, "utf16le"),
    ]);
    writeFileSync(join(dir, "u16.txt"), body);
    git(dir, ["add", "u16.txt"]);
    expect(await found(dir)).toContain("email");
  });

  test("R3 printable text inside a file with NUL bytes is scanned", async () => {
    const dir = makeRepo();
    writeFileSync(
      join(dir, "blob.dat"),
      Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(` ${HOME_PATH} `)]),
    );
    git(dir, ["add", "blob.dat"]);
    expect(await found(dir)).toContain("posix-home-path");
  });

  test("R4 a symlink's committed target is scanned", async () => {
    const dir = makeRepo();
    const blob = git(dir, ["hash-object", "-w", "--stdin"], HOME_PATH);
    git(dir, ["update-index", "--add", "--cacheinfo", `120000,${blob},link`]);
    expect(await found(dir)).toContain("posix-home-path");
  });

  test("R4 the staged content is scanned, not the work tree", async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "a.md"), `${HOME_PATH}\n`);
    git(dir, ["add", "a.md"]);
    writeFileSync(join(dir, "a.md"), "clean now\n");
    expect(await found(dir)).toContain("posix-home-path");
  });
});

describe("review round 1: tools and reporting (regression tests)", () => {
  test("R7 the hash tool rejects a token the checker can never match", () => {
    const tool = join(import.meta.dir, "../../scripts/privacy-hash.ts");
    const run = (args: string[]) => Bun.spawnSync([process.execPath, tool, ...args]).exitCode;
    expect(run(["private", `jane${"."}doe`])).toBe(1);
    expect(run(["private", "good-token"])).toBe(0);
    const dir = makeTempDir("privacy-hash");
    try {
      writeFileSync(join(dir, "words.txt"), "person Two Words\n");
      expect(run(["--from", join(dir, "words.txt")])).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("R8 a finding in a tracked path never prints the path", () => {
    const f = { file: `notes/${EMAIL}.md`, line: 0, rule: "email" as const, pathId: 7 };
    const text = formatFinding(f, DENY);
    expect(text).not.toContain("someone");
    expect(text).toContain("tracked path #7");
  });

  test("R12 an empty denylist fails the check", () => {
    expect(() => assertDenylistFloor(new Map())).toThrow();
    expect(() => assertDenylistFloor(DENY)).not.toThrow();
  });

  test("R13 a malformed denylist line is reported by number, never by content", () => {
    let message = "";
    try {
      parseDenylist(`${"a".repeat(64)} person\nprivate secretname\n`);
    } catch (e) {
      message = String(e);
    }
    expect(message).toContain("line 2");
    expect(message).not.toContain("secretname");
  });

  test("R9 the commit-msg hook is committed as executable", () => {
    const r = Bun.spawnSync(["git", "ls-files", "-s", ".githooks/commit-msg"], {
      cwd: join(import.meta.dir, "../.."),
    });
    expect(r.stdout.toString().startsWith("100755")).toBe(true);
  });
});
