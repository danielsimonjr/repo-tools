# repo-tools

`repo-tools` is one command-line tool with four subcommands for TypeScript repositories:

| Subcommand | Job |
|---|---|
| `depgraph` | Writes the dependency graph and the architecture reports of a TypeScript tree. |
| `chunk` | Splits a large file into chunks, merges the chunks back, and shows which chunks changed. |
| `compress` | Writes a compact copy of a file for a model context, and restores it. |
| `query` | Answers structural questions from the depgraph reports, and writes two derived reports. |

Status: pre-release. No version is published yet.

- All four subcommands work.
- `depgraph` and `query` read their settings from `repo-tools.config.json` in the root.
  `depgraph --config=<file>` reads another file.
- `compress -d` restores JSON files only.

## Run

Run the tool from source with Bun:

```sh
bun install
bun src/bin.ts --help
```

## Build an executable

The compiled executable is the main product: one file that holds the tool and the Bun runtime.
It needs no Bun, Node or `node_modules` on the machine that runs it.

Prerequisites: Bun 1.4.2 or later, and a clone of this repository.

1. Install the dependencies from the lockfile:

   ```sh
   bun install --frozen-lockfile
   ```

   Do this after every pull. The executable bundles the installed dependencies. With an old
   `node_modules`, the build can succeed and the executable then fails (for example, `depgraph`
   stops at its js-yaml check).

2. Compile the executable for this computer:

   ```sh
   bun run compile
   ```

   To compile for another platform, give the target:

   ```sh
   bun scripts/build.ts --compile --target bun-linux-x64
   ```

   The file goes into `bin/`. Use `--outdir <dir>` to choose another folder.

   | Target | File | Size (about) |
   |---|---|---|
   | `bun-windows-x64` | `bin/repo-tools-windows-x64.exe` | 86 MB |
   | `bun-linux-x64` | `bin/repo-tools-linux-x64` | 82 MB |
   | `bun-darwin-arm64` | `bin/repo-tools-darwin-arm64` | 62 MB |

3. Run the executable:

   ```sh
   bin/repo-tools-windows-x64.exe --version
   bin/repo-tools-windows-x64.exe depgraph --root=path/to/repo
   ```

   On Linux and macOS, a downloaded executable has no execute bit. Run
   `chmod +x repo-tools-<os>-<arch>` first.

4. Test the executable, not only the source. The executable is the artifact that ships:

   ```sh
   bun run smoke -- bin/repo-tools-windows-x64.exe
   ```

`bun run build` writes a second channel, the Node bundle `dist/cli.js` (`node dist/cli.js --help`).

## Reports

`repo-tools depgraph` writes its reports into `docs/architecture/` under the root. Every file is
generated: do not edit it by hand. Run `repo-tools depgraph` again to update it. Each Markdown
report starts with a "GENERATED FILE -- do not edit by hand" banner.

| File | What it answers |
|---|---|
| `DEPENDENCY_GRAPH.md` | How do the files and modules depend on each other? Per-file imports and exports, the dependency matrix, cyclic components (runtime and type-only), a Mermaid diagram, and statistics. |
| `dependency-graph.json` | The same graph as data, for tools: modules, files, imports, exports, entry points, cyclic components and statistics. |
| `dependency-graph.yaml` | The same data as YAML. |
| `dependency-summary.compact.json` | A small summary of the graph, with short keys, to give to a model. |
| `unused-analysis.md` | Which files and exports does nothing import? Dormant files, split into orphans (reachable from nothing) and test-only files. |
| `FILE_INVENTORY.md` | Where is every `.ts` file, and what is it? Area and disposition (reachable, build entry, test-only, orphan, test, tool, config, example, bench), and the result of the census self-check. |
| `file-inventory.json` | The same inventory as data. |
| `TEST_COVERAGE.md` | Which source files does a test import (directly, through a barrel, or through a side-effect import), and which files does no test reach? |
| `test-coverage.json` | The same coverage data, with the test-to-source map. |
| `duplicate-symbols.md` | Which names do two or more files define? Each name is classified. |
| `duplicate-symbols.json` | The same duplicate data as data. |
| `package-export-surfaces.json` | Which names does each package export publicly? |

`repo-tools query --emit` writes two more files into the same folder. They are also generated.

| File | What it answers |
|---|---|
| `dependency-reverse.json` | Which files import each file? The reverse edges of the graph. |
| `node-safety.json` | Which packages are browser-safe, which files import a `node:` builtin, and which of those files does the `.` entry of each browser-safe package reach? |

## Query the graph

`repo-tools query` answers questions from `dependency-graph.json` and
`package-export-surfaces.json`. It parses no source file, so run `repo-tools depgraph` first.
The examples use a copy of `tests/fixtures/depgraph/mono-repo`:

```sh
repo-tools depgraph
repo-tools query dependents packages/core/src/math.ts
# packages/core/src/index.ts
# packages/core/src/worker.ts
repo-tools query symbol-users add
# packages/cli/src/main.ts  [@scope/core]
# packages/core/src/index.ts  [internal]
repo-tools query is-public packages/core add
# PUBLIC: add is exported from packages/core
repo-tools query is-public packages/core double
# INTERNAL: double is not in the public export surface of packages/core
repo-tools query cycles
# runtime: 0 cyclic components
# type-only: 0 cyclic components
```

A package is the folder above a `src/index.ts` entry (`.` for the root entry). Each package is
browser-safe, unless `--node-runtime=<pkg,...>` or the config key `query.nodeRuntimes` lists it.
The `.` entry of a browser-safe package must not reach a file that imports a `node:` builtin:

```sh
repo-tools query node-safety
# packages/core: clean (the . entry reaches no node: code)
repo-tools query --check-browser-safety
# browser-safety check passed: the . entries of 1 browser-safe package reach no node: code.
repo-tools query --emit
# Written: docs/architecture/dependency-reverse.json (3 files)
# Written: docs/architecture/node-safety.json (0 node files, 0 leaks)
```

`--check-browser-safety` exits 1 on a leak. The query reads its reports from `--out`, else from
the config key `query.out`, else from `depgraph.out`, else from `docs/architecture`. Run
`repo-tools query --help` for every option.

## Develop

| Command | Job |
|---|---|
| `bun test` | Runs the unit tests. |
| `bun run typecheck` | Runs the TypeScript type check. |
| `bun run lint` | Runs the lint and format check. |
| `bun run build` | Writes the Node bundle `dist/cli.js`. |
| `bun run compile` | Writes the compiled executable for this platform into `bin/`. |
| `bun run smoke -- <command...>` | Runs the smoke test against one way to run the tool. |
| `bun run privacy` | Runs the privacy check on the tracked files and the commit messages. |
| `bun run hooks` | Installs the `commit-msg` hook that runs the privacy check on each message. |

## License

MIT. See `LICENSE`.
