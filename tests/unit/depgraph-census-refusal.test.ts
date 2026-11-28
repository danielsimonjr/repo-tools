/**
 * `repo-tools map` checks the census before it writes a Verification value. The census counts the
 * tracked files only. A source file on disk that git does not track is a census gap: the written
 * counts would leave it out, and the docs would then fail the check. Map refuses while a gap
 * exists, unless `--census-ok` is given.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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
function tree(untracked: string[], tracked: Record<string, string> = {}): string {
  const root = makeTree({
    "package.json": JSON.stringify({ name: "census", version: "1.0.0" }),
    "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
    [OVERVIEW]: STALE_OVERVIEW,
    ...tracked,
  });
  git(root, ["init"]);
  git(root, ["add", "package.json", "src/index.ts", OVERVIEW, ...Object.keys(tracked)]);
  git(root, ["commit", "-m", "init"]);
  for (const rel of untracked) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), "/** Untracked. */\nexport const extra = 1;\n");
  }
  return root;
}

const overviewOf = (root: string): string => readFileSync(join(root, OVERVIEW), "utf8");

/** Every file under `dir` (relative path and bytes), or null when `dir` does not exist. */
function snapshot(dir: string): Record<string, string> | null {
  if (!existsSync(dir)) return null;
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    out[relative(dir, path)] = readFileSync(path).toString("base64");
  }
  return out;
}

const DOCS = "docs/architecture";

describe("map: a census gap refuses the write of the Verification values", () => {
  test("a gap without --census-ok exits 1, names the file, and writes nothing", async () => {
    const root = tree(["lib/extra.ts"]);
    const before = snapshot(join(root, DOCS));
    const run = await runDepgraph(root);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("lib/extra.ts");
    expect(run.stderr).toContain("--census-ok");
    expect(snapshot(join(root, DOCS))).toEqual(before);
  });

  test("a gap with a missing output folder leaves the folder missing", async () => {
    const root = tree(["lib/extra.ts"]);
    const run = await runDepgraph(root, ["--out=out/arch"]);
    expect(run.code).toBe(1);
    expect(existsSync(join(root, "out"))).toBe(false);
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
    const listed = run.stderr.split("\n").filter((l) => l.startsWith("  - "));
    expect(listed).toHaveLength(20);
    // Code-unit order puts extra8 and extra9 last.
    expect(listed).not.toContain("  - lib/extra8.ts");
    expect(listed).not.toContain("  - lib/extra9.ts");
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

  test("--strict-census with --census-ok is a usage error with --check-census too", async () => {
    const run = await runDepgraph(tree([]), ["--check-census", "--strict-census", "--census-ok"]);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("--strict-census and --census-ok cannot be used together");
  });

  test("--strict-orphans with an orphan does not print census passed", async () => {
    const root = tree([], { "src/lonely.ts": "/** Lonely. */\nexport const lonely = 1;\n" });
    const run = await runDepgraph(root, ["--strict-orphans"]);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("--strict-orphans");
    expect(run.stdout).not.toContain("census passed");
  });

  test("a regenerating --check-duplicates run refuses on a gap; --census-ok lets it run", async () => {
    const root = tree(["lib/extra.ts"]);
    expect((await runDepgraph(root, ["--census-ok"])).code).toBe(0);
    expect((await runDepgraph(root, ["--write-duplicate-baseline"])).code).toBe(0);
    const refused = await runDepgraph(root, ["--check-duplicates"]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("census FAILED");
    const allowed = await runDepgraph(root, ["--check-duplicates", "--census-ok"]);
    expect(allowed.code).toBe(0);
    expect(allowed.stderr).not.toContain("census FAILED");
  }, 30_000);

  test("an ignored folder with source files is not a gap", async () => {
    const root = tree(["gen/out.js", "gen/types.d.ts"], { ".gitignore": "gen/\n" });
    const run = await runDepgraph(root);
    expect(run.code).toBe(0);
    expect(run.stderr).not.toContain("census FAILED");
    expect(overviewOf(root)).not.toContain("| 999 |");
  });

  test("an untracked, not-ignored source file next to an ignored folder is a gap", async () => {
    const root = tree(["gen/out.js", "lib/extra.ts"], { ".gitignore": "gen/\n" });
    const run = await runDepgraph(root);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("lib/extra.ts");
    expect(run.stderr).not.toContain("gen/out.js");
  });

  test("a nested git repository with a source file is not a gap", async () => {
    const root = tree([]);
    const nested = join(root, "vendor/other");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "mod.ts"), "/** Nested. */\nexport const n = 1;\n");
    git(nested, ["init"]);
    git(nested, ["add", "mod.ts"]);
    git(nested, ["commit", "-m", "nested"]);
    const run = await runDepgraph(root);
    expect(run.code).toBe(0);
    expect(run.stderr).not.toContain("census FAILED");
  }, 30_000);

  test("no gap: the values are written as before, with no census message", async () => {
    const root = tree([]);
    const run = await runDepgraph(root);
    expect(run.code).toBe(0);
    expect(run.stderr).not.toContain("untracked");
    expect(overviewOf(root)).not.toContain("| 999 |");
  });
});
