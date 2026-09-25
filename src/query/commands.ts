/**
 * The commands of `repo-tools query` that print an answer (design section 3.5). Each command
 * writes its answer to standard output and returns the exit code. A command throws on a user
 * error; the caller prints the message and exits 1.
 */
import { isAbsolutePath } from "../config.ts";
import type { CyclicComponent } from "../depgraph/types.ts";
import type { Io } from "../io-types.ts";
import { buildForward, fileEntriesOf, invert, symbolUsers } from "./graph.ts";
import type { QueryInput } from "./load.ts";

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
