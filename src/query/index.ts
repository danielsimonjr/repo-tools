/**
 * `repo-tools query`: answers structural questions from the core graph that `repo-tools map`
 * writes, and writes two derived reports (design section 3.5, design decision D8). It reads
 * `dependency-graph.json` (and `package-export-surfaces.json` for `is-public`); it never parses
 * source code.
 */

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfigSections, mergeQueryConfig } from "../config.ts";
import { maskRoot, OUTPUT_SUBDIR } from "../depgraph/paths.ts";
import type { Io } from "../io-types.ts";
import { parseQueryArgs } from "./args.ts";
import {
  checkBrowserSafety,
  cycles,
  dependents,
  emit,
  isPublic,
  nodeSafety,
  symbolUsersCommand,
} from "./commands.ts";
import { loadQueryInput } from "./load.ts";

/** The help text of `repo-tools query`. */
export const QUERY_HELP = `Usage: repo-tools query <command> [options]
       repo-tools query --emit | --check-browser-safety [options]

Answer structural questions from the core graph of repo-tools map. The query
reads dependency-graph.json (and package-export-surfaces.json for is-public)
in the report folder; it parses no source file. Run repo-tools map first. A
1.x graph is refused.

Commands:
  dependents <file>         Files that import <file> (a root-relative path), in
                            every area. A path that is not a file of the graph
                            exits 1.
  symbol-users <symbol>     Files whose internal imports name <symbol>.
  is-public <pkg> <symbol>  Is <symbol> in the public export surface of <pkg>?
                            <pkg> is a key of package-export-surfaces.json.
  node-safety [pkg]         Files that use node: builtins and are reachable
                            from the . entry of a browser-safe package (default:
                            each browser-safe package). TypeScript/JavaScript.
  cycles [--components]     Every simple cycle of the internal edges (capped; a
                            capped list is a floor, and a warning says so). With
                            --components: the runtime and the type-only
                            strongly connected components.

Modes (TypeScript/JavaScript):
  --emit                    Write dependency-reverse.json (reverse edges) and
                            node-safety.json (node taint and browser-safety
                            leaks) into the report folder.
  --check-browser-safety    Exit 1 when the . entry of a browser-safe package
                            reaches a file that uses a node: builtin.

Options:
  --root=<path>             Project root (default: the current directory).
  --config=<path>           Config file, relative to the root (default:
                            repo-tools.config.json at the root, when it exists).
                            An unknown key, an absolute path or invalid JSON exits 1.
  --out=<dir>               Report folder, relative to the root (default: config
                            query.out, then map.out, then ${OUTPUT_SUBDIR}).
  --node-runtime=<pkg,...>  Packages that run on Node only: their . entry can
                            use node: builtins (default: config
                            query.nodeRuntimes, then none). Every other package
                            with a src/index.ts file is browser-safe.
  --help, -h                Show this help.

A package is the folder above its src/index.ts file, for example packages/core;
the package of the root src/index.ts is ".".

Exit codes: 0 on success. 1 on an unknown command or flag, a missing argument,
a flag without its value or an invalid value, a missing, unreadable or 1.x
report, a path that is not a file of the graph, a browser-safety command on a
graph that is not TypeScript/JavaScript, or a browser-safety leak with
--check-browser-safety.
`;

/** Runs `repo-tools query` and returns the exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  // Design criterion 4: standard error shows the root as `<root>`, never as an absolute path.
  let root: string | undefined;
  const stderr = (text: string): void => io.stderr(root ? maskRoot(text, root) : text);
  try {
    const options = parseQueryArgs(argv, process.cwd());
    root = resolve(options.root);
    if (!(existsSync(root) && statSync(root).isDirectory())) {
      throw new Error("the root <root> is not an existing directory");
    }
    const config = mergeQueryConfig(
      { out: options.out, nodeRuntimes: options.nodeRuntimes },
      loadConfigSections(root, options.config),
    );
    const input = loadQueryInput(root, config.out);
    const sinks: Io = { stdout: io.stdout, stderr };
    for (const warning of input.warnings)
      stderr(`Warning: ${warning}
`);
    const command = options.command;
    switch (command.name) {
      case "dependents":
        return dependents(input, command.file, sinks);
      case "symbol-users":
        return symbolUsersCommand(input, command.symbol, sinks);
      case "is-public":
        return isPublic(input, command.pkg, command.symbol, sinks);
      case "cycles":
        return cycles(input, command.components === true, sinks);
      case "node-safety":
        return nodeSafety(input, command.pkg, config.nodeRuntimes, sinks);
      case "check-browser-safety":
        return checkBrowserSafety(input, config.nodeRuntimes, sinks);
      case "emit":
        return emit(input, config.nodeRuntimes, sinks);
    }
  } catch (err) {
    stderr(`repo-tools query: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
