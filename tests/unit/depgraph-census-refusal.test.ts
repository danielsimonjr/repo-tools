/**
 * `repo-tools map` checks the census before it writes a Verification value. The census counts the
 * tracked files only. A source file on disk that git does not track is a census gap: the written
 * counts would leave it out, and the docs would then fail the check. Map refuses while a gap
 * exists, unless `--census-ok` is given.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

const OVERVIEW = "docs/architecture/OVERVIEW.md";
const STALE_OVERVIEW = [
  "# Overview",
  "",
  "## Verification",
  "",
  "| Claim | Value | Source |",
  "|---|---|---|",
  "| totalSourceFiles | 999 | repo-tools map |",
  "",
].join("\n");

/** Runs git in `root`. A commit does not sign. */
function git(root: string, args: string[]): void {
  const result = spawnSync(
    "git",
    ["-c", "commit.gpgsign=false", "-c", "user.email=t@t", "-c", "user.name=Test", ...args],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
}

/**
 * A git work tree with one tracked source file and a stale Verification table. Each path in
 * `untracked` is a source file on disk that git does not track.
 */
function tree(untracked: string[]): string {
  const root = makeTree({
    "package.json": JSON.stringify({ name: "census", version: "1.0.0" }),
    "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
    [OVERVIEW]: STALE_OVERVIEW,
  });
  git(root, ["init"]);
  git(root, ["add", "package.json", "src/index.ts", OVERVIEW]);
  git(root, ["commit", "-m", "init"]);
  for (const rel of untracked) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), "/** Untracked. */\nexport const extra = 1;\n");
  }
  return root;
}

const overviewOf = (root: string): string => readFileSync(join(root, OVERVIEW), "utf8");

describe("map: a census gap refuses the write of the Verification values", () => {
  test("a gap without --census-ok exits 1, names the file, and writes nothing", async () => {
    const root = tree(["lib/extra.ts"]);
    const before = overviewOf(root);
    const run = await runDepgraph(root);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("lib/extra.ts");
    expect(run.stderr).toContain("--census-ok");
    expect(overviewOf(root)).toBe(before);
    expect(existsSync(join(root, "docs/architecture/dependency-graph.json"))).toBe(false);
  });

  test("a gap with --census-ok writes the values and says the counts exclude the file", async () => {
    const root = tree(["lib/extra.ts"]);
    const run = await runDepgraph(root, ["--census-ok"]);
    expect(run.code).toBe(0);
    expect(run.stderr).toContain("the counts exclude 1 untracked source file");
    expect(run.stderr).toContain("lib/extra.ts");
    expect(overviewOf(root)).not.toContain("| 999 |");
  });

  test("the refusal lists at most 20 gap files and says how many more", async () => {
    const names = Array.from({ length: 22 }, (_, i) => `lib/extra${i}.ts`);
    const run = await runDepgraph(tree(names));
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("and 2 more");
  });

  test("--strict-census with --census-ok is a usage error and writes nothing", async () => {
    const root = tree(["lib/extra.ts"]);
    const before = overviewOf(root);
    const run = await runDepgraph(root, ["--strict-census", "--census-ok"]);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("--strict-census and --census-ok cannot be used together");
    expect(overviewOf(root)).toBe(before);
  });

  test("no gap: the values are written as before, with no census message", async () => {
    const root = tree([]);
    const run = await runDepgraph(root);
    expect(run.code).toBe(0);
    expect(run.stderr).not.toContain("untracked");
    expect(overviewOf(root)).not.toContain("| 999 |");
  });
});
