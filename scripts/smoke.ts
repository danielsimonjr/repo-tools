/**
 * Smoke test (design 13.3) for one way to run the tool.
 *
 *   bun scripts/smoke.ts -- <command...>
 *
 * Examples: `-- bin/repo-tools-linux-x64`, `-- node dist/cli.js`, `-- bun dist/cli.js`.
 * The script runs every step and exits 1 when a step fails. The steps: `--version`, `--help`,
 * an unknown subcommand, the `chunk split` and `chunk merge` round trip (13.3 step 4), and a JSON
 * round trip through `compress` and `compress -d` (13.3 step 5), each in a temp folder.
 */
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
      ["depgraph", "chunk", "compress", "query"].every((s) => out.includes(s))
        ? undefined
        : "the help does not list depgraph, chunk, compress and query",
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

/** A JSON document whose values hold the letters of the key abbreviations. */
const ROUND_TRIP_INPUT = {
  projectName: "name items description",
  items: [
    { itemName: "n", itemCount: 3, description: "i d n" },
    { itemName: "nd", itemCount: 0, description: null },
  ],
  description: "a name",
};

/**
 * Design 13.3 step 5: `compress` then `compress -d` in a temp folder must give a JSON value that
 * is deep-equal to the input. Returns an error text or undefined.
 */
function jsonRoundTrip(command: string[]): string | undefined {
  const dir = mkdtempSync(join(tmpdir(), "repo-tools-smoke-"));
  try {
    const input = join(dir, "data.json");
    writeFileSync(input, `${JSON.stringify(ROUND_TRIP_INPUT, null, 2)}\n`);
    const compact = join(dir, "data.compact.json");
    const restored = join(dir, "restored.json");
    for (const args of [
      ["compress", input, "--no-stats"],
      ["compress", "-d", compact, "-o", restored, "--no-stats"],
    ]) {
      const r = Bun.spawnSync([...command, ...args]);
      if (r.exitCode !== 0) return `'${args.slice(0, 2).join(" ")}' exit ${r.exitCode}`;
    }
    if (!existsSync(restored)) return "no restored file";
    const value: unknown = JSON.parse(readFileSync(restored, "utf8"));
    return Bun.deepEquals(value, ROUND_TRIP_INPUT) ? undefined : "the restored value differs";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Checks that run a command more than once and check files. */
const FILE_STEPS: { name: string; run: (command: string[]) => string | undefined }[] = [
  { name: "chunk round trip", run: chunkRoundTrip },
  { name: "compress JSON round trip", run: jsonRoundTrip },
];

/** The number of checks that `smoke` runs. */
export const STEP_COUNT = STEPS.length + FILE_STEPS.length;

/** Runs every step against `command`. Returns the failure texts. */
export function smoke(command: string[]): string[] {
  const failures: string[] = [];
  for (const step of FILE_STEPS) {
    const problem = step.run(command);
    if (problem) failures.push(`${step.name}: ${problem}`);
  }
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
