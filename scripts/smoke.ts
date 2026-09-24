/**
 * Smoke test (design 13.3) for one way to run the tool.
 *
 *   bun scripts/smoke.ts -- <command...>
 *
 * Examples: `-- bin/repo-tools-linux-x64`, `-- node dist/cli.js`, `-- bun dist/cli.js`.
 * The script runs each step, then the chunk round trip (13.3 step 4), and exits 1 on any failure.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };

interface Step {
  name: string;
  args: string[];
  exit: number;
  /** Optional check of standard output; returns an error text or undefined. */
  check?: (stdout: string) => string | undefined;
}

const STEPS: Step[] = [
  {
    name: "--version",
    args: ["--version"],
    exit: 0,
    check: (out) =>
      out === `${pkg.version}\n`
        ? undefined
        : `expected ${pkg.version}, got ${JSON.stringify(out)}`,
  },
  {
    name: "--help",
    args: ["--help"],
    exit: 0,
    check: (out) =>
      ["depgraph", "chunk", "compress"].every((s) => out.includes(s))
        ? undefined
        : "the help does not list depgraph, chunk and compress",
  },
  { name: "unknown subcommand", args: ["frobnicate"], exit: 1 },
];

const CHUNK_FIXTURE = join(import.meta.dir, "../tests/fixtures/chunk/guide.md");

/**
 * Design 13.3 step 4: `chunk split` and then `chunk merge` on a copy of a Markdown fixture in a
 * temporary folder. The merged file must equal the input byte for byte. Returns an error text or
 * undefined.
 */
function chunkRoundTrip(command: string[]): string | undefined {
  const dir = mkdtempSync(join(tmpdir(), "repo-tools-smoke-"));
  try {
    const file = join(dir, "guide.md");
    copyFileSync(CHUNK_FIXTURE, file);
    const split = Bun.spawnSync([...command, "chunk", "split", file]);
    if (split.exitCode !== 0) return `split: exit ${split.exitCode}`;
    const manifest = join(dir, "guide_chunks", "manifest.json");
    // Delete the copy, so only a real merge of the chunks can make the file again.
    rmSync(file);
    const merge = Bun.spawnSync([...command, "chunk", "merge", manifest]);
    if (merge.exitCode !== 0) return `merge: exit ${merge.exitCode}`;
    return readFileSync(file).equals(readFileSync(CHUNK_FIXTURE))
      ? undefined
      : "the merged file differs from the input";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The number of checks that `smoke` runs. */
export const STEP_COUNT = STEPS.length + 1;

/** Runs every step against `command`. Returns the failure texts. */
export function smoke(command: string[]): string[] {
  const failures: string[] = [];
  for (const step of STEPS) {
    const r = Bun.spawnSync([...command, ...step.args]);
    const out = r.stdout.toString();
    if (r.exitCode !== step.exit) {
      failures.push(`${step.name}: exit ${r.exitCode}, expected ${step.exit}`);
      continue;
    }
    const problem = step.check?.(out);
    if (problem) failures.push(`${step.name}: ${problem}`);
  }
  const roundTrip = chunkRoundTrip(command);
  if (roundTrip) failures.push(`chunk round trip: ${roundTrip}`);
  return failures;
}

if (import.meta.main) {
  // Bun can drop a leading "--" from argv, so accept the command with or without it.
  const args = process.argv.slice(2);
  const command = args[0] === "--" ? args.slice(1) : args;
  if (command.length === 0) {
    console.error("usage: smoke.ts -- <command...>");
    process.exit(1);
  }
  const failures = smoke(command);
  for (const f of failures) console.error(`smoke FAILED: ${f}`);
  if (failures.length === 0) console.log(`smoke passed: ${STEP_COUNT} steps.`);
  process.exitCode = failures.length > 0 ? 1 : 0;
}
