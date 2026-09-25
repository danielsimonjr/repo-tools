/**
 * The browser-safety model of `repo-tools query` (design section 3.5).
 *
 * A package is the folder above a `src/index.ts` entry of the graph; the package of the root
 * `src/index.ts` is ".". Each package is browser-safe unless it is a Node runtime. The `.` entry
 * of a browser-safe package must reach no file that imports a `node:` builtin. The Node runtimes
 * come from the command line or the config file; the source tool named one fixed package.
 */
import { sortCodeUnits } from "../sort.ts";
import type { FilePair } from "./graph.ts";
import type { QueryGraph } from "./load.ts";

/** The package of the root entry. */
export const ROOT_PACKAGE = ".";

/** The `src/index.ts` entry file of the package `pkg`. */
export function entryOf(pkg: string): string {
  return pkg === ROOT_PACKAGE ? "src/index.ts" : `${pkg}/src/index.ts`;
}

/** The packages of the graph: one per `main` entry point, in code-unit order. */
export function packagesOf(graph: Pick<QueryGraph, "entryPoints">): string[] {
  const packages = graph.entryPoints
    .filter((e) => e.type === "main")
    .map((e) =>
      e.file === "src/index.ts" ? ROOT_PACKAGE : e.file.replace(/\/src\/index\.ts$/, ""),
    );
  return sortCodeUnits([...new Set(packages)]);
}

/** The browser-safe packages: every package of the graph less the Node runtimes. */
export function browserSafePackages(
  graph: Pick<QueryGraph, "entryPoints">,
  nodeRuntimes: readonly string[],
): string[] {
  const runtimes = new Set(nodeRuntimes);
  return packagesOf(graph).filter((pkg) => !runtimes.has(pkg));
}

/**
 * The node taint of each file. `direct`: the file imports a `node:` builtin. `taint`: the file,
 * or a file that it reaches, imports a `node:` builtin.
 */
export function computeTaint(
  forward: ReadonlyMap<string, ReadonlySet<string>>,
  fileEntries: readonly FilePair[],
): { taint: Map<string, boolean>; direct: Map<string, boolean> } {
  const direct = new Map<string, boolean>();
  for (const [file, entry] of fileEntries) {
    direct.set(file, (entry.nodeDependencies ?? []).length > 0);
  }
  // A file is tainted when it reaches a direct file: walk the reverse edges from each direct
  // file. The walk is correct on a cycle, and it visits each edge once.
  const reverse = new Map<string, string[]>();
  for (const [file, targets] of forward) {
    for (const target of targets) {
      const importers = reverse.get(target) ?? [];
      importers.push(file);
      reverse.set(target, importers);
    }
  }
  const tainted = new Set<string>();
  const stack = [...direct].filter(([, d]) => d).map(([file]) => file);
  for (let file = stack.pop(); file !== undefined; file = stack.pop()) {
    if (tainted.has(file)) continue;
    tainted.add(file);
    for (const importer of reverse.get(file) ?? []) stack.push(importer);
  }
  const taint = new Map<string, boolean>();
  for (const file of forward.keys()) taint.set(file, tainted.has(file));
  return { taint, direct };
}

/** The set of files that `entry` reaches over the forward edges, `entry` included. */
export function reachableFrom(
  entry: string,
  forward: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  for (let file = stack.pop(); file !== undefined; file = stack.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const target of forward.get(file) ?? []) stack.push(target);
  }
  return seen;
}

/**
 * The files that the `.` entry of `pkg` reaches and that import a `node:` builtin, in code-unit
 * order. A package with no entry in the graph gives an empty list.
 */
export function findLeaks(
  pkg: string,
  forward: ReadonlyMap<string, ReadonlySet<string>>,
  direct: ReadonlyMap<string, boolean>,
): string[] {
  const entry = entryOf(pkg);
  if (!forward.has(entry)) return [];
  return sortCodeUnits([...reachableFrom(entry, forward)].filter((f) => direct.get(f) === true));
}
