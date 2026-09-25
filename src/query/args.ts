/**
 * The command line of `repo-tools query` (design section 3.5).
 *
 * The parser is strict. An unknown command or flag, a missing or extra argument, a flag without
 * its value, a value on a flag that takes none, and two commands in one run each throw an error;
 * the run then exits 1. An error text names the flag, never the path value, so no path of the
 * user goes to standard error.
 */
import { ABSOLUTE_PATH_TEXT, isAbsolutePath } from "../config.ts";

/** The command of one run: a query that prints an answer, or a mode. */
export type QueryCommand =
  | { name: "dependents"; file: string }
  | { name: "symbol-users"; symbol: string }
  | { name: "is-public"; pkg: string; symbol: string }
  | { name: "node-safety"; pkg?: string }
  | { name: "cycles" }
  | { name: "emit" }
  | { name: "check-browser-safety" };

/** The parsed command line. */
export interface QueryOptions {
  command: QueryCommand;
  /** The project root (default: the current directory). */
  root: string;
  /** The report folder, relative to the root. Absent: the config or the default applies. */
  out?: string;
  /** The Node runtime packages. Absent: the config or the default applies. */
  nodeRuntimes?: string[];
}

/** The mode flags, and the command that each one sets. */
const MODE_FLAGS: Readonly<Record<string, QueryCommand>> = {
  "--emit": { name: "emit" },
  "--check-browser-safety": { name: "check-browser-safety" },
};

/** The flags that take a value (`--name=<value>`). */
const VALUE_FLAGS = new Set(["--root", "--out", "--node-runtime"]);

/** The words of each command, after its name, in the usage form. */
const COMMAND_USAGE: Readonly<Record<string, string>> = {
  dependents: "<file>",
  "symbol-users": "<symbol>",
  "is-public": "<pkg> <symbol>",
  "node-safety": "[pkg]",
  cycles: "",
};

/**
 * Makes the command `name` from its positional arguments `args`. Throws on an unknown command,
 * a missing argument or an extra argument.
 */
function makeCommand(name: string, args: readonly string[]): QueryCommand {
  const usage = COMMAND_USAGE[name];
  if (usage === undefined) {
    throw new Error(`unknown command '${name}' (see repo-tools query --help)`);
  }
  const [a, b] = args;
  const need = (count: number): void => {
    if (args.length < count) throw new Error(`${name} needs ${usage}`);
  };
  const atMost = (count: number): void => {
    if (args.length > count) {
      throw new Error(
        count === 0
          ? `${name} takes no more arguments`
          : `${name} takes ${usage}, not more arguments`,
      );
    }
  };
  switch (name) {
    case "dependents":
      need(1);
      atMost(1);
      return { name, file: a as string };
    case "symbol-users":
      need(1);
      atMost(1);
      return { name, symbol: a as string };
    case "is-public":
      need(2);
      atMost(2);
      return { name, pkg: a as string, symbol: b as string };
    case "node-safety":
      atMost(1);
      return a === undefined ? { name } : { name, pkg: a };
    default:
      atMost(0);
      return { name: "cycles" };
  }
}

/** Splits a comma list. Throws on an empty item. */
function list(flag: string, value: string): string[] {
  const items = value.split(",");
  if (items.some((item) => item === "")) throw new Error(`flag ${flag} holds an empty item`);
  return items;
}

/**
 * Parses the query arguments. The first argument that is not a flag names the command; the next
 * ones are its arguments. Throws on any error of the command line.
 */
export function parseQueryArgs(argv: readonly string[], cwd: string): QueryOptions {
  let root: string | undefined;
  let out: string | undefined;
  let nodeRuntimes: string[] | undefined;
  let mode: QueryCommand | undefined;
  const words: string[] = [];
  for (const arg of argv) {
    if (!arg.startsWith("-")) {
      words.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const value = eq === -1 ? undefined : arg.slice(eq + 1);
    const modeCommand = MODE_FLAGS[name];
    if (modeCommand !== undefined) {
      if (value !== undefined) throw new Error(`flag ${name} takes no value`);
      if (mode !== undefined) throw new Error("use one command or mode in a run");
      mode = modeCommand;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) {
      throw new Error(`unknown flag '${name}' (see repo-tools query --help)`);
    }
    if (value === undefined || value === "") {
      throw new Error(`flag ${name} needs a value: ${name}=<value>`);
    }
    if (name === "--root") {
      if (root !== undefined) throw new Error("the root is set twice");
      root = value;
    } else if (name === "--out") {
      if (isAbsolutePath(value)) throw new Error(`flag --out ${ABSOLUTE_PATH_TEXT}`);
      out = value;
    } else {
      nodeRuntimes = list(name, value);
    }
  }
  const [first, ...rest] = words;
  let command: QueryCommand;
  if (mode !== undefined) {
    if (first !== undefined) {
      if (COMMAND_USAGE[first] !== undefined) throw new Error("use one command or mode in a run");
      throw new Error(`unknown command '${first}' (see repo-tools query --help)`);
    }
    command = mode;
  } else {
    if (first === undefined) {
      throw new Error("a command is missing (see repo-tools query --help)");
    }
    command = makeCommand(first, rest);
  }
  return {
    command,
    root: root ?? cwd,
    ...(out === undefined ? {} : { out }),
    ...(nodeRuntimes === undefined ? {} : { nodeRuntimes }),
  };
}
