/**
 * Specifier resolution: a relative specifier to a root-relative source path, and a package
 * specifier to a workspace package and its entry file.
 *
 * Fix F30: a relative specifier resolves to a `.tsx` file and to a directory index
 * (`index.ts`, `index.tsx`) when the caller knows that file.
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

/** A set of root-relative file paths that a resolution may land on. */
export interface KnownFiles {
  has(path: string): boolean;
}

/**
 * The candidate files of the relative specifier `spec` of `fromPath`, in order (fix F30). A
 * `.js` specifier gives `<x>.ts`, then `<x>.tsx`. A `.ts` or `.tsx` specifier gives itself.
 * Any other specifier gives `<x>.ts`, `<x>.tsx`, `<x>/index.ts`, then `<x>/index.tsx`. Each
 * `dist/` path maps to its `src/` source.
 */
export function resolveCandidates(fromPath: string, spec: string): string[] {
  const base = toPosix(join(dirname(fromPath), spec));
  let candidates: string[];
  if (base.endsWith(".js")) {
    const stem = base.slice(0, -3);
    candidates = [`${stem}.ts`, `${stem}.tsx`];
  } else if (base.endsWith(".ts") || base.endsWith(".tsx")) {
    candidates = [base];
  } else {
    candidates = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  }
  return candidates.map(distToSrc);
}

/**
 * Resolves the relative specifier `spec` of the file `fromPath` (root-relative) to a
 * root-relative POSIX path: the first candidate of `resolveCandidates` that `known` holds.
 * Without a match (or without `known`) the result is the first candidate.
 */
export function resolvePath(fromPath: string, spec: string, known?: KnownFiles): string {
  const candidates = resolveCandidates(fromPath, spec);
  const first = candidates[0] as string;
  if (!known) return first;
  return candidates.find((c) => known.has(c)) ?? first;
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
