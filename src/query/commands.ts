/**
 * The commands of `repo-tools query` on the core graph (design decision D8). Each command writes
 * its answer to standard output and returns the exit code. A command throws on a user error; the
 * caller prints the message and exits 1.
 *
 * `dependents`, `symbol-users` and `cycles` have repo_map's meaning: they read every area of the
 * graph, a path that is not a file of the graph is an error (not an empty answer), and `cycles`
 * lists the simple cycles (`--components` lists the strongly connected components). The
 * browser-safety commands serve TypeScript/JavaScript only (design decision D5).
 */
import { isAbsolutePath, resolveUnderRoot } from "../config.ts";
import { detectCyclicComponents } from "../depgraph/cycles.ts";
import type { CyclicComponent, ParsedFile } from "../depgraph/types.ts";
import { writeReport } from "../io.ts";
import type { Io } from "../io-types.ts";
import {
  dependents as dependentsOf,
  type GraphDocument,
  cycles as simpleCycles,
  symbolUsers,
} from "../map/query.ts";
import { sortCodeUnits } from "../sort.ts";
import { buildForward, fileEntriesOf, invert } from "./graph.ts";
import { loadSurfaces, type QueryInput } from "./load.ts";
import { browserSafePackages, computeTaint, findLeaks, packagesOf } from "./safety.ts";

/** `dependents <file>`: the files that import `file`, one per line. */
export function dependents(input: QueryInput, file: string, io: Io): number {
  if (isAbsolutePath(file)) {
    throw new Error("dependents <file> holds an absolute path; pass a path relative to the root");
  }
  const target = file.replace(/\\/g, "/");
  const importers = dependentsOf(input.graph as GraphDocument, target);
  io.stdout(importers.length > 0 ? `${importers.join("\n")}\n` : `(no importers of ${target})\n`);
  return 0;
}

/** `symbol-users <symbol>`: each file whose internal imports name `symbol`, one per line. */
export function symbolUsersCommand(input: QueryInput, symbol: string, io: Io): number {
  const users = symbolUsers(input.graph as GraphDocument, symbol);
  io.stdout(users.length > 0 ? `${users.join("\n")}\n` : `(no importers of symbol ${symbol})\n`);
  return 0;
}

/**
 * `is-public <pkg> <symbol>`: PUBLIC or INTERNAL. Throws on a package that is not a key of
 * package-export-surfaces.json; the message lists the keys.
 */
export function isPublic(input: QueryInput, pkg: string, symbol: string, io: Io): number {
  const surfaces = loadSurfaces(input);
  const names = Object.hasOwn(surfaces, pkg) ? surfaces[pkg] : undefined;
  if (names === undefined) {
    const known = Object.keys(surfaces).join(", ");
    throw new Error(
      `unknown package '${pkg}'; the packages of package-export-surfaces.json are: ${known}`,
    );
  }
  io.stdout(
    names.includes(symbol)
      ? `PUBLIC: ${symbol} is exported from ${pkg}\n`
      : `INTERNAL: ${symbol} is not in the public export surface of ${pkg}\n`,
  );
  return 0;
}

/** The lines of one kind of cyclic component: a count line, then members and cycle of each. */
function componentLines(kind: string, components: readonly CyclicComponent[]): string[] {
  const noun = components.length === 1 ? "component" : "components";
  const lines = [`${kind}: ${components.length} cyclic ${noun}`];
  for (const c of components) {
    lines.push(`  members: ${c.members.join(", ")}`, `  cycle: ${c.cycle.join(" -> ")}`);
  }
  return lines;
}

/**
 * `cycles`: every simple cycle of the internal edges (repo_map's meaning), capped; a capped list
 * is a floor and a warning says so. `cycles --components`: the runtime and the type-only
 * strongly connected components (depgraph's fix F26), never capped.
 */
export function cycles(input: QueryInput, components: boolean, io: Io): number {
  if (components) {
    // depgraph's component detector reads parsed-file records; the core edges carry their
    // resolved target, so each record names it directly.
    const records = fileEntriesOf(input.graph).map(
      ([path, entry]) =>
        ({
          path,
          internalDependencies: (entry.internalDependencies ?? [])
            .filter((d) => d.file !== undefined)
            .map((d) => ({
              file: d.file as string,
              imports: d.imports ?? [],
              ...(d.typeOnly ? { typeOnly: true } : {}),
              resolved: d.file as string,
            })),
        }) as unknown as ParsedFile,
    );
    const found = detectCyclicComponents(records);
    const lines = [
      ...componentLines("runtime", found.runtime),
      ...componentLines("type-only", found.typeOnly),
    ];
    io.stdout(`${lines.join("\n")}\n`);
    return 0;
  }
  const result = simpleCycles(input.graph as GraphDocument);
  const noun = result.cycles.length === 1 ? "cycle" : "cycles";
  const lines = [`${result.cycles.length} simple ${noun}`];
  for (const c of result.cycles) lines.push(`  ${c.join(" -> ")}`);
  io.stdout(`${lines.join("\n")}\n`);
  if (result.warning) io.stderr(`Warning: ${result.warning}\n`);
  return 0;
}

/** Throws unless the graph is TypeScript/JavaScript: the browser-safety model reads `node:` use. */
function requireTypeScript(input: QueryInput, what: string): void {
  if (input.language !== "typescript") {
    throw new Error(
      `${what} serves TypeScript/JavaScript only; this graph is ${input.language || "unknown"}`,
    );
  }
}

