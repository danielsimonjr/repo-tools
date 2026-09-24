/**
 * Workspace detection: npm and Yarn `workspaces`, `pnpm-workspace.yaml`, and the structural
 * fallback for a repo that holds two or more packages without a declaration.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { isLink, isLinkEntry, listEntries, listNames } from "./dirlist.ts";
import { toPosix } from "./paths.ts";
import { exportsSubpathEntries, isJsonObject, type Warn } from "./roots.ts";
import type { WorkspacePackage } from "./types.ts";

/**
 * The workspace patterns of the repo at `root`, in this order of precedence:
 *
 * 1. `package.json` `workspaces` (the array form, or the Yarn `{ packages: [...] }` form).
 * 2. `pnpm-workspace.yaml` `packages`.
 * 3. Structure: each top-level directory (not a dot-directory, not `node_modules` or `tools`)
 *    that holds a `package.json` and a `src/`, when there are two or more.
 *
 * Negated patterns (`!x`) stay in the list, in their place; `detectWorkspaces` applies them (fix
 * F36). A declaration with no positive pattern is no declaration. A pattern that is not a string
 * is ignored with a warning (fix F35).
 */
export function readWorkspacePatterns(root: string, warn: Warn = () => {}): string[] {
  const strings = (list: unknown[], file: string): string[] =>
    list.filter((p): p is string => {
      if (typeof p === "string") return true;
      warn(`${file}: workspace pattern ${JSON.stringify(p)} is not a string; it is ignored`);
      return false;
    });
  try {
    const rootPkg: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    const ws = isJsonObject(rootPkg) ? rootPkg.workspaces : undefined;
    const list = Array.isArray(ws) ? ws : isJsonObject(ws) ? ws.packages : undefined;
    const patterns = Array.isArray(list) ? strings(list, "package.json") : undefined;
    if (patterns?.some((p) => !p.startsWith("!"))) return patterns;
  } catch {
    // No package.json, or not valid JSON: try pnpm.
  }

  try {
    const cfg = load(readFileSync(join(root, "pnpm-workspace.yaml"), "utf-8")) as
      | { packages?: unknown[] }
      | undefined;
    if (Array.isArray(cfg?.packages)) {
      return strings(cfg.packages, "pnpm-workspace.yaml");
    }
  } catch {
    // No pnpm-workspace.yaml: try the structural fallback.
  }

  const detected: string[] = [];
  for (const entry of listEntries(root)) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules" || entry.name === "tools") continue;
    if (isLinkEntry(root, entry) || !entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "src"))) {
      detected.push(entry.name);
    }
  }
  if (detected.length > 1) return detected;
  return [];
}

/**
 * Reads `<root>/<pkgDir>/package.json` into `workspaces` when it has a name. A package folder
 * that is a link is not read (fix F34): it can hold the files of another repository. A
 * package.json that is not a JSON object is skipped with a warning (fix F35).
 */
function addPackage(
  root: string,
  pkgDir: string,
  workspaces: Map<string, WorkspacePackage>,
  warn: Warn,
): void {
  if (isLink(join(root, pkgDir))) return;
  const pkgJsonPath = join(root, pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) return;
  let pkg: unknown;
  try {
    pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  } catch {
    // Skip a package.json that is not valid JSON.
    return;
  }
  if (!isJsonObject(pkg)) {
    warn(`${toPosix(join(pkgDir, "package.json"))} is not a JSON object; the package is skipped`);
    return;
  }
  if (typeof pkg.name !== "string" || !pkg.name) return;
  workspaces.set(pkg.name, {
    name: pkg.name,
    directory: toPosix(pkgDir),
    srcDir: toPosix(join(pkgDir, "src")),
    extraEntries: exportsSubpathEntries(root, pkgDir, pkg, warn),
  });
}

/** A pattern folder in one form: no leading `./`, no trailing `/`. */
function normalizePattern(pattern: string): string {
  return toPosix(pattern)
    .replace(/^(?:\.\/)+/, "")
    .replace(/\/+$/, "");
}

/**
 * True when the package folder `dir` (root-relative, POSIX) matches the glob `pattern`: `**`
 * matches any text, `*` matches any text without a `/`, and every other character is itself.
 */
export function matchesWorkspaceGlob(pattern: string, dir: string): boolean {
  const body = normalizePattern(pattern)
    .split("**")
    .map((part) =>
      part
        .split("*")
        .map((text) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${body}$`).test(normalizePattern(dir));
}

/**
 * Returns a test for the folders that a negated workspace pattern (`!packages/skip`) excludes.
 * The census walks leave those folders out (fix F41).
 */
export function negatedWorkspaceFolders(root: string): (relDir: string) => boolean {
  let negated: string[] = [];
  try {
    negated = readWorkspacePatterns(root)
      .filter((p) => p.startsWith("!"))
      .map((p) => p.slice(1));
  } catch {
    negated = [];
  }
  return (relDir) => negated.some((n) => matchesWorkspaceGlob(n, relDir));
}

/**
 * The workspace packages of the repo at `root`, keyed by npm name. A pattern that ends in `/*`
 * lists its parent directory. Any other pattern is one package directory. A negated pattern
 * (`!packages/skip`, `!packages/old-*`) removes each package folder that it matches, whatever
 * its place in the list (fix F36). Returns an empty map in single-package mode.
 */
export function detectWorkspaces(
  root: string,
  warn: Warn = () => {},
): Map<string, WorkspacePackage> {
  const workspaces = new Map<string, WorkspacePackage>();
  try {
    const patterns = readWorkspacePatterns(root, warn);
    const negated = patterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1));
    const add = (pkgDir: string): void => {
      if (negated.some((n) => matchesWorkspaceGlob(n, toPosix(pkgDir)))) return;
      addPackage(root, pkgDir, workspaces, warn);
    };
    for (const pattern of patterns) {
      if (pattern.startsWith("!")) continue;
      if (pattern.endsWith("/*")) {
        const parentDir = pattern.slice(0, -2);
        if (!existsSync(join(root, parentDir))) continue;
        for (const entry of listNames(join(root, parentDir))) add(join(parentDir, entry));
      } else {
        add(pattern);
      }
    }
  } catch {
    // No readable workspace declaration.
  }
  return workspaces;
}
