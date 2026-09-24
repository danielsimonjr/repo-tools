/**
 * The command line of `repo-tools depgraph` (design section 3.2).
 *
 * The parser is strict. An unknown flag, a flag without its value, a value on a flag that takes
 * none, and a second root each throw an error; the run then exits 1 and writes nothing. An error
 * text names the flag only, never the value, so no path of the user goes to standard error.
 */

import { ABSOLUTE_PATH_TEXT, type DepgraphSettings, isAbsolutePath } from "../config.ts";

/** The parsed command line. */
export interface DepgraphOptions {
  root: string;
  /** The config file named by `--config`, relative to the root. */
  config?: string;
  /** The settings that the command line sets; they win over the config file. */
  settings: DepgraphSettings;
  includeTests: boolean;
  all: boolean;
  /** Fix M1: restrict the graph to reachable files (single-package mode too). */
  reachableOnly: boolean;
  /** Fix M1: an orphan fails the census self-check. */
  strictOrphans: boolean;
  /** Fix F42: a census gap fails the census self-check. */
  strictCensus: boolean;
  checkCensus: boolean;
  /** The duplicate gate: exit 1 on a TRUE_DUPLICATE name that the baseline does not hold. */
  checkDuplicates: boolean;
  /** With `checkDuplicates`: read the committed report, do not regenerate. */
  noRegen: boolean;
  /** Write the duplicate baseline from the current duplicate-symbols.json. */
  writeDuplicateBaseline: boolean;
  /** Load no extension (design section 5.2). */
  noExtensions: boolean;
  help: boolean;
}

/** The option keys that a boolean flag sets. */
type BooleanKey = {
  [K in keyof DepgraphOptions]: DepgraphOptions[K] extends boolean ? K : never;
}[keyof DepgraphOptions];

/** Each boolean flag and the option that it sets. */
const BOOLEAN_FLAGS: Readonly<Record<string, BooleanKey>> = {
  "--all": "all",
  "-a": "all",
  "--include-tests": "includeTests",
  "-t": "includeTests",
  "--reachable-only": "reachableOnly",
  "--strict-orphans": "strictOrphans",
  "--strict-census": "strictCensus",
  "--check-census": "checkCensus",
  "--check-duplicates": "checkDuplicates",
  "--no-regen": "noRegen",
  "--write-duplicate-baseline": "writeDuplicateBaseline",
  "--no-extensions": "noExtensions",
  "--help": "help",
  "-h": "help",
};

/**
 * Each flag that takes a value (`--name=<value>`) and how it applies the value. `setRoot` sets
 * the root once; a second root is an error.
 */
const VALUE_FLAGS: Readonly<
  Record<string, (o: DepgraphOptions, value: string, setRoot: (v: string) => void) => void>
> = {
  "--root": (_o, value, setRoot) => setRoot(value),
  "--config": (o, value) => {
    o.config = relativePath("--config", value);
  },
  "--src": (o, value) => {
    o.settings.src = value === "auto" ? "auto" : pathList("--src", value);
  },
  "--tests": (o, value) => {
    o.settings.tests = pathList("--tests", value);
  },
  "--out": (o, value) => {
    o.settings.out = relativePath("--out", value);
  },
  "--exclude": (o, value) => {
    o.settings.exclude = list("--exclude", value);
  },
  "--also-exclude": (o, value) => {
    o.settings.alsoExclude = list("--also-exclude", value);
  },
  "--api-surface": (o, value) => {
    o.settings.apiSurface = { ...o.settings.apiSurface, out: relativePath("--api-surface", value) };
  },
  "--api-entry": (o, value) => {
    o.settings.apiSurface = { ...o.settings.apiSurface, entry: relativePath("--api-entry", value) };
  },
  "--stability-tags": (o, value) => {
    o.settings.apiSurface = {
      ...o.settings.apiSurface,
      stabilityTags: list("--stability-tags", value),
    };
  },
};

/** Splits a comma list. Throws on an empty item. */
function list(flag: string, value: string): string[] {
  const items = value.split(",");
  if (items.some((item) => item === "")) throw new Error(`flag ${flag} holds an empty item`);
  return items;
}

/** Splits a comma list of paths. Throws on an empty item or an absolute path. */
function pathList(flag: string, value: string): string[] {
  return list(flag, value).map((item) => relativePath(flag, item));
}

/** Returns `value`, or throws when it is an absolute path. Path flags resolve against the root. */
function relativePath(flag: string, value: string): string {
  if (isAbsolutePath(value)) {
    throw new Error(`flag ${flag} ${ABSOLUTE_PATH_TEXT}`);
  }
  return value;
}

/**
 * Parses the depgraph arguments. A first argument that is not a flag sets the root. Throws an
 * error on an unknown flag, a missing or unexpected value, or a second root.
 */
export function parseDepgraphArgs(argv: readonly string[], cwd: string): DepgraphOptions {
  const options: DepgraphOptions = {
    root: cwd,
    settings: {},
    includeTests: false,
    all: false,
    reachableOnly: false,
    strictOrphans: false,
    strictCensus: false,
    checkCensus: false,
    checkDuplicates: false,
    noRegen: false,
    writeDuplicateBaseline: false,
    noExtensions: false,
    help: false,
  };
  let rootSet = false;
  const setRoot = (value: string): void => {
    if (rootSet)
      throw new Error("the root is set twice (use --root=<path> or one positional path)");
    rootSet = true;
    options.root = value;
  };
  for (const arg of argv) {
    if (!arg.startsWith("-")) {
      setRoot(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const value = eq === -1 ? undefined : arg.slice(eq + 1);
    const booleanKey = BOOLEAN_FLAGS[name];
    if (booleanKey !== undefined) {
      if (value !== undefined) throw new Error(`flag ${name} takes no value`);
      options[booleanKey] = true;
      continue;
    }
    const apply = VALUE_FLAGS[name];
    if (apply !== undefined) {
      if (value === undefined || value === "") {
        throw new Error(`flag ${name} needs a value: ${name}=<value>`);
      }
      apply(options, value, setRoot);
      continue;
    }
    throw new Error(`unknown flag '${name}' (see repo-tools depgraph --help)`);
  }
  checkModes(options);
  return options;
}

/**
 * Throws when the flags ask for two modes in one run, or for `--no-regen` without
 * `--check-duplicates`. A flag that the run ignores would hide a typing error.
 */
function checkModes(options: DepgraphOptions): void {
  if (options.noRegen && !options.checkDuplicates) {
    throw new Error("flag --no-regen applies with --check-duplicates only");
  }
  const modes = [
    options.checkCensus && "--check-census",
    options.checkDuplicates && "--check-duplicates",
    options.writeDuplicateBaseline && "--write-duplicate-baseline",
  ].filter((mode): mode is string => mode !== false);
  if (modes.length > 1) {
    throw new Error(`flags ${modes.join(" and ")} are two modes; use one of them in a run`);
  }
}

/** True when `argv` asks for the help text. The help wins over any other argument. */
export function wantsHelp(argv: readonly string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}
