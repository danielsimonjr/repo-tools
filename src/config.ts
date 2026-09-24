/**
 * The config file `repo-tools.config.json` (design section 5.1) and the merge of the command-line
 * flags, the config file and the defaults.
 *
 * Precedence: a command-line flag, then the config file, then the default. Every path is POSIX or
 * native, relative to the project root; the loader rejects an absolute path, so a committed
 * config cannot hold a user path. An unknown key, a value of the wrong type and a config file
 * that is missing (when `--config` names it), unreadable or not valid JSON each throw an error.
 * An error text shows the root as `<root>`.
 */
import { existsSync, readFileSync } from "node:fs";
import { posix, resolve, win32 } from "node:path";
import { DEFAULT_STABILITY_TAGS } from "./depgraph/api-surface.ts";
import { OUTPUT_SUBDIR } from "./depgraph/paths.ts";
import { DEFAULT_REGENERATE_COMMAND, VERIFICATION_MARKER } from "./depgraph/reporters/banner.ts";
import { TEST_DIR_NAMES } from "./depgraph/scanner.ts";

/** The name of the config file at the root. */
export const CONFIG_FILE = "repo-tools.config.json";

/** The `depgraph.apiSurface` settings: the per-export facts report (design section 6.2). */
export interface ApiSurfaceConfig {
  /** The report file, relative to the root. `null`: no report. */
  out: string | null;
  /** The entry file of the public surface, relative to the root. */
  entry: string;
  /** The whole-word JSDoc stability tags. The last tag in a block wins. */
  stabilityTags: string[];
}

/** The merged depgraph settings of one run. Every path is relative to the root. */
export interface DepgraphConfig {
  /** The source roots, or `"auto"`: `src/` if present, else each top-level TypeScript folder. */
  src: string[] | "auto";
  /** The test folders, relative to the root and, in monorepo mode, to each package folder. */
  tests: string[];
  /** The output folder. */
  out: string;
  /** The folder names that every walk skips. Replaces the default list. */
  exclude: string[];
  /** More folder names that every walk skips. Extends `exclude`. */
  alsoExclude: string[];
  /** An orphaned source file fails the run. */
  strictOrphans: boolean;
  /** The duplicate allowlist file. */
  duplicateAllowlist: string;
  /** The duplicate baseline file (read by the duplicate gate). */
  duplicateBaseline: string;
  /** The coverage policy file. */
  coveragePolicy: string;
  /** The command that the banner of each Markdown report names. */
  regenerateCommand: string;
  /** The first banner line of each Markdown report. `null` omits the line. */
  verificationMarker: string | null;
  /** The per-export facts report. */
  apiSurface: ApiSurfaceConfig;
  /** The repo-local extension modules, in load order. */
  extensions: string[];
}

/** The depgraph settings that one source (the command line or the config file) sets. */
export type DepgraphSettings = Partial<Omit<DepgraphConfig, "apiSurface">> & {
  apiSurface?: Partial<ApiSurfaceConfig>;
};

/** The default skip list of folder names. */
export const DEFAULT_EXCLUDE: readonly string[] = [
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
];

/** The default entry file of the per-export facts report. */
export const DEFAULT_API_ENTRY = "src/index.ts";

/** True when `path` is absolute on any operating system (`/x`, `C:\x`, `C:/x`, `\\host\x`). */
export function isAbsolutePath(path: string): boolean {
  return posix.isAbsolute(path) || win32.isAbsolute(path);
}

/** Returns the absolute form of the root-relative `path`. */
export function resolveUnderRoot(root: string, path: string): string {
  return resolve(root, path);
}

/** The kind of value that one config key holds. */
type KeyKind =
  | "path"
  | "path-or-null"
  | "paths"
  | "src"
  | "names"
  | "boolean"
  | "string"
  | "string-or-null";

/** The keys of `depgraph` in the config file, and the kind of each value. */
const DEPGRAPH_KEYS: Readonly<Record<string, KeyKind>> = {
  src: "src",
  tests: "paths",
  out: "path",
  exclude: "names",
  alsoExclude: "names",
  strictOrphans: "boolean",
  duplicateAllowlist: "path",
  duplicateBaseline: "path",
  coveragePolicy: "path",
  regenerateCommand: "string",
  verificationMarker: "string-or-null",
  extensions: "paths",
};

/** The keys of `depgraph.apiSurface`, and the kind of each value. */
const API_SURFACE_KEYS: Readonly<Record<string, KeyKind>> = {
  out: "path-or-null",
  entry: "path",
  stabilityTags: "names",
};

/** True for a plain JSON object (not `null`, not an array). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks one config value against its kind and returns it. Throws on a wrong type, an empty
 * string, an empty list item or an absolute path. `fail` builds the error.
 */
function checkValue(
  key: string,
  kind: KeyKind,
  value: unknown,
  fail: (message: string) => Error,
): unknown {
  const text = (v: unknown, what: string): string => {
    if (typeof v !== "string" || v === "") throw fail(`'${key}' must be ${what}`);
    return v;
  };
  const relPath = (v: unknown, what: string): string => {
    const p = text(v, what);
    if (isAbsolutePath(p))
      throw fail(`'${key}' holds an absolute path; use a path relative to the root`);
    return p;
  };
  const list = (v: unknown, item: (x: unknown) => string, what: string): string[] => {
    if (!Array.isArray(v)) throw fail(`'${key}' must be ${what}`);
    return v.map(item);
  };
  switch (kind) {
    case "path":
      return relPath(value, "a non-empty relative path");
    case "path-or-null":
      return value === null ? null : relPath(value, "a non-empty relative path or null");
    case "paths":
      return list(
        value,
        (x) => relPath(x, "a list of non-empty relative paths"),
        "a list of non-empty relative paths",
      );
    case "src":
      if (value === "auto") return value;
      return list(
        value,
        (x) => relPath(x, '"auto" or a list of non-empty relative paths'),
        '"auto" or a list of non-empty relative paths',
      );
    case "names":
      return list(
        value,
        (x) => text(x, "a list of non-empty strings"),
        "a list of non-empty strings",
      );
    case "boolean":
      if (typeof value !== "boolean") throw fail(`'${key}' must be true or false`);
      return value;
    case "string":
      return text(value, "a non-empty string");
    case "string-or-null":
      return value === null ? null : text(value, "a non-empty string or null");
  }
}

