/**
 * The commands of `repo-tools query` that print an answer (design section 3.5). Each command
 * writes its answer to standard output and returns the exit code. A command throws on a user
 * error; the caller prints the message and exits 1.
 */
import { isAbsolutePath, resolveUnderRoot } from "../config.ts";
import type { CyclicComponent } from "../depgraph/types.ts";
import { writeReport } from "../io.ts";
import type { Io } from "../io-types.ts";
import { sortCodeUnits } from "../sort.ts";
import { buildForward, fileEntriesOf, invert, symbolUsers } from "./graph.ts";
import type { QueryInput } from "./load.ts";
import { browserSafePackages, computeTaint, findLeaks, packagesOf } from "./safety.ts";

/** `dependents <file>`: the files that import `file`, one per line. */
export function dependents(input: QueryInput, file: string, io: Io): number {
  if (isAbsolutePath(file)) {
    throw new Error("dependents <file> holds an absolute path; pass a path relative to the root");
  }
  const target = file.replace(/\\/g, "/");
  const entries = fileEntriesOf(input.graph);
  const allFiles = new Set(entries.map(([f]) => f));
  const importers = invert(buildForward(entries, allFiles))[target] ?? [];
  io.stdout(
    importers.length > 0
      ? `${importers.join("\n")}\n`
      : `(no intra-package importers of ${target})\n`,
  );
  return 0;
}

/** `symbol-users <symbol>`: each file that imports `symbol`, with the kind of the edge. */
export function symbolUsersCommand(input: QueryInput, symbol: string, io: Io): number {
  const users = symbolUsers(symbol, fileEntriesOf(input.graph));
  io.stdout(
    users.length > 0
      ? `${users.map((u) => `${u.file}  [${u.from}]`).join("\n")}\n`
      : `(no importers of symbol ${symbol})\n`,
  );
  return 0;
}

/**
 * `is-public <pkg> <symbol>`: PUBLIC or INTERNAL. Throws on a package that is not a key of
 * package-export-surfaces.json; the message lists the keys.
 */
export function isPublic(input: QueryInput, pkg: string, symbol: string, io: Io): number {
  const names = Object.hasOwn(input.surfaces, pkg) ? input.surfaces[pkg] : undefined;
  if (names === undefined) {
    const known = Object.keys(input.surfaces).join(", ");
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

/** `cycles`: the runtime and the type-only cyclic components of the graph (fix F26). */
export function cycles(input: QueryInput, io: Io): number {
  const { runtime, typeOnly } = input.graph.dependencyGraph.cyclicComponents;
  const lines = [...componentLines("runtime", runtime), ...componentLines("type-only", typeOnly)];
  io.stdout(`${lines.join("\n")}\n`);
  return 0;
}

/**
 * Checks that each Node runtime is a package of the graph. Throws on the first one that is not:
 * a typing error in the list would hide a leak.
 */
function checkRuntimes(input: QueryInput, nodeRuntimes: readonly string[]): void {
  const packages = packagesOf(input.graph);
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
  checkRuntimes(input, nodeRuntimes);
  const packages = packagesOf(input.graph);
  if (pkg !== undefined && !packages.includes(pkg)) {
    throw new Error(
      `unknown package '${pkg}'; the packages with a src/index.ts entry are: ${packages.join(", ")}`,
    );
  }
  const { forward, direct } = safetyModel(input);
  const lines: string[] = [];
  for (const p of pkg === undefined ? browserSafePackages(input.graph, nodeRuntimes) : [pkg]) {
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
 * package) into the report folder `out` (relative to `root`). Every list and key is sorted in
 * code-unit order. The files hold no timestamp, so two runs on one graph give the same bytes.
 */
export function emit(
  input: QueryInput,
  root: string,
  out: string,
  nodeRuntimes: readonly string[],
  io: Io,
): number {
  checkRuntimes(input, nodeRuntimes);
  const { forward, direct } = safetyModel(input);
  const dependentsOf = invert(forward);
  const nodeFiles = sortCodeUnits([...direct].filter(([, d]) => d).map(([file]) => file));
  const safe = browserSafePackages(input.graph, nodeRuntimes);
  const leaks: Record<string, string[]> = {};
  for (const pkg of safe) leaks[pkg] = findLeaks(pkg, forward, direct);
  const leakCount = Object.values(leaks).reduce((n, list) => n + list.length, 0);
  const folder = out.replace(/\\/g, "/").replace(/\/+$/, "");
  const write = (name: string, value: unknown, summary: string): void => {
    writeReport(resolveUnderRoot(root, `${folder}/${name}`), JSON.stringify(value, null, 2));
    io.stdout(`Written: ${folder}/${name} (${summary})\n`);
  };
  const files = Object.keys(dependentsOf).length;
  write("dependency-reverse.json", { dependents: dependentsOf }, plural(files, "file"));
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
  checkRuntimes(input, nodeRuntimes);
  const { forward, direct } = safetyModel(input);
  const safe = browserSafePackages(input.graph, nodeRuntimes);
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
