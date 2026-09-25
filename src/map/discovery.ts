/**
 * Discovery for the map engine: which language a repository is, which files it holds, and the
 * area and disposition of each file.
 *
 * Ported from `repo_map/discovery.py` of the architecture-docs skill. Paths are relative to the
 * root, with `/` on every operating system. The file list comes from `git ls-files` when the
 * root is inside a git work tree (so an ignored or untracked file is not source), and from a
 * pruned walk otherwise. One difference from the Python tool: the file order is code-unit order
 * of the path parts on every operating system (Python sorts without case on Windows).
 */
import { type Dirent, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pySplitlines } from "../py.ts";
import { compareCodeUnits } from "../sort.ts";

/** The TypeScript and JavaScript suffixes. */
export const SOURCE_SUFFIXES = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
/** The Python suffix: a separate set, so a stray `.py` never joins a TypeScript census. */
export const PYTHON_SUFFIXES = new Set([".py"]);
/** The C# suffix. */
export const CSHARP_SUFFIXES = new Set([".cs"]);
/** The Rust suffix. */
export const RUST_SUFFIXES = new Set([".rs"]);

/** Folders that no walk enters: tool state, dependencies, and build or test output. */
export const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".venv",
  "__pycache__",
  ".pytest_cache",
  ".ruff_cache",
  ".claude",
  "test-results",
  "bundle",
  "target",
]);

/** .NET build output: skipped for C# only, because `bin/` is source in the JS ecosystem. */
export const CSHARP_SKIP_DIRS = new Set(["obj", "bin"]);

/** A config file: `.config[.segment].<ext>` for each scanned extension. */
const CONFIG_PATTERN = /\.config(\.[\w-]+)?\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** A language that the engine reads. */
export type Language = "typescript" | "python" | "csharp" | "rust";

/** One source file of the census. */
export interface DiscoveredFile {
  path: string;
  area: string;
  disposition: string;
  loc: number;
}

/**
 * The area (the part of the repository) of a POSIX path relative to the root. Order matters:
 * a file named as a test wins over `tools/` and `scripts/`, and those win over config. A
 * `tools/` or `scripts/` folder under `src/` is product source, not meta-tooling.
 */
