/**
 * Rewrites the `repo-tools docs` goldens from the current code (run this in the commit of a named
 * change).
 *
 *   bun scripts/update-docs-goldens.ts
 *
 * For each fixture, the script copies the fixture to a temporary git repository and runs `docs
 * scan`, a dry-run `docs stub` and `docs stub --apply`. It writes `coverage.json`, `COVERAGE.md`,
 * the standard output and exit code of each run, and the text of every source file after the
 * apply. Review the diff: each hunk must belong to the change that the commit names.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { main as cli } from "../src/cli.ts";

/** The fixtures of the `docs` goldens, below `tests/fixtures/docs`. */
export const DOCS_GOLDEN_FIXTURES = ["mixed-repo"];

/** The folder of the reports, below the copy of the fixture. It is not a source folder. */
const OUT = "_out";

/** Runs `repo-tools` with `argv`; returns the exit code and the standard output. */
async function run(argv: string[]): Promise<string> {
  let out = "";
  const code = await cli(argv, {
    stdout: (s) => {
      out += s;
    },
    stderr: (s) => {
      out += s;
    },
  });
  return `exit ${code}\n${out}`;
}

/** The POSIX relative path of every file below `dir`, sorted, without the report folder. */
function filesBelow(dir: string, base = dir): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = relative(base, path).replace(/\\/g, "/");
    if (rel === OUT || rel === ".git") continue;
    if (statSync(path).isDirectory()) found.push(...filesBelow(path, base));
    else found.push(rel);
  }
  return found.sort();
}

/**
 * Runs the three `docs` actions on a copy of `fixture` and returns each golden file by name.
 * `sources/<path>` holds the text of each source file after `stub --apply`. The temporary root is
 * replaced by `<root>` in every text, so the result does not depend on the machine.
 */
export async function docsGolden(fixture: string): Promise<Record<string, string>> {
  const work = mkdtempSync(join(tmpdir(), "repo-tools-docs-goldens-"));
  try {
    const root = join(work, fixture);
    cpSync(join(import.meta.dir, "../tests/fixtures/docs", fixture), root, { recursive: true });
    for (const args of [
      ["init", "-q", "--template="],
      ["add", "-A"],
    ]) {
      const git = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      if (git.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${git.stderr}`);
    }
    const mask = (text: string): string =>
      text.split(root).join("<root>").split(root.replace(/\\/g, "/")).join("<root>");
    const golden: Record<string, string> = {};
    golden["_scan.txt"] = mask(await run(["docs", "scan", root, `--out=${join(root, OUT)}`]));
    golden["coverage.json"] = mask(readFileSync(join(root, OUT, "coverage.json"), "utf8"));
    golden["COVERAGE.md"] = mask(readFileSync(join(root, OUT, "COVERAGE.md"), "utf8"));
    golden["_stub-dry.txt"] = mask(await run(["docs", "stub", root]));
    golden["_stub-apply.txt"] = mask(await run(["docs", "stub", root, "--apply"]));
    for (const rel of filesBelow(root)) {
      golden[`sources/${rel}`] = readFileSync(join(root, rel), "utf8");
    }
    return golden;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  for (const fixture of DOCS_GOLDEN_FIXTURES) {
    const dest = join(import.meta.dir, "../tests/golden/docs", fixture);
    rmSync(dest, { recursive: true, force: true });
    for (const [name, text] of Object.entries(await docsGolden(fixture))) {
      const path = join(dest, name);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, text);
    }
    process.stdout.write(`wrote tests/golden/docs/${fixture}\n`);
  }
}

if (import.meta.main) await main();
