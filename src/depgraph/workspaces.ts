/**
 * Workspace detection: npm and Yarn `workspaces`, `pnpm-workspace.yaml`, and the structural
 * fallback for a repo that holds two or more packages without a declaration.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { toPosix } from "./paths.ts";
import { exportsSubpathEntries } from "./roots.ts";
import type { WorkspacePackage } from "./types.ts";

/**
 * The workspace patterns of the repo at `root`, in this order of precedence:
 *
 * 1. `package.json` `workspaces` (the array form, or the Yarn `{ packages: [...] }` form).
 * 2. `pnpm-workspace.yaml` `packages`.
 * 3. Structure: each top-level directory (not a dot-directory, not `node_modules` or `tools`)
 *    that holds a `package.json` and a `src/`, when there are two or more.
 *
 * Negated patterns (`!x`) are removed.
 */
export function readWorkspacePatterns(root: string): string[] {
  try {
    const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    const ws = rootPkg.workspaces;
    const patterns: string[] | undefined = Array.isArray(ws) ? ws : ws?.packages;
    if (patterns?.length) return patterns.filter((p) => !p.startsWith("!"));
  } catch {
    // No package.json, or not valid JSON: try pnpm.
  }

  try {
    const cfg = yaml.load(readFileSync(join(root, "pnpm-workspace.yaml"), "utf-8")) as
      | { packages?: string[] }
      | undefined;
    if (Array.isArray(cfg?.packages)) return cfg.packages.filter((p) => !p.startsWith("!"));
  } catch {
    // No pnpm-workspace.yaml: try the structural fallback.
  }

  const detected: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules" || entry.name === "tools") continue;
    const dir = join(root, entry.name);
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "src"))) {
      detected.push(entry.name);
    }
  }
  if (detected.length > 1) return detected;
  return [];
}

/** Reads `<root>/<pkgDir>/package.json` into `workspaces` when it has a name. */
function addPackage(root: string, pkgDir: string, workspaces: Map<string, WorkspacePackage>): void {
  const pkgJsonPath = join(root, pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) return;
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    if (pkg.name) {
      workspaces.set(pkg.name, {
        name: pkg.name,
        directory: toPosix(pkgDir),
        srcDir: toPosix(join(pkgDir, "src")),
        extraEntries: exportsSubpathEntries(root, pkgDir, pkg),
      });
    }
  } catch {
    // Skip a package.json that is not valid JSON.
  }
}

/**
 * The workspace packages of the repo at `root`, keyed by npm name. A pattern that ends in `/*`
 * lists its parent directory. Any other pattern is one package directory. Returns an empty map
 * in single-package mode.
 */
export function detectWorkspaces(root: string): Map<string, WorkspacePackage> {
  const workspaces = new Map<string, WorkspacePackage>();
  try {
    const patterns = readWorkspacePatterns(root);
    for (const pattern of patterns) {
      if (pattern.endsWith("/*")) {
        const parentDir = pattern.slice(0, -2);
        if (!existsSync(join(root, parentDir))) continue;
        for (const entry of readdirSync(join(root, parentDir))) {
          addPackage(root, join(parentDir, entry), workspaces);
        }
      } else {
        addPackage(root, pattern, workspaces);
      }
    }
  } catch {
    // No readable workspace declaration.
  }
  return workspaces;
}
