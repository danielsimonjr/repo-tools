/**
 * Specifier resolution: a relative specifier to a root-relative `.ts` path, and a package
 * specifier to a workspace package and its entry file.
 *
 * Port note: `resolvePath` maps every target to `<x>.ts`. A `.tsx` target and a directory index
 * are not resolved here.
 */
import { dirname, join } from "node:path";
import { toPosix } from "./paths.ts";
import type { WorkspacePackage } from "./types.ts";

/**
 * Maps compiled output to its source (fix F7): the first `dist/` segment, and a `src/` segment
 * directly after it, become one `src/` segment. `dist/x` and `dist/src/x` both give `src/x`.
 * A `dist/` folder inside a `src/` tree is source, so a path with `src/` before `dist/` does not
 * change. Source files do not import `dist/`, so only consumers of the built package change.
 */
export function distToSrc(path: string): string {
  const m = /(^|\/)dist\/(?:src\/)?/.exec(path);
  if (!m) return path;
  const before = path.slice(0, m.index);
  if (/(^|\/)src(\/|$)/.test(before)) return path;
  return `${before}${m[1]}src/${path.slice(m.index + m[0].length)}`;
}

/**
 * Resolves the relative specifier `spec` of the file `fromPath` (root-relative) to a
 * root-relative POSIX path: a `.js` suffix is removed, `.ts` is added when absent, and a
 * `dist/` path maps to its `src/` source.
 */
export function resolvePath(fromPath: string, spec: string): string {
  let resolved = join(dirname(fromPath), spec);
  resolved = resolved.replace(/\.js$/, "");
  if (!resolved.endsWith(".ts")) resolved = `${resolved}.ts`;
  return distToSrc(toPosix(resolved));
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
