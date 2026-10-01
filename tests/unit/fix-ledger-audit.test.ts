/**
 * The fix-ledger audit (`scripts/fix-ledger-audit.ts`): the pure parts of the runner, the
 * catalog against the real sources and the ledger, and one small end-to-end run on a toy repo.
 * The audit itself, which runs the whole suite once per fix, is not part of the test suite.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type AuditRow,
  applyEdit,
  assertParses,
  auditMutations,
  compareFix,
  copyRepository,
  decide,
  type Mutation,
  ownTests,
  parseLedger,
  parseTestOutput,
  renderReport,
  type StageResult,
} from "../../scripts/fix-ledger-audit.ts";
import { MUTATIONS } from "../../scripts/fix-ledger-mutations.ts";
import { makeTempDir } from "./temp.ts";

const root = join(import.meta.dir, "../..");
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

describe("applyEdit", () => {
  const edit = { file: "a.ts", find: "return 1;", replace: "return 2;" };

  test("replaces the one place where the anchor occurs", () => {
    expect(applyEdit("function f() { return 1; }", edit)).toBe("function f() { return 2; }");
  });

  test("refuses an anchor that is missing: a stale catalog must fail, not pass", () => {
    expect(() => applyEdit("function f() { return 3; }", edit)).toThrow(/not found/);
  });

  test("refuses an anchor that occurs twice: the place would be a guess", () => {
    expect(() => applyEdit("return 1; return 1;", edit)).toThrow(/2 times/);
  });

  test("refuses an empty anchor and a replacement that changes nothing", () => {
    expect(() => applyEdit("x", { ...edit, find: "" })).toThrow(/empty/);
    expect(() => applyEdit("return 1;", { ...edit, replace: "return 1;" })).toThrow(/no change/);
  });

  test("keeps a dollar sign in the replacement as written", () => {
    const out = applyEdit("const a = X;", { file: "a.ts", find: "X", replace: "$& and $1" });
    expect(out).toBe("const a = $& and $1;");
  });
});

describe("parseTestOutput", () => {
  const text = [
    "bun test v1.4.2",
    "(pass) a > one [1.00ms]",
    "(fail) a > two [0.50ms]",
    "(fail) b > three: with colon [12.30ms]",
    "(skip) c > four",
    " 1 pass",
    " 1 skip",
    " 2 fail",
    "Ran 4 tests across 3 files. [9.04s]",
  ].join("\n");

  test("reads the counts and the failing test names without the timing", () => {
    expect(parseTestOutput(text)).toEqual({
      pass: 1,
      fail: 2,
      skip: 1,
      failed: ["a > two", "b > three: with colon"],
      timeouts: [],
    });
  });

  test("reads an output without any summary as zero counts", () => {
    expect(parseTestOutput("error: Cannot find module './x.ts'")).toEqual({
      pass: 0,
      fail: 0,
      skip: 0,
      failed: [],
      timeouts: [],
    });
  });

  test("marks a failing test that ended at its time limit", () => {
    const slow = [
      "(fail) a > slow [5426.75ms]",
      "  ^ this test timed out after 5000ms.",
      "(fail) a > wrong [0.50ms]",
      "(fail) (unnamed) [6013.44ms]",
      "  ^ this test timed out after 5000ms.",
    ].join("\n");
    const summary = parseTestOutput(slow);
    expect(summary.failed).toEqual(["a > slow", "a > wrong", "(unnamed)"]);
    expect(summary.timeouts).toEqual(["a > slow", "(unnamed)"]);
  });
});

describe("decide", () => {
  const ran = (exitCode: number, failed: string[] = [], timeouts: string[] = []): StageResult => ({
    exitCode,
    timedOut: false,
    summary: { pass: 5, fail: failed.length, skip: 0, failed, timeouts },
  });

  test("the own test fails: caught by its own test, and the full suite is not needed", () => {
    expect(decide(ran(1, ["f > t"]), null)).toEqual({
      verdict: "caught-by-own",
      failing: ["f > t"],
    });
  });

  test("the own test passes and the full suite fails: caught elsewhere", () => {
    expect(decide(ran(0), ran(1, ["g > u"]))).toEqual({
      verdict: "caught-elsewhere",
      failing: ["g > u"],
    });
  });

  test("both pass: uncaught", () => {
    expect(decide(ran(0), ran(0))).toEqual({ verdict: "uncaught", failing: [] });
  });

  test("a fix with no own test goes straight to the full suite", () => {
    expect(decide(null, ran(0)).verdict).toBe("uncaught");
    expect(decide(null, ran(1, ["g > u"])).verdict).toBe("caught-elsewhere");
  });

  test("a run that fails with no failing test is an error, never a catch", () => {
    const r = decide(ran(1), null);
    expect(r.verdict).toBe("error");
    expect(r.reason).toMatch(/no failing test/);
  });

  test("a run in which only tests fail at their time limit is an error, never a catch", () => {
    const loaded = decide(ran(1, ["f > t"], ["f > t"]), null);
    expect(loaded.verdict).toBe("error");
    expect(loaded.reason).toMatch(/time-limit/);
    // The same holds for the full suite.
    expect(decide(ran(0), ran(1, ["g > u"], ["g > u"])).verdict).toBe("error");
    // A real failure beside a time-limit failure is still a catch.
    expect(decide(ran(1, ["f > t", "f > w"], ["f > t"]), null).verdict).toBe("caught-by-own");
  });

  test("a time-out is an error, never a catch", () => {
    const r = decide({ ...ran(1), timedOut: true }, null);
    expect(r).toMatchObject({ verdict: "error" });
    expect(r.reason).toMatch(/time-out/);
  });

  test("the own test passes and no full run exists: the caller must run the full suite", () => {
    expect(() => decide(ran(0), null)).toThrow(/full suite/);
  });
});

describe("ownTests", () => {
  test("a fix id maps to its test file", () => {
    expect(ownTests("F22")).toEqual(["tests/unit/depgraph-f22.test.ts"]);
    expect(ownTests("M1")).toEqual(["tests/unit/depgraph-m1.test.ts"]);
    expect(ownTests("R1")).toEqual(["tests/unit/depgraph-r1.test.ts"]);
  });
});

describe("renderReport", () => {
  const rows: AuditRow[] = [
    { fix: "F1", defect: "A date stamp is back.", verdict: "caught-by-own", failing: ["a > b"] },
    { fix: "F2", defect: "Order follows readdir.", verdict: "uncaught", failing: [] },
    { fix: "F3", defect: "No banner.", verdict: "error", failing: [], reason: "time-out" },
  ];

  test("lists every fix, the verdict and the first failing test, and counts the verdicts", () => {
    const md = renderReport([...rows], ["F13"]);
    expect(md).toContain("| F1 | A date stamp is back. | caught by its own test | `a > b` |");
    expect(md).toContain("| F2 | Order follows readdir. | UNCAUGHT | none |");
    expect(md).toContain("| F3 | No banner. | ERROR: time-out | none |");
    expect(md).toContain("1 caught by its own test");
    expect(md).toContain("1 uncaught");
    expect(md).toContain("1 error");
    expect(md).toContain("F13");
  });

  test("the report ends with one line feed and holds no date", () => {
    const md = renderReport([...rows], []);
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
    expect(md).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("the ledger and the catalog", () => {
  const ledger = parseLedger(readFileSync(join(root, "docs/fix-ledger-2.0.0.md"), "utf8"));

  test("the ledger parser finds every fix as locked, and none as without a 2.0.0 meaning", () => {
    expect(ledger.locked).toContain("F1");
    expect(ledger.locked).toContain("F37");
    expect(ledger.locked).toContain("M1");
    expect(ledger.locked).toContain("R1");
    for (const id of ["F13", "F36", "F41", "F44"]) expect(ledger.locked).toContain(id);
    expect(ledger.notApplicable).toEqual([]);
  });

  test("the catalog has at least one mutation for each locked fix, and none for another id", () => {
    const ids = [...new Set(MUTATIONS.map((m) => m.fix))].sort(compareFix);
    expect(ids).toEqual([...ledger.locked].sort(compareFix));
  });

  test("no two mutations of one fix bring back the same defect", () => {
    const keys = MUTATIONS.map((m) => `${m.fix} ${m.defect}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("every mutation names the defect it brings back", () => {
    for (const m of MUTATIONS) expect(m.defect.trim().length).toBeGreaterThan(10);
  });

  test("every edit still applies to the real sources and keeps the file parsable", () => {
    for (const m of MUTATIONS) {
      const byFile = new Map<string, string>();
      for (const edit of m.edits) {
        const text = byFile.get(edit.file) ?? readFileSync(join(root, edit.file), "utf8");
        byFile.set(edit.file, applyEdit(text, edit));
      }
      for (const [file, text] of byFile) {
        expect(() => assertParses(file, text), `${m.fix}: ${file}`).not.toThrow();
      }
    }
  });
});

describe("copyRepository", () => {
  const git = (cwd: string, ...args: string[]): string => {
    const run = Bun.spawnSync(
      ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...args],
      { cwd },
    );
    if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`);
    return run.stdout.toString();
  };

  test("a git copy holds the history and the index, and the uncommitted work of the source", () => {
    const repo = makeTempDir("ledger-src");
    made.push(repo);
    git(repo, "init", "-q");
    writeFileSync(join(repo, "keep.txt"), "committed\n");
    writeFileSync(join(repo, "edit.txt"), "before\n");
    writeFileSync(join(repo, "gone.txt"), "to delete\n");
    writeFileSync(join(repo, "run.sh"), "#!/bin/sh\n");
    git(repo, "add", "-A");
    git(repo, "update-index", "--chmod=+x", "run.sh");
    git(repo, "commit", "-q", "-m", "first");
    // Uncommitted work: an edit, a deletion, a staged new file and an untracked file.
    writeFileSync(join(repo, "edit.txt"), "after\n");
    rmSync(join(repo, "gone.txt"));
    writeFileSync(join(repo, "staged.txt"), "staged\n");
    git(repo, "add", "staged.txt");
    writeFileSync(join(repo, "loose.txt"), "untracked\n");
    writeFileSync(join(repo, ".gitignore"), "ignored.txt\n");
    writeFileSync(join(repo, "ignored.txt"), "ignored\n");

    const dest = join(makeTempDir("ledger-dst"), "copy");
    made.push(dirname(dest));
    copyRepository(repo, dest, true);

    const read = (name: string): string => readFileSync(join(dest, name), "utf8");
    expect(read("keep.txt")).toBe("committed\n");
    expect(read("edit.txt")).toBe("after\n");
    expect(existsSync(join(dest, "gone.txt"))).toBe(false);
    expect(read("staged.txt")).toBe("staged\n");
    expect(read("loose.txt")).toBe("untracked\n");
    expect(existsSync(join(dest, "ignored.txt"))).toBe(false);
    // The copy is a repository with the history and the file mode of the source.
    expect(git(dest, "log", "--format=%s").trim()).toBe("first");
    expect(git(dest, "ls-files", "-s", "run.sh")).toMatch(/^100755 /);
    // The source is not changed: the same files, the same edits.
    expect(readFileSync(join(repo, "edit.txt"), "utf8")).toBe("after\n");
    expect(git(repo, "log", "--format=%s").trim()).toBe("first");
  }, 60_000);

  test("refuses a destination that exists: the audit never writes over a folder", () => {
    const dest = makeTempDir("ledger-dst2");
    made.push(dest);
    expect(() => copyRepository(root, dest, false)).toThrow(/already exists/);
  });
});

describe("auditMutations on a toy repository", () => {
  /** A toy repository: `src/a.ts` holds three functions, each with its own mutation. */
  function toy(): string {
    const dir = makeTempDir("ledger-audit");
    made.push(dir);
    const files: Record<string, string> = {
      "package.json": '{"name": "toy", "type": "module"}\n',
      "bunfig.toml": '[test]\nroot = "./tests/unit"\n',
      "src/a.ts": [
        "export const one = (): number => 1;",
        "export const two = (): number => 2;",
        "export const three = (): number => 3;",
        "export const four = (): number => 4;",
        "",
      ].join("\n"),
      "tests/unit/depgraph-f1.test.ts": [
        'import { expect, test } from "bun:test";',
        'import { one } from "../../src/a.ts";',
        "test('one', () => expect(one()).toBe(1));",
        "",
      ].join("\n"),
      "tests/unit/other.test.ts": [
        'import { expect, test } from "bun:test";',
        'import { two } from "../../src/a.ts";',
        "test('two', () => expect(two()).toBe(2));",
        "",
      ].join("\n"),
    };
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    }
    return dir;
  }

  const edit = (find: string, replace: string) => ({ file: "src/a.ts", find, replace });
  const mutations: Mutation[] = [
    { fix: "F1", defect: "one returns zero again", edits: [edit("=> 1;", "=> 0;")] },
    { fix: "F2", defect: "two returns zero again", edits: [edit("=> 2;", "=> 0;")], own: [] },
    { fix: "F3", defect: "three returns zero again", edits: [edit("=> 3;", "=> 0;")], own: [] },
    {
      fix: "F4",
      defect: "an anchor that does not exist",
      edits: [edit("=> 99;", "=> 0;")],
      own: [],
    },
  ];

  test("tells a caught fix, a fix caught elsewhere, an uncaught fix and a stale anchor apart", async () => {
    const repo = toy();
    const scratch = makeTempDir("ledger-scratch");
    made.push(scratch);
    const results = await auditMutations(repo, mutations, {
      scratch,
      jobs: 2,
      timeoutMs: 120_000,
      log: () => {},
      useGit: false,
    });
    const by = Object.fromEntries(results.map((r) => [r.fix, r]));
    expect(by.F1?.verdict).toBe("caught-by-own");
    expect(by.F2?.verdict).toBe("caught-elsewhere");
    expect(by.F3?.verdict).toBe("uncaught");
    expect(by.F4?.verdict).toBe("error");
    expect(by.F4?.reason).toMatch(/not found/);
    // The source of the toy repository is unchanged: the audit works on a copy.
    expect(readFileSync(join(repo, "src/a.ts"), "utf8")).toContain("one = (): number => 1;");
  }, 180_000);

  test("the control: a mutation that changes nothing visible is uncaught, so a pass is not free", async () => {
    const repo = toy();
    const scratch = makeTempDir("ledger-scratch");
    made.push(scratch);
    const control: Mutation[] = [
      {
        fix: "F1",
        defect: "a comment only changes",
        edits: [edit("export const four", "// c\nexport const four")],
      },
    ];
    const [r] = await auditMutations(repo, control, {
      scratch,
      jobs: 1,
      timeoutMs: 120_000,
      log: () => {},
      useGit: false,
    });
    expect(r?.verdict).toBe("uncaught");
  }, 180_000);
});
