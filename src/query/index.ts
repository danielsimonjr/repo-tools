/**
 * `repo-tools query`: answers structural questions from the depgraph JSON reports, and writes two
 * derived reports (design section 3.5). It reads `dependency-graph.json` and
 * `package-export-surfaces.json`; it never parses source code.
 */

import { OUTPUT_SUBDIR } from "../depgraph/paths.ts";
import type { Io } from "../io-types.ts";
import { parseQueryArgs } from "./args.ts";

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
  try {
    parseQueryArgs(argv, process.cwd());
    throw new Error("the commands are not built yet");
  } catch (err) {
    io.stderr(`repo-tools query: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
