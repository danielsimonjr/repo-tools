/**
 * Command-line dispatch for `repo-tools` (design section 3.1).
 *
 * This module parses the first argument, prints the global help and version,
 * and calls the subcommand entry. A subcommand module never imports this file.
 */
import pkg from "../package.json" with { type: "json" };
import { CHUNK_HELP, run as runChunk } from "./chunk/index.ts";
import { HELP as compressHelp, run as compressRun } from "./compress/index.ts";
import type { Io } from "./io-types.ts";

export type { Io } from "./io-types.ts";

/** One subcommand: its one-line summary, its help text and its entry. */
interface Subcommand {
  summary: string;
  help: string;
  /** Absent until the subcommand is built. */
  run?: (argv: string[], io: Io) => Promise<number>;
}

const REGISTRY = {
  depgraph: {
    summary: "Write the dependency graph and the architecture reports of a TypeScript tree.",
    help: "Usage: repo-tools depgraph [--root=<path>] [options]\n",
  },
  chunk: {
    summary: "Split a large file into chunks, merge the chunks back, or show changed chunks.",
    help: CHUNK_HELP,
    run: runChunk,
  },
  compress: {
    summary: "Write a compact copy of a file for a model context, or restore it.",
    help: compressHelp,
    run: compressRun,
  },
} satisfies Record<string, Subcommand>;

export type SubcommandName = keyof typeof REGISTRY;

/** The subcommand names, in help order. */
export const SUBCOMMANDS = Object.keys(REGISTRY) as readonly SubcommandName[];

function isSubcommand(name: string): name is SubcommandName {
  return Object.hasOwn(REGISTRY, name);
}

function usage(): string {
  const width = Math.max(...SUBCOMMANDS.map((n) => n.length));
  const rows = SUBCOMMANDS.map((n) => `  ${n.padEnd(width)}  ${REGISTRY[n].summary}`);
  return [
    "Usage: repo-tools <subcommand> [options]",
    "",
    "Subcommands:",
    ...rows,
    "",
    "Global options:",
    "  -h, --help  Show this help.",
    "  --version   Show the version.",
    "",
    "Run 'repo-tools <subcommand> --help' for the options of one subcommand.",
    "",
  ].join("\n");
}

/**
 * Runs the CLI and returns the process exit code.
 *
 * @param argv - The arguments after the program name.
 * @param io - Where to write normal output and error output.
 */
export async function main(argv: readonly string[], io: Io): Promise<number> {
  const [first, ...rest] = argv;
  if (first === undefined || first === "--help" || first === "-h") {
    io.stdout(usage());
    return 0;
  }
  if (first === "--version") {
    io.stdout(`${pkg.version}\n`);
    return 0;
  }
  if (!isSubcommand(first)) {
    io.stderr(`repo-tools: unknown subcommand or option '${first}'\n\n${usage()}`);
    return 1;
  }
  const sub: Subcommand = REGISTRY[first];
  if (rest.includes("--help") || rest.includes("-h")) {
    io.stdout(`repo-tools ${first}: ${sub.summary}\n\n${sub.help}`);
    return 0;
  }
  if (!sub.run) {
    io.stderr(`repo-tools ${first}: not implemented in this build\n`);
    return 1;
  }
  return sub.run(rest, io);
}
