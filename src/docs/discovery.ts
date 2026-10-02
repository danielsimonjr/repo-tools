/**
 * Source discovery for `repo-tools docs`.
 *
 * Ported from `discovery.py` of the code-docs skill. The tool asks git for the files, not the file
 * system. A walk finds `dist/`, `bundle/`, `node_modules/` and generated `.d.ts` output, and a
 * coverage figure over generated files means nothing. A filesystem walk is the fallback when the
 * root is not in a git work tree, and the provenance string says so.
 */
import { spawnSync } from "node:child_process";
import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { suffixOf } from "../map/discovery.ts";
import { sortCodeUnits } from "../sort.ts";

const PYTHON_SUFFIXES = new Set([".py"]);
const TYPESCRIPT_SUFFIXES = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

/**
 * Folders that no run reads. `bundle`, `dist` and `build` hold generated output. A stub in a
 * generated file is erased by the next build, and it can be committed and read as source.
 */
export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "bundle",
  "out",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".mypy_cache",
  ".pytest_cache",
  "vendor",
  ".next",
  ".turbo",
  "target",
]);

/** Generated or vendored files that are not authored source. */
const SKIP_SUFFIXES = [".d.ts", ".min.js", ".bundle.js", "_pb2.py", ".g.ts"];

/** The name of the config file, read from the root. */
export const CONFIG_NAME = ".code-docs.json";

/** The error of a malformed config file. It is never ignored: a broken config would lie. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** The files of a run and how the run found them. */
export interface Discovery {
  /** The paths of the source files, relative to the root, in code-unit order. */
  files: string[];
  /** The report states this string, so two counts from two methods are not compared. */
  provenance: string;
}

/** Returns `python`, `typescript`, or an empty string when the file is not analysable. */
export function languageOf(path: string): "python" | "typescript" | "" {
  const suffix = suffixOf(path.slice(path.lastIndexOf("/") + 1));
  if (PYTHON_SUFFIXES.has(suffix)) return "python";
  if (TYPESCRIPT_SUFFIXES.has(suffix)) return "typescript";
  return "";
}

/** True for a source file that the tool measures. */
function isSource(path: string): boolean {
  if (path.split("/").some((part) => SKIP_DIRS.has(part))) return false;
  if (SKIP_SUFFIXES.some((suffix) => path.endsWith(suffix))) return false;
  return languageOf(path) !== "";
}

/** The output of `git ls-files` with `args`, or null when git fails. */
function gitFiles(root: string, args: string[]): string[] | null {
  const run = spawnSync("git", ["-C", root, "ls-files", "-z", ...args], {
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 120_000,
    maxBuffer: 1 << 30,
  });
  if (run.error || run.status !== 0 || !run.stdout) return null;
  return new TextDecoder("utf-8").decode(run.stdout).split("\0").filter(Boolean);
}

/** The source files below `root` by a walk, with the skipped folders pruned. */
function walkSource(root: string): string[] {
  const found: string[] = [];
  const go = (dir: string, prefix: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) go(join(dir, entry.name), `${rel}/`);
      } else if (isSource(rel) && statOk(join(dir, entry.name))) {
        found.push(rel);
      }
    }
  };
  go(root, "");
  return found;
}

/** True when `path` resolves to a file. A dangling link does not. */
function statOk(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** One decision of the config file: a path prefix and the reason for the exclusion. */
interface Exclusion {
  prefix: string;
  reason: string;
}

/**
 * Reads `.code-docs.json`. Each exclusion is a decision that a reviewer can read, so each entry
 * needs a `reason`. A prefix matches whole path segments: `assembly/` does not match
 * `assembly_tools/`.
 */
function loadExclusions(root: string): Exclusion[] {
  const file = join(root, CONFIG_NAME);
  if (!existsSync(file) || !statOk(file)) return [];
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new ConfigError(`${CONFIG_NAME}: invalid JSON (${(error as Error).message})`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ConfigError(`${CONFIG_NAME}: the top level must be an object`);
  }
  const list = (data as { exclude?: unknown }).exclude ?? [];
  if (!Array.isArray(list)) throw new ConfigError(`${CONFIG_NAME}: 'exclude' must be an array`);
  return list.map((entry: unknown, i: number): Exclusion => {
    const record =
      typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    const { path, reason } = record;
    if (typeof path !== "string" || path === "") {
      throw new ConfigError(`${CONFIG_NAME}: exclude[${i}] needs a string 'path'`);
    }
    if (typeof reason !== "string" || reason.trim() === "") {
      throw new ConfigError(`${CONFIG_NAME}: exclude[${i}] (${path}) needs a non-empty 'reason'`);
    }
    return {
      prefix: `${path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")}/`,
      reason: reason.trim(),
    };
  });
}

/** Drops the excluded files, and adds the exclusions to the provenance. */
function applyExclusions(files: string[], how: string, root: string): Discovery {
  const exclusions = loadExclusions(root);
  if (exclusions.length === 0) return { files, provenance: how };
  const kept = files.filter((f) => !exclusions.some((e) => `${f}/`.startsWith(e.prefix)));
  const named = exclusions.map((e) => `${e.prefix} (${e.reason})`).join("; ");
  return {
    files: kept,
    provenance: `${how} -- ${files.length - kept.length} file(s) excluded by ${CONFIG_NAME}: ${named}`,
  };
}

/** Finds the source files below `root` and says how. Throws `ConfigError` on a bad config. */
export function discover(root: string): Discovery {
  const tracked = gitFiles(root, []);
  if (tracked === null) {
    const files = sortCodeUnits(walkSource(root));
    return applyExclusions(
      files,
      "filesystem walk (NOT a git repo -- may include generated files)",
      root,
    );
  }
  const files = sortCodeUnits(tracked.filter(isSource));
  // `git ls-files` lists the tracked files only. A new tree has none, and zero files would read as
  // a clean pass. So the untracked source is counted and named.
  const untracked = (gitFiles(root, ["--others", "--exclude-standard"]) ?? []).filter(isSource);
  if (untracked.length > 0 && files.length === 0) {
    return applyExclusions(
      sortCodeUnits(untracked),
      `filesystem walk -- git tracks NO source here, ${untracked.length} untracked file(s) found; ` +
        "commit them or the gate measures nothing",
      root,
    );
  }
  if (untracked.length > 0) {
    return applyExclusions(
      files,
      `git ls-files (${files.length} tracked) -- WARNING: ${untracked.length} untracked source ` +
        "file(s) were NOT measured",
      root,
    );
  }
  return applyExclusions(files, "git ls-files", root);
}