/** Checks the keys of `object` against `keys` and returns the checked values. */
function checkSection(
  prefix: string,
  object: Record<string, unknown>,
  keys: Readonly<Record<string, KeyKind>>,
  fail: (message: string) => Error,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(object)) {
    const kind = keys[name];
    if (kind === undefined) throw fail(`unknown key '${prefix}${name}'`);
    out[name] = checkValue(`${prefix}${name}`, kind, value, fail);
  }
  return out;
}

/**
 * Checks a parsed config file and returns its depgraph settings. Throws on an unknown key or an
 * invalid value. `label` names the file in the error text.
 */
export function parseConfig(parsed: unknown, label: string): DepgraphSettings {
  const fail = (message: string): Error => new Error(`config ${label}: ${message}`);
  if (!isObject(parsed)) throw fail("the file must hold a JSON object");
  for (const key of Object.keys(parsed)) {
    if (key !== "depgraph") throw fail(`unknown key '${key}'`);
  }
  const section = parsed.depgraph;
  if (section === undefined) return {};
  if (!isObject(section)) throw fail("'depgraph' must be an object");
  const { apiSurface, ...rest } = section;
  const settings = checkSection("depgraph.", rest, DEPGRAPH_KEYS, fail) as DepgraphSettings;
  if (apiSurface !== undefined) {
    if (!isObject(apiSurface)) throw fail("'depgraph.apiSurface' must be an object");
    settings.apiSurface = checkSection(
      "depgraph.apiSurface.",
      apiSurface,
      API_SURFACE_KEYS,
      fail,
    ) as Partial<ApiSurfaceConfig>;
  }
  return settings;
}

/**
 * Loads the config file of `root`: the file `configPath` (relative to the root) when it is
 * given, else `repo-tools.config.json` at the root when it exists. Returns `{}` when no file
 * applies. Throws when a named file is missing, or when the file is unreadable, not valid JSON
 * or not valid config. The error text shows the root as `<root>`.
 */
export function loadConfigFile(root: string, configPath?: string): DepgraphSettings {
  if (configPath !== undefined && isAbsolutePath(configPath)) {
    throw new Error("flag --config holds an absolute path; use a path relative to the root");
  }
  const rel = configPath ?? CONFIG_FILE;
  const label = `<root>/${rel.replace(/\\/g, "/")}`;
  const path = resolveUnderRoot(root, rel);
  if (configPath === undefined && !existsSync(path)) return {};
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`config ${label}: the file cannot be read`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`config ${label}: the file is not valid JSON`);
  }
  return parseConfig(parsed, label);
}

/**
 * Merges the command-line settings `cli`, the config-file settings `file` and the defaults, in
 * that order of precedence. The file defaults of the allowlist, the baseline and the coverage
 * policy are in the merged output folder.
 */
export function mergeDepgraphConfig(cli: DepgraphSettings, file: DepgraphSettings): DepgraphConfig {
  const out = cli.out ?? file.out ?? OUTPUT_SUBDIR;
  const inOut = (name: string): string => `${out.replace(/[\\/]+$/, "")}/${name}`;
  return {
    src: cli.src ?? file.src ?? "auto",
    tests: cli.tests ?? file.tests ?? [...TEST_DIR_NAMES],
    out,
    exclude: cli.exclude ?? file.exclude ?? [...DEFAULT_EXCLUDE],
    alsoExclude: cli.alsoExclude ?? file.alsoExclude ?? [],
    strictOrphans: cli.strictOrphans ?? file.strictOrphans ?? false,
    duplicateAllowlist:
      cli.duplicateAllowlist ?? file.duplicateAllowlist ?? inOut("duplicate-allowlist.json"),
    duplicateBaseline:
      cli.duplicateBaseline ?? file.duplicateBaseline ?? inOut("duplicate-baseline.json"),
    coveragePolicy: cli.coveragePolicy ?? file.coveragePolicy ?? inOut("coverage-policy.json"),
    regenerateCommand:
      cli.regenerateCommand ?? file.regenerateCommand ?? DEFAULT_REGENERATE_COMMAND,
    verificationMarker:
      cli.verificationMarker !== undefined
        ? cli.verificationMarker
        : file.verificationMarker !== undefined
          ? file.verificationMarker
          : VERIFICATION_MARKER,
    apiSurface: {
      out:
        cli.apiSurface?.out !== undefined
          ? cli.apiSurface.out
          : file.apiSurface?.out !== undefined
            ? file.apiSurface.out
            : null,
      entry: cli.apiSurface?.entry ?? file.apiSurface?.entry ?? DEFAULT_API_ENTRY,
      stabilityTags: cli.apiSurface?.stabilityTags ??
        file.apiSurface?.stabilityTags ?? [...DEFAULT_STABILITY_TAGS],
    },
    extensions: cli.extensions ?? file.extensions ?? [],
  };
}
