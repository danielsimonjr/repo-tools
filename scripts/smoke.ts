/**
 * Smoke test (design 13.3) for one way to run the tool.
 *
 *   bun scripts/smoke.ts -- <command...>
 *
 * Examples: `-- bin/repo-tools-linux-x64`, `-- node dist/cli.js`, `-- bun dist/cli.js`.
 * The script runs each step that exists in this build and exits 1 on the first failure.
 */
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
  if (failures.length === 0) console.log(`smoke passed: ${STEPS.length} steps.`);
  process.exitCode = failures.length > 0 ? 1 : 0;
}