export function classifyArea(relPath: string): string {
  const isTestFile = /\.(test|spec)\.ts$/.test(relPath);
  if (!isTestFile && /(^|\/)(tools|scripts)\//.test(relPath) && !relPath.startsWith("src/")) {
    return "tools";
  }
  if (CONFIG_PATTERN.test(relPath)) return "config";
  if (isTestFile || /(^|\/)tests\//.test(relPath)) return "tests";
  if (/^(bench|benchmarks)\//.test(relPath) || /\.bench\.\w+$/.test(relPath)) return "benchmarks";
  if (/^examples\//.test(relPath)) return "examples";
  if (/^docs\//.test(relPath)) return "docs";
  return "src";
}

/** The reachability flags of a `src` file. */
export interface ReachFlags {
  isRoot?: boolean;
  reachable?: boolean;
  testReachable?: boolean;
}

/** The disposition of a file in `area`. A `src` file depends on its reachability flags. */
export function dispositionForArea(area: string, flags: ReachFlags = {}): string {
  if (area === "src") {
    if (flags.isRoot) return "build-entry";
    if (flags.reachable) return "reachable";
    if (flags.testReachable) return "test-only";
    return "orphan";
  }
  if (area === "tests") return "test";
  if (area === "tools") return "tool";
  if (area === "config") return "config";
  if (area === "benchmarks") return "bench";
  return "example";
}

/** Each language: its suffixes and its extra skipped folders (the pair is the invariant). */
export const LANGUAGE_SCANS: Readonly<Record<Language, [Set<string>, Set<string>]>> = {
  typescript: [SOURCE_SUFFIXES, new Set()],
  python: [PYTHON_SUFFIXES, new Set()],
  csharp: [CSHARP_SUFFIXES, CSHARP_SKIP_DIRS],
  rust: [RUST_SUFFIXES, new Set()],
};

/** Languages the engine cannot read, by suffix. Used only to refuse a repository. */
const UNPARSEABLE_SUFFIXES: Readonly<Record<string, string[]>> = {
  go: [".go"],
  java: [".java"],
  kotlin: [".kt", ".kts"],
  ruby: [".rb"],
  php: [".php"],
  swift: [".swift"],
  cpp: [".cpp", ".cc", ".hpp"],
};

const SUFFIX_TO_LANGUAGE = new Map<string, string>([
  ...Object.entries(LANGUAGE_SCANS).flatMap(([lang, [sufs]]) =>
    [...sufs].map((s) => [s, lang] as [string, string]),
  ),
  ...Object.entries(UNPARSEABLE_SUFFIXES).flatMap(([lang, sufs]) =>
    sufs.map((s) => [s, lang] as [string, string]),
  ),
]);

/**
 * The error of a repository whose language the engine cannot read. Refusing is the feature: a
 * guessed language gives numbers about the wrong files, with a green check beside them.
 */
export class UnsupportedRepoLanguage extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedRepoLanguage";
  }
}

/** Python `Path(name).suffix`: the last dot extension; none for a leading-dot-only name. */
function suffixOf(name: string): string {
  const i = name.lastIndexOf(".");
  if (i <= 0 || i === name.length - 1) return "";
  return name.slice(i);
}

/**
 * True for a symbolic link and for a Windows junction. Bun and Node report a junction as a
 * symbolic link, so one check covers both (the junction tests fail without it; Python needed a
 * separate reparse-point attribute check). An unreadable entry is not a reparse point, so a
 * permission error prunes nothing.
 */
export function isReparsePoint(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** The folders and files of `dir`; empty when the folder cannot be read. */
function entries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Walks `root` and calls `visit` for each file with its path parts. Skipped folders and reparse
 * points are pruned, so the walk never enters `node_modules` or a junction cycle.
 */
function walk(
  root: string,
  skip: Set<string>,
  visit: (parts: string[], name: string) => void,
): void {
  const go = (dir: string, parts: string[]): void => {
    for (const e of entries(dir)) {
      const full = join(dir, e.name);
      if (e.isDirectory() || (e.isSymbolicLink() && isDirectoryTarget(full))) {
        if (skip.has(e.name) || isReparsePoint(full)) continue;
        go(full, [...parts, e.name]);
      } else if (e.isFile() || e.isSymbolicLink()) {
        visit(parts, e.name);
      }
    }
  };
  go(root, []);
}

/** True when `path` resolves to a folder. */
function isDirectoryTarget(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** One walk of `root`; the number of files per language. */
export function countLanguages(root: string): Record<string, number> {
  const counts: Record<string, number> = {};
  walk(root, SKIP_DIRS, (parts, name) => {
    const language = SUFFIX_TO_LANGUAGE.get(suffixOf(name));
    if (language === undefined) return;
    const extra = (LANGUAGE_SCANS as Record<string, [Set<string>, Set<string>]>)[language]?.[1];
    if (extra && extra.size > 0 && parts.some((p) => extra.has(p))) return;
    counts[language] = (counts[language] ?? 0) + 1;
  });
  return counts;
}

const trackedCache = new Map<string, Set<string> | null>();

/**
 * The paths that git tracks under `root`, relative to `root`, or null when `root` is not in a
 * git work tree or git cannot run. Cached per root for the life of the process.
 */
export function gitTracked(root: string): Set<string> | null {
  const cached = trackedCache.get(root);
  if (cached !== undefined) return cached;
  let result: Set<string> | null = null;
  try {
    const r = Bun.spawnSync(["git", "-C", root, "ls-files", "-z", "--cached"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    if (r.exitCode === 0) {
      const out = new TextDecoder("utf-8").decode(r.stdout);
      result = new Set(out.split("\0").filter((p) => p !== ""));
    }
  } catch {
    result = null;
  }
  trackedCache.set(root, result);
  return result;
}

/** Compares two path-part lists in code-unit order. */
function compareParts(a: string[], b: string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = compareCodeUnits(a[i] as string, b[i] as string);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

/** True when `path` is a file (a link to a file counts). */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The path parts of each source file of `suffixes`, in code-unit order. */
export function candidateFiles(
  root: string,
  suffixes: Set<string>,
  extraSkip: Set<string> = new Set(),
): string[][] {
  const skip = new Set([...SKIP_DIRS, ...extraSkip]);
  const found: string[][] = [];
  const tracked = gitTracked(root);
  if (tracked !== null) {
    for (const rel of tracked) {
      const parts = rel.split("/");
      if (parts.slice(0, -1).some((p) => skip.has(p))) continue;
      if (!suffixes.has(suffixOf(parts.at(-1) as string))) continue;
      // A tracked path can be absent from the work tree (a sparse checkout, a deletion).
      if (!isFile(join(root, ...parts))) continue;
      found.push(parts);
    }
  } else {
    walk(root, skip, (parts, name) => {
      if (suffixes.has(suffixOf(name))) found.push([...parts, name]);
    });
  }
  return found.sort(compareParts);
}

const DETECT_ORDER: readonly Language[] = ["typescript", "python", "csharp", "rust"];
const SUPPORTED_NAMES = "TypeScript/JavaScript, Python, C# and Rust";

/**
 * The language to read `root` as: the supported language with the most files (a tie goes in the
 * order TypeScript, Python, C#, Rust). Throws `UnsupportedRepoLanguage` when a language that the
 * engine cannot read has more files. An empty repository reads as TypeScript.
 */
export function detectLanguage(root: string): Language {
  const counts = countLanguages(root);
  let supported: Language | undefined;
  let supportedCount = 0;
  for (const language of DETECT_ORDER) {
    if ((counts[language] ?? 0) > supportedCount) {
      supported = language;
      supportedCount = counts[language] ?? 0;
    }
  }
  for (const other of Object.keys(UNPARSEABLE_SUFFIXES)) {
    const n = counts[other] ?? 0;
    if (n > supportedCount) {
      const found = supported ? `${supportedCount} ${supported} file(s)` : "no supported source";
      throw new UnsupportedRepoLanguage(
        `this repo is ${other}: ${n} ${other} file(s) against ${found}. repo-tools map reads ` +
          `${SUPPORTED_NAMES}, so any figure it produced here would describe the wrong files. ` +
          "It refuses rather than emit numbers that would land in a Verification block.",
      );
    }
  }
  return supported ?? "typescript";
}

/** Reads a source file as UTF-8 with replacement, keeping a byte order mark (as Python does). */
export function readSource(path: string): string {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(readFileSync(path));
}

/** The source files of `root`, with area, disposition (a `src` file is reachable) and lines. */
export function discover(
  root: string,
  language: Language = detectLanguage(root),
): DiscoveredFile[] {
  const [suffixes, extraSkip] = LANGUAGE_SCANS[language];
  return candidateFiles(root, suffixes, extraSkip).map((parts) => {
    const rel = parts.join("/");
    const area = classifyArea(rel);
    return {
      path: rel,
      area,
      disposition: dispositionForArea(area, { reachable: area === "src" }),
      loc: pySplitlines(readSource(join(root, ...parts))).length,
    };
  });
}
