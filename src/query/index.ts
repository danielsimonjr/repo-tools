/**
 * `repo-tools query`: answers structural questions from the depgraph JSON reports, and writes two
 * derived reports (design section 3.5). It reads `dependency-graph.json` and
 * `package-export-surfaces.json`; it never parses source code.
 */

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfigSections, mergeQueryConfig } from "../config.ts";
import { maskRoot, OUTPUT_SUBDIR } from "../depgraph/paths.ts";
import type { Io } from "../io-types.ts";
import { parseQueryArgs } from "./args.ts";
import { cycles, dependents, isPublic, symbolUsersCommand } from "./commands.ts";
import { loadQueryInput } from "./load.ts";

/** The help text of `repo-tools query`. */
export const QUERY_HELP = `Usage: repo-tools query <command> [options]
       repo-tools query --emit | --check-browser-safety [options]

Answer structural questions from the reports of repo-tools depgraph. The query
reads dependency-graph.json and package-export-surfaces.json in the report
folder; it parses no source file. Run repo-tools depgraph first.

Commands:
  dependents <file>         Files that import <file> (a root-relative path).
  symbol-users <symbol>     Files that import <symbol>, in any package.
  is-public <pkg> <symbol>  Is <symbol> in the public export surface of <pkg>?
                            <pkg> is a key of package-export-surfaces.json.
  node-safety [pkg]         Files that use node: builtins and are reachable
                            from the . entry of a browser-safe package (default:
                            each browser-safe package).
  cycles                    The cyclic components (runtime and type-only).

Modes:
  --emit                    Write dependency-reverse.json (reverse edges) and
                            node-safety.json (node taint and browser-safety
                            leaks) into the report folder.
  --check-browser-safety    Exit 1 when the . entry of a browser-safe package
                            reaches a file that uses a node: builtin.

Options:
  --root=<path>             Project root (default: the current directory).
  --out=<dir>               Report folder, relative to the root (default: config
                            query.out, then depgraph.out, then ${OUTPUT_SUBDIR}).
  --node-runtime=<pkg,...>  Packages that run on Node only: their . entry can
                            use node: builtins (default: config
                            query.nodeRuntimes, then none). Every other package
                            with a src/index.ts entry is browser-safe.
  --help, -h                Show this help.

A package is the folder above its src/index.ts entry, for example packages/core;
the package of the root src/index.ts is ".".

Exit codes: 0 on success. 1 on an unknown command or flag, a missing argument,
a flag without its value or an invalid value, a missing or unreadable report,
or a browser-safety leak with --check-browser-safety.
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
    const config = mergeQueryConfig({ out: options.out }, loadConfigSections(root));
    const input = loadQueryInput(root, config.out);
    const sinks: Io = { stdout: io.stdout, stderr };
    const command = options.command;
    switch (command.name) {
      case "dependents":
        return dependents(input, command.file, sinks);
      case "symbol-users":
        return symbolUsersCommand(input, command.symbol, sinks);
      case "is-public":
        return isPublic(input, command.pkg, command.symbol, sinks);
      case "cycles":
        return cycles(input, sinks);
      default:
        throw new Error(`${command.name} is not built yet`);
    }
  } catch (err) {
    stderr(`repo-tools query: ${err instanceof Error ? err.message : String(err)}
`);
    return 1;
  }
}
