/**
 * `repo-tools check` (design section 15), end to end: the exit code and the text of each
 * outcome, with a real graph. The cases port `test_check.py` and `test_cli.py` of the Python
 * tool, then add the rules of the TypeScript port: the paths, the config file and the masking.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NO_VERIFICATION_MARKER } from "../../src/check/claims.ts";
import { main } from "../../src/cli.ts";
import { makeTempDir } from "./temp.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A new folder with the files `files` (paths relative to the base); returns the base. */
function tree(files: Record<string, string | Uint8Array>): string {
  const base = makeTempDir("check-cmd");
  made.push(base);
  for (const [rel, data] of Object.entries(files)) {
    const path = join(base, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  }
  return base;
}

/** Runs the CLI with captured output streams. */
async function cli(argv: string[]) {
  let out = "";
  let err = "";
  const code = await main(argv, {
    stdout: (s) => {
      out += s;
    },
    stderr: (s) => {
      err += s;
    },
  });
  return { code, out, err };
}

const TABLE = "| Claim | Value | Source |\n|---|---|---|\n";
/** A Verification section with the given `[claim, value]` rows. */
const verification = (...rows: [string, string][]): string =>
  `## Verification\n${TABLE}${rows.map(([c, v]) => `| ${c} | ${v} | file-inventory.json |`).join("\n")}\n`;

/** One source file, no package.json: totalFiles is 1. */
const ONE = { "repo/src/a.ts": "export const a = 1;\n" };
/** Two source files and no entry point: the graph build finds no root. */
const UMBRELLA = {
  "repo/src/a.ts": "export const a = 1;\n",
  "repo/src/b.ts": "export const b = 1;\n",
};
const PKG = '{"name": "demo", "version": "1.0.0", "main": "src/index.ts"}\n';

describe("repo-tools check: a document that matches", () => {
  test("exits 0, says so on standard output and writes nothing to standard error", async () => {
    const base = tree({ ...ONE, "repo/arch/OVERVIEW.md": verification(["totalFiles", "1"]) });
    const r = await cli(["check", join(base, "repo"), "--docs=arch"]);
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    expect(r.out).toBe("check passed: every claim matches the graph (1 claim in 1 document).\n");
  });

  test("the summary counts claims, documents and opt-outs", async () => {
    const base = tree({
      ...ONE,
      "repo/arch/A.md": verification(["totalFiles", "1"], ["totalSourceFiles", "1"]),
      "repo/arch/B.md": verification(["totalModules", "1"]),
      "repo/arch/GENERATED.md": `${NO_VERIFICATION_MARKER}\n# Generated\n`,
    });
    const r = await cli(["check", join(base, "repo"), "--docs=arch"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(
      "check passed: every claim matches the graph (3 claims in 2 documents; 1 document opted out).\n",
    );
  });

  test("--root=<path> sets the root as the positional argument does", async () => {
    const base = tree({ ...ONE, "repo/arch/OVERVIEW.md": verification(["totalFiles", "1"]) });
    const r = await cli(["check", `--root=${join(base, "repo")}`, "--docs=arch"]);
    expect(r.code).toBe(0);
  });

  test("a Markdown file is read whatever the letter case of its ending (no silent skip)", async () => {
    const base = tree({ ...ONE, "repo/arch/UPPER.MD": verification(["totalFiles", "9"]) });
    const r = await cli(["check", join(base, "repo"), "--docs=arch"]);
    expect(r.code).toBe(1);
    expect(r.err).toBe("UPPER.MD: totalFiles claims 9 but actual is 1\n");
  });

  test("a file that is not a Markdown file is not read", async () => {
    const base = tree({
      ...ONE,
      "repo/arch/OVERVIEW.md": verification(["totalFiles", "1"]),
      "repo/arch/notes.txt": "no claims here",
      "repo/arch/graph.json": "{}",
    });
    expect((await cli(["check", join(base, "repo"), "--docs=arch"])).code).toBe(0);
  });
});

describe("repo-tools check: drift", () => {
  test("exits 1 and names the document, the claim and both values", async () => {
    const base = tree({ ...ONE, "repo/arch/OVERVIEW.md": verification(["totalFiles", "99"]) });
    const r = await cli(["check", join(base, "repo"), "--docs=arch"]);
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toBe("OVERVIEW.md: totalFiles claims 99 but actual is 1\n");
  });

  test("the same drift under a mistitled heading is its own problem, not a pass", async () => {
    const mistitled = tree({
      ...ONE,
      "repo/arch/OVERVIEW.md": `## Current Metrics\n${TABLE}| totalFiles | 99 | file-inventory.json |\n`,
    });
    const r = await cli(["check", join(mistitled, "repo"), "--docs=arch"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("OVERVIEW.md: no '## Verification' section found");
    // The control: the correct heading gives the drift line instead.
    const titled = tree({ ...ONE, "repo/arch/OVERVIEW.md": verification(["totalFiles", "99"]) });
    const c = await cli(["check", join(titled, "repo"), "--docs=arch"]);
    expect(c.err).not.toContain("no '## Verification' section found");
    expect(c.err).toContain("totalFiles claims 99");
  });

  test("an unknown claim is reported, not skipped", async () => {
    const base = tree({ ...ONE, "repo/arch/OVERVIEW.md": verification(["notAThing", "3"]) });
    const r = await cli(["check", join(base, "repo"), "--docs=arch"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("unknown claim 'notAThing'");
  });

  test("an empty section and a missing section are two problems with two texts", async () => {
    const base = tree({
      ...ONE,
      "repo/arch/EMPTY.md": "## Verification\n\nNothing verifiable here yet.\n",
      "repo/arch/MISSING.md": "# Prose only\n",
    });
    const r = await cli(["check", join(base, "repo"), "--docs=arch"]);
    expect(r.code).toBe(1);
    const lines = r.err.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toStartWith("EMPTY.md: has a '## Verification' section but no parseable");
    expect(lines[1]).toStartWith("MISSING.md: no '## Verification' section found");
  });

  test("every problem of every document is reported, documents in code-unit order", async () => {
    const base = tree({
      ...ONE,
      "repo/arch/c.md": verification(["totalFiles", "2"]),
      "repo/arch/B.md": verification(["totalFiles", "3"]),
      "repo/arch/a.md": verification(["totalFiles", "4"]),
    });
    const r = await cli(["check", join(base, "repo"), "--docs=arch"]);
    // Code-unit order puts 'B' before 'a'. A locale order would put 'a' first.
    expect(r.err.trimEnd().split("\n")).toEqual([
      "B.md: totalFiles claims 3 but actual is 1",
      "a.md: totalFiles claims 4 but actual is 1",
      "c.md: totalFiles claims 2 but actual is 1",
    ]);
  });
});

describe("repo-tools check: a metric that the graph build declares unreliable", () => {
  const REACHABILITY = [
    "orphanedFiles",
    "reachableFiles",
    "dormantFiles",
    "testOnlyFiles",
    "entryRoots",
    "noImporterFileCount",
  ];

  test("each reachability metric is unverifiable when the build found no root", async () => {
    const base = tree({
      ...UMBRELLA,
      "repo/arch/OVERVIEW.md": verification(...REACHABILITY.map((n): [string, string] => [n, "0"])),
    });
    const r = await cli(["check", join(base, "repo"), "--docs=arch"]);
    expect(r.code).toBe(1);
    const lines = r.err.trimEnd().split("\n");
    expect(lines).toHaveLength(REACHABILITY.length);
    for (const name of REACHABILITY) {
      expect(lines.some((l) => l.includes(name) && l.includes("cannot be verified"))).toBe(true);
    }
  });

  test("a claim at the emitted value is not certified either", async () => {
    const base = tree({
      ...UMBRELLA,
      "repo/arch/OVERVIEW.md": verification(["orphanedFiles", "2"]),
    });
    const r = await cli(["check", join(base, "repo"), "--docs=arch"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("orphanedFiles");
    expect(r.err).toContain("cannot be verified");
    expect(r.err).not.toContain("claims 2 but actual is 2");
  });

  test("a file count still verifies despite the roots warning", async () => {
    const base = tree({ ...UMBRELLA, "repo/arch/OVERVIEW.md": verification(["totalFiles", "2"]) });
    expect((await cli(["check", join(base, "repo"), "--docs=arch"])).code).toBe(0);
  });

  test("a package-derivation warning alone does not taint a file count", async () => {
    // No package.json, but src/index.ts is a root, so only the inventory note is in the warnings.
    const base = tree({
      "repo/src/index.ts": "export const a = 1;\n",
      "repo/arch/OVERVIEW.md": verification(["totalFiles", "1"]),
    });
    expect((await cli(["check", join(base, "repo"), "--docs=arch"])).code).toBe(0);
  });
});

describe("repo-tools check: the opt-out marker", () => {
  test("a document with the marker is a clean pass", async () => {
    const base = tree({
      ...ONE,
      "repo/arch/README.md": `${NO_VERIFICATION_MARKER}\n# Just prose\n\nNo claims here.\n`,
    });
    expect((await cli(["check", join(base, "repo"), "--docs=arch"])).code).toBe(0);
  });

  test("the marker wins over a heading that only mentions verification", async () => {
    const base = tree({
      ...ONE,
      "repo/arch/GENERATED.md":
        `${NO_VERIFICATION_MARKER}\n# Generated\n\n## Verification of the SHA-384 manifest\n\n` +
        "| File | Imports | Type |\n|---|---|---|\n| `./a.js` | `B` | Import |\n",
    });
    const r = await cli(["check", join(base, "repo"), "--docs=arch"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
  });

  test("the verification marker of the config file opts out too", async () => {
    const base = tree({
      ...ONE,
      "repo/repo-tools.config.json": '{"map": {"verificationMarker": "<!-- skip-me -->"}}\n',
      "repo/arch/GENERATED.md": "<!-- skip-me -->\n# Generated\n",
    });
    const r = await cli(["check", join(base, "repo"), "--docs=arch"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
  });
});

describe("repo-tools check: where the documents are", () => {
  test("a relative --docs resolves against the root, not against the working folder", async () => {
    // The working folder of the test run is the folder of this repository, which has no
    // 'arch-docs-xyz' folder: only the root has.
    const base = tree({
      ...ONE,
      "repo/arch-docs-xyz/OVERVIEW.md": verification(["totalFiles", "1"]),
    });
    const r = await cli(["check", join(base, "repo"), "--docs=arch-docs-xyz"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
  });

  test("a root-relative --docs that starts with ../ leaves the root", async () => {
    const base = tree({ ...ONE, "outer-docs/OVERVIEW.md": verification(["totalFiles", "1"]) });
    const r = await cli(["check", join(base, "repo"), "--docs=../outer-docs"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
  });

  test("an absolute --docs is honoured as given", async () => {
    const base = tree({ ...ONE, "elsewhere/OVERVIEW.md": verification(["totalFiles", "1"]) });
    const r = await cli(["check", join(base, "repo"), `--docs=${join(base, "elsewhere")}`]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
  });

  test("an absolute --docs that holds drift does not put its path on standard error", async () => {
    const base = tree({ ...ONE, "elsewhere/OVERVIEW.md": verification(["totalFiles", "5"]) });
    const r = await cli(["check", join(base, "repo"), `--docs=${join(base, "elsewhere")}`]);
    expect(r.code).toBe(1);
    expect(r.err).toBe("OVERVIEW.md: totalFiles claims 5 but actual is 1\n");
  });

  test("a docs folder that does not exist is a failure, not a pass", async () => {
    const base = tree(ONE);
    const r = await cli(["check", join(base, "repo"), "--docs=nope"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("the docs folder <root>/nope does not exist or is not a folder");
  });

  test("an absolute docs folder that does not exist is shown as <docs>", async () => {
    const base = tree(ONE);
    const missing = join(base, "missing-docs");
    const r = await cli(["check", join(base, "repo"), `--docs=${missing}`]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("the docs folder <docs> does not exist");
    expect(r.err).not.toContain(missing);
  });

  test("a docs folder without a Markdown file is a failure, not a pass", async () => {
    const base = tree({ ...ONE, "repo/arch/graph.json": "{}" });
    const r = await cli(["check", join(base, "repo"), "--docs=arch"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("<root>/arch holds no *.md file");
  });

  test("a docs path that is a file is a failure", async () => {
    const base = tree({ ...ONE, "repo/arch": "a file" });
    const r = await cli(["check", join(base, "repo"), "--docs=arch"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("does not exist or is not a folder");
  });
});

describe("repo-tools check: a root or a document that cannot be read", () => {
  test("a root that does not exist exits 1 and does not show its path", async () => {
    const base = tree({ "repo/arch/OVERVIEW.md": verification(["totalFiles", "1"]) });
    const missing = join(base, "no-such-repo");
    const r = await cli(["check", missing, "--docs=arch"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("the root <root> is not an existing directory");
    expect(r.err).not.toContain(missing);
  });

  test("a repository with no source file exits 1", async () => {
    const base = tree({
      "repo/README.md": "nothing\n",
      "repo/arch/OVERVIEW.md": verification(["totalFiles", "0"]),
    });
    const r = await cli(["check", join(base, "repo"), "--docs=arch"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("no source file found");
  });

  test("a badly encoded document is a message and exit 1, not a stack trace", async () => {
    const base = tree({
      ...ONE,
      "repo/arch/BROKEN.md": new Uint8Array([0x23, 0x20, 0xc3, 0x28, 0x0a]),
    });
    const r = await cli(["check", join(base, "repo"), "--docs=arch"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("BROKEN.md");
    expect(r.err).toContain("not valid UTF-8");
    expect(r.err).not.toMatch(/\n\s+at /);
  });

  test("a document that is a folder named *.md is a message and exit 1", async () => {
    const base = tree({ ...ONE, "repo/arch/dir.md/x.txt": "x" });
    const r = await cli(["check", join(base, "repo"), "--docs=arch"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("dir.md");
    expect(r.err).not.toMatch(/\n\s+at /);
  });

  test("standard error never holds the absolute root", async () => {
    const base = tree({ ...ONE, "repo/arch/OVERVIEW.md": verification(["totalFiles", "9"]) });
    const root = join(base, "repo");
    const runs = [
      await cli(["check", root, "--docs=arch"]),
      await cli(["check", root, "--docs=missing"]),
      await cli(["check", root]),
      await cli(["check", root, "--docs=arch", "--nope"]),
    ];
    for (const r of runs) {
      expect(r.err).not.toContain(root);
      expect(r.err).not.toContain(root.replace(/\\/g, "/"));
    }
  });

  test("a run writes no file into the repository or the docs folder", async () => {
    const base = tree({ ...ONE, "repo/arch/OVERVIEW.md": verification(["totalFiles", "1"]) });
    const before = readdirSync(base, { recursive: true }).sort();
    await cli(["check", join(base, "repo"), "--docs=arch"]);
    expect(readdirSync(base, { recursive: true }).sort()).toEqual(before);
  });
});

describe("repo-tools check: the input files of the graph (D9)", () => {
  const DUP = {
    "repo/package.json": PKG,
    "repo/src/index.ts": 'export { a } from "./a.js";\n',
    "repo/src/a.ts": "export function a() { return 1; }\n",
    "repo/src/b.ts": "export function a() { return 2; }\n",
  };
  const ALLOW = JSON.stringify({
    entries: [{ names: ["a"], filesGlob: ["src/**"], reason: "accepted" }],
  });

  test("without an allowlist the duplicate is a TRUE_DUPLICATE", async () => {
    const base = tree({ ...DUP, "repo/arch/D.md": verification(["runtimeDuplicates", "1"]) });
    expect((await cli(["check", join(base, "repo"), "--docs=arch"])).code).toBe(0);
  });

  test("the allowlist at docs/architecture is read", async () => {
    const base = tree({
      ...DUP,
      "repo/docs/architecture/duplicate-allowlist.json": ALLOW,
      "repo/docs/architecture/D.md": verification(["runtimeDuplicates", "0"]),
    });
    const r = await cli(["check", join(base, "repo"), "--docs=docs/architecture"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
  });

  test("the allowlist is not read from the --docs folder", async () => {
    const base = tree({
      ...DUP,
      "repo/other/duplicate-allowlist.json": ALLOW,
      "repo/other/D.md": verification(["runtimeDuplicates", "1"]),
    });
    const r = await cli(["check", join(base, "repo"), "--docs=other"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
  });

  test("the config key map.duplicateAllowlist names the allowlist", async () => {
    const base = tree({
      ...DUP,
      "repo/policy/allow.json": ALLOW,
      "repo/repo-tools.config.json": '{"map": {"duplicateAllowlist": "policy/allow.json"}}\n',
      "repo/arch/D.md": verification(["runtimeDuplicates", "0"]),
    });
    const r = await cli(["check", join(base, "repo"), "--docs=arch"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
  });

  test("--config=<file> names another config file", async () => {
    const base = tree({
      ...DUP,
      "repo/policy/allow.json": ALLOW,
      "repo/ci.json": '{"map": {"duplicateAllowlist": "policy/allow.json"}}\n',
      "repo/arch/D.md": verification(["runtimeDuplicates", "0"]),
    });
    const r = await cli(["check", join(base, "repo"), "--docs=arch", "--config=ci.json"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
  });

  test("a config file with an unknown key exits 1", async () => {
    const base = tree({
      ...ONE,
      "repo/repo-tools.config.json": '{"map": {"nope": 1}}\n',
      "repo/arch/OVERVIEW.md": verification(["totalFiles", "1"]),
    });
    const r = await cli(["check", join(base, "repo"), "--docs=arch"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("unknown key 'map.nope'");
  });
});

describe("repo-tools check: the command line", () => {
  test("--docs is required", async () => {
    const base = tree(ONE);
    const r = await cli(["check", join(base, "repo")]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("flag --docs is required");
  });

  test.each([
    [["--docs"], "flag --docs needs a value"],
    [["--docs="], "flag --docs needs a value"],
    [["--docs=a", "--docs=b"], "flag --docs is set twice"],
    [["--docs=a", "--nope"], "unknown flag '--nope'"],
    [["--docs=a", "--strict-orphans"], "unknown flag '--strict-orphans'"],
    [["--docs=a", "--out=x"], "unknown flag '--out'"],
    [["--docs=a", "--config"], "flag --config needs a value"],
    [["--docs=a", "--config=/abs/x.json"], "holds an absolute path"],
    [["--docs=a", "other-root"], "the root is set twice"],
  ])("%p exits 1 with %p", async (flags, text) => {
    const base = tree(ONE);
    const r = await cli(["check", join(base, "repo"), ...flags]);
    expect(r.code).toBe(1);
    expect(r.err).toContain(text);
    expect(r.out).toBe("");
  });

  test("--help prints the help and exits 0", async () => {
    const r = await cli(["check", "--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("repo-tools check");
    expect(r.out).toContain("--docs=<dir>");
    expect(r.out).toContain(NO_VERIFICATION_MARKER);
    expect(r.err).toBe("");
  });

  test("the help names the exit codes and the paths rule", async () => {
    const r = await cli(["check", "-h"]);
    expect(r.out).toContain("Exit codes");
    expect(r.out).toContain("../");
  });
});
