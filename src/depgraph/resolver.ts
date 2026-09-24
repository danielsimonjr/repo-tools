/**
 * Specifier resolution: a relative specifier to a root-relative `.ts` path, and a package
 * specifier to a workspace package and its entry file.
 *
 * Port note: `resolvePath` maps every target to `<x>.ts`. A `.tsx` target, a directory index and
 * a `dist/` to `src/` mapping are not resolved here.
 */
import { dirname, join } from "node:path";
import { toPosix } from "./paths.ts";
import type { WorkspacePackage } from "./types.ts";

/**
 * Resolves the relative specifier `spec` of the file `fromPath` (root-relative) to a
 * root-relative POSIX path: a `.js` suffix is removed and `.ts` is added when absent.
 */
export function resolvePath(fromPath: string, spec: string): string {
  let resolved = join(dirname(fromPath), spec);
  resolved = resolved.replace(/\.js$/, "");
  if (!resolved.endsWith(".ts")) resolved = `${resolved}.ts`;
  return toPosix(resolved);
}

/**
 * The entry file of the workspace package `packageName`: `<srcDir>/<subpath or index>.ts`.
 * Returns undefined when the package is not a workspace member.
 */
export function workspaceEntryPath(
  workspaces: Map<string, WorkspacePackage>,
  packageName: string,
  subpath?: string,
): string | undefined {
  const ws = workspaces.get(packageName);
  if (!ws) return undefined;
  return `${ws.srcDir}/${subpath ?? "index"}.ts`;
}

/**
 * Resolves a package specifier to a workspace package: the exact name, or `<name>/<subpath>`
 * for an `exports` subpath. Returns undefined for a relative specifier or a package that is
 * not a workspace member.
 */
export function resolveWorkspaceSource(
  workspaces: Map<string, WorkspacePackage>,
  source: string,
): { ws: WorkspacePackage; subpath?: string } | undefined {
  const exact = workspaces.get(source);
  if (exact) return { ws: exact };
  if (source.startsWith(".")) return undefined;
  for (const [name, ws] of workspaces) {
    if (source.startsWith(`${name}/`)) return { ws, subpath: source.slice(name.length + 1) };
  }
  return undefined;
}
