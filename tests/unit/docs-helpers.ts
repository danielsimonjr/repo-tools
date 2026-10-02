/**
 * Test helper for the `docs` tests: a file tree in a temporary folder, a git repository on top of
 * it, and a CLI runner that captures both output streams.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { main } from "../../src/cli.ts";
import { makeTempDir } from "./temp.ts";

/** The temporary folders that `tree` made since the last `removeTrees`. */
const made: string[] = [];

/** The single item of `items`. It throws when `items` has any other length. */
export function only<T>(items: readonly T[]): T {
  const [first] = items;
  if (items.length !== 1 || first === undefined) {
    throw new Error(`expected one item, got ${items.length}`);
  }
  return first;
}

/** Writes `files` (POSIX relative path to content) under a new folder; returns the folder. */
export function tree(files: Record<string, string | Uint8Array>): string {
  const base = makeTempDir("docs");
  made.push(base);
  for (const [rel, data] of Object.entries(files)) {
    const path = join(base, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  }
  return base;
}

/** Removes every folder that `tree` made. Call it from `afterAll`. */
export function removeTrees(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Runs git in `cwd` with a fixed identity. It throws when git fails. */
export function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

/**
 * Makes `root` a git repository that tracks every file. `git ls-files` reads the index, so the
 * helper does not commit. The empty template leaves out the sample hooks, which cuts the files of
 * each repository from 18 to 2. A test run makes dozens of repositories, and the process starts and
 * the removal of the many small files were slower than the hook limit.
 */
export function trackAll(root: string): void {
  git(root, "init", "-q", "--template=");
  git(root, "add", "-A");
}

/** The result of one CLI run. */
export interface CliRun {
  code: number;
  out: string;
  err: string;
}

/** Runs `repo-tools` with `argv` and captures the exit code and both streams. */
export async function cli(argv: string[]): Promise<CliRun> {
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

/** The text of the file `rel` under `root`. */
export function read(root: string, rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}