/** The files of the graph. */
function filesOf(input: QueryInput): string[] {
  return fileEntriesOf(input.graph).map(([f]) => f);
}

/**
 * Checks that each Node runtime is a package of the graph. Throws on the first one that is not:
 * a typing error in the list would hide a leak.
 */
function checkRuntimes(input: QueryInput, nodeRuntimes: readonly string[]): void {
  const packages = packagesOf(filesOf(input));
  for (const runtime of nodeRuntimes) {
    if (!packages.includes(runtime)) {
      throw new Error(
        `the Node runtime '${runtime}' is not a package with a src/index.ts entry; the ` +
          `packages are: ${packages.join(", ")}`,
      );
    }
  }
}

/** The forward edges and the direct node use of each file of the graph. */
function safetyModel(input: QueryInput) {
  const entries = fileEntriesOf(input.graph);
  const forward = buildForward(entries, new Set(entries.map(([f]) => f)));
  const { direct } = computeTaint(forward, entries);
  return { forward, direct };
}

/**
 * `node-safety [pkg]`: for each browser-safe package (or for `pkg` only), the files with a
 * `node:` import that its `.` entry reaches. Throws on an unknown package.
 */
export function nodeSafety(
  input: QueryInput,
  pkg: string | undefined,
  nodeRuntimes: readonly string[],
  io: Io,
): number {
  requireTypeScript(input, "node-safety");
  checkRuntimes(input, nodeRuntimes);
  const packages = packagesOf(filesOf(input));
  if (pkg !== undefined && !packages.includes(pkg)) {
    throw new Error(
      `unknown package '${pkg}'; the packages with a src/index.ts entry are: ${packages.join(", ")}`,
    );
  }
  const { forward, direct } = safetyModel(input);
  const lines: string[] = [];
  for (const p of pkg === undefined ? browserSafePackages(filesOf(input), nodeRuntimes) : [pkg]) {
    const leaks = findLeaks(p, forward, direct);
    if (leaks.length === 0) {
      lines.push(`${p}: clean (the . entry reaches no node: code)`);
      continue;
    }
    const noun = leaks.length === 1 ? "file" : "files";
    lines.push(`${p}: ${leaks.length} node: ${noun} reachable from the . entry:`);
    for (const leak of leaks) lines.push(`  ${leak}`);
  }
  io.stdout(lines.length > 0 ? `${lines.join("\n")}\n` : "(no browser-safe package)\n");
  return 0;
}

/**
 * `--emit`: writes `dependency-reverse.json` (the reverse edges) and `node-safety.json` (the
 * browser-safe packages, the files with a `node:` import, and the leaks of each browser-safe
 * package) into the report folder. Every list and key is sorted in code-unit order. The files
 * hold no timestamp, so two runs on one graph give the same bytes.
 */
export function emit(input: QueryInput, nodeRuntimes: readonly string[], io: Io): number {
  requireTypeScript(input, "--emit");
  checkRuntimes(input, nodeRuntimes);
  const { forward, direct } = safetyModel(input);
  const dependentsMap = invert(forward);
  const nodeFiles = sortCodeUnits([...direct].filter(([, d]) => d).map(([file]) => file));
  const safe = browserSafePackages(filesOf(input), nodeRuntimes);
  const leaks: Record<string, string[]> = {};
  for (const pkg of safe) leaks[pkg] = findLeaks(pkg, forward, direct);
  const leakCount = Object.values(leaks).reduce((n, list) => n + list.length, 0);
  const folder = input.out.replace(/\\/g, "/").replace(/\/+$/, "");
  const write = (name: string, value: unknown, summary: string): void => {
    writeReport(resolveUnderRoot(input.root, `${folder}/${name}`), JSON.stringify(value, null, 2));
    io.stdout(`Written: ${folder}/${name} (${summary})\n`);
  };
  const files = Object.keys(dependentsMap).length;
  write("dependency-reverse.json", { dependents: dependentsMap }, plural(files, "file"));
  write(
    "node-safety.json",
    { browserSafePackages: safe, nodeTaintedFiles: nodeFiles, leaks },
    `${plural(nodeFiles.length, "node file")}, ${plural(leakCount, "leak")}`,
  );
  return 0;
}

/** `1 <noun>` or `N <noun>s`. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * `--check-browser-safety`: exit 1 when the `.` entry of a browser-safe package reaches a file
 * with a `node:` import. The failure lines go to standard error.
 */
export function checkBrowserSafety(
  input: QueryInput,
  nodeRuntimes: readonly string[],
  io: Io,
): number {
  requireTypeScript(input, "--check-browser-safety");
  checkRuntimes(input, nodeRuntimes);
  const { forward, direct } = safetyModel(input);
  const safe = browserSafePackages(filesOf(input), nodeRuntimes);
  const failed: string[] = [];
  for (const pkg of safe) {
    const leaks = findLeaks(pkg, forward, direct);
    if (leaks.length > 0) failed.push(`  ${pkg}: ${leaks.join(", ")}`);
  }
  const noun = safe.length === 1 ? "package" : "packages";
  if (failed.length === 0) {
    io.stdout(
      `browser-safety check passed: the . entries of ${safe.length} browser-safe ${noun} ` +
        "reach no node: code.\n",
    );
    return 0;
  }
  io.stderr(
    `browser-safety check FAILED: ${failed.length} of ${safe.length} browser-safe ${noun} ` +
      `reach node: code from the . entry:\n${failed.join("\n")}\n`,
  );
  return 1;
}
