# repo-tools

`repo-tools` is one command-line tool with these subcommands for repositories:

| Subcommand | Job |
|---|---|
| `map` | Writes the dependency graph and the architecture reports of a TypeScript/JavaScript, Python, C# or Rust repository. |
| `depgraph` | The deprecated alias of `map` (through 2.x). |
| `check` | Checks the `## Verification` tables of Markdown documents against a fresh graph, and fails on drift. |
| `docs` | Measures the doc comments of TypeScript, JavaScript and Python files, plans the missing ones, and gates the result. |
| `chunk` | Splits a large file into chunks, merges the chunks back, and shows which chunks changed. |
| `compress` | Writes a compact copy of a file for a model context, and restores it. |
| `query` | Answers structural questions from the graph of `map`, and writes two derived reports. |
| `ste` | Checks Markdown or docstring prose against Simplified Technical English. |

Status: version 2.2.1.

- `map`, `check` and `query` read their settings from `repo-tools.config.json` in the root. The
  section of `map` is `map` (its old name, `depgraph`, is also read). `--config=<file>` makes any
  of the three read another file.
- `repo-tools depgraph` prints one deprecation line and runs `map`. It accepts the 1.x
  scan-scope flags (`--src`, `--tests`, `--exclude`, `--also-exclude`, `--all`,
  `--reachable-only`, `--include-tests`) with a warning, because they have no effect in 2.0.0.
  `map` exits 1 on them.
- `compress -d` restores JSON files only.

## Install

Install one of the two forms.

### npm package

The npm package needs Node 20 or later:

```sh
npm i -g @danielsimonjr/repo-tools
repo-tools --version
```

### Compiled executable

The executable holds the tool and the Bun runtime. It needs no Bun, Node or `node_modules`.
Download the file for your platform and `SHA256SUMS` from the
[GitHub release](https://github.com/danielsimonjr/repo-tools/releases/tag/v2.2.1):

| Platform | File |
|---|---|
| Windows x64 | `repo-tools-windows-x64.exe` |
| Linux x64 | `repo-tools-linux-x64` |
| macOS arm64 | `repo-tools-darwin-arm64` |

Verify the file against `SHA256SUMS` before you run it:

```sh
# Linux
sha256sum --ignore-missing -c SHA256SUMS
# macOS: compare the output with the line of the file in SHA256SUMS
shasum -a 256 repo-tools-darwin-arm64
# Windows (PowerShell): compare the output with the line of the file in SHA256SUMS
Get-FileHash repo-tools-windows-x64.exe -Algorithm SHA256
```

On Linux and macOS, a downloaded file has no execute bit. The executable is not signed, so macOS
also marks a file that a browser downloads. Run these commands before the first run:

```sh
chmod +x repo-tools-linux-x64            # or repo-tools-darwin-arm64
xattr -d com.apple.quarantine repo-tools-darwin-arm64   # macOS only
```

## Run from source

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

   Do this after every pull. The executable bundles the installed dependencies, so the build
   first compares `node_modules` with `bun.lock`. On a difference, the build stops with exit 1
   and names each package. A frozen install does not remove a package that `bun.lock` no longer
   names. When the build names such a package, remove `node_modules` and install again.

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
   bin/repo-tools-windows-x64.exe map --root=path/to/repo
   ```

4. Test the executable, not only the source. The executable is the artifact that ships:

   ```sh
   bun run smoke -- bin/repo-tools-windows-x64.exe
   ```

`bun run build` writes a second channel, the Node bundle `dist/cli.js` (`node dist/cli.js --help`),
with the tree-sitter grammar files (`dist/*.wasm`) next to it.

## Reports

`repo-tools map` writes its reports into `docs/architecture/` under the root (`--out=<dir>`
names another folder; `--out=../reports` writes outside the root). Every file is generated: do
not edit it by hand. Run `repo-tools map` again to update it. Each Markdown report starts with
a "GENERATED FILE -- do not edit by hand" banner.

The census is the set of source files that git tracks (outside a git work tree, a pruned walk).
The language with the most files decides how `map` reads the repository. Input files never come
from the output folder. The duplicate allowlist, the duplicate baseline and the coverage policy
are in `docs/architecture/`, or at the path that the config gives. A repository that already has
its own allowlist must set `map.duplicateAllowlist` (the old key `depgraph.duplicateAllowlist`
is also read) to that file. Mathts has 283 allowlisted names. With the default path, the
duplicate gate fails on those names.

A literal relative `import()` is a graph edge. The Python `repo_map.py` records none. The parity
record in `docs/parity-2.0.0.md` gives the rules and the verdict.

| File | What it answers |
|---|---|
| `dependency-graph.json` | The core graph: each file by area, with its imports, exports and edges; the reachability; the cycle counts; and the statistics. |
| `file-inventory.json` | Where is each source file, and what is it? Package, area and disposition (reachable, build entry, test-only, orphan, test, tool, config, example, bench), and the links that the census did not follow. |
| `duplicate-symbols.json` | Which names do two or more files define? For TypeScript, also the classified lists. |
| `unused-analysis.json` | Which exports and files does nothing import? |
| `dependency-layers.json` | The subsystem view: the `src` files by module, the entry points, the layers and the cyclic components. |
| `DEPENDENCY_GRAPH.md` | How do the files and modules depend on each other? Per-file imports and exports, the dependency matrix, cyclic components (runtime and type-only), a Mermaid diagram, and statistics. |
| `dependency-graph.yaml` | `dependency-graph.json` as YAML. |
| `dependency-summary.compact.json` | A small summary of the graph, with short keys, to give to a model. |
| `FILE_INVENTORY.md`, `duplicate-symbols.md`, `unused-analysis.md` | The three JSON reports above, for a person to read. |
| `TEST_COVERAGE.md` | Which source files does a test load (directly, through a barrel, through a side-effect import, or by `import()`), and which files does no test reach? |
| `test-coverage.json` | The same coverage data, with the test-to-source map. |
| `package-export-surfaces.json` | Which names does each package export publicly? Not written for C#. |

`docs/parity-2.0.0.md` records how these reports compare with the Python tool and with
depgraph 1.x.

`repo-tools query --emit` writes two more files into the same folder. They are also generated.

| File | What it answers |
|---|---|
| `dependency-reverse.json` | Which files import each file? The reverse edges of the graph. |
| `node-safety.json` | Which packages are browser-safe, which files import a `node:` builtin, and which of those files does the `.` entry of each browser-safe package reach? |

## Check the documents against the graph

`repo-tools check --docs=<dir>` reads every `*.md` file of the folder. The check reads the
`## Verification` table of each document. Each row `| claim | value | source |` names a metric of
the graph (`totalFiles`, `orphanedFiles`, `runtimeCircularDeps` and so on). The value is the
number that the document states. The check builds the graph again, so a stale report cannot hide
drift. A relative `--docs` path is relative to the root.

```md
## Verification

| Claim | Value | Source |
|---|---|---|
| totalFiles | 243 | file-inventory.json |
```

```sh
repo-tools check --docs=docs/architecture
# check passed: every claim matches the graph (1 claim in 1 document).
```

When a value drifts, the exit code is 1, and standard error lists every problem, one per line:

```text
OVERVIEW.md: totalFiles claims 243 but actual is 244
```

A document passes without a check when one of its lines is exactly
`<!-- repo-map:no-verification -->`. The marker must stand alone on its line: a marker inside a
sentence, a code span or a table cell does not count.
`repo-tools map` writes that line at the top of each generated report. Every other gap is a
failure. A missing docs folder, a folder with no `*.md` file, a document without a Verification
section, and a section without a row are failures. An unknown claim name is a failure too. So is a
metric that the graph build declared unreliable. `docs/design.md` (section 15) gives the rules and the
differences from the Python tool. `docs/parity-check.md` records the comparison with that tool on
11 repositories.

## Gate the documentation comments

`repo-tools docs` reads the TypeScript, JavaScript and Python files that git tracks. It finds each
function, class, interface, type alias and method, and the doc comment of each one. It needs no
Python on the computer.

```sh
repo-tools docs scan .                      # writes docs/code-docs/COVERAGE.md and coverage.json
repo-tools docs check .                     # the gate: exit 1 on a MUST issue
repo-tools docs stub . --path=src/api       # a dry run: lists the stubs and writes nothing
repo-tools docs stub . --path=src/api --apply
```

The rules are:

| Rule | Tier | The rule |
|---|---|---|
| M1 | MUST | An exported symbol has a doc comment. A test file is exempt. |
| M2 | MUST | The doc comment has a summary line. |
| M3 | MUST | The doc comment names no parameter that the signature lacks. |
| M4 | MUST | The doc comment holds no `TODO:` marker. |
| M5 | MUST | A file uses one doc dialect: `google`, `numpy` or `rest` for Python, `tsdoc` or `jsdoc` for TypeScript. |
| S2 | SHOULD | The summary ends with a full stop. |
| S5 | SHOULD | The doc comment does not repeat a type that the signature holds. |
| S6 | SHOULD | The prose follows Simplified Technical English (the rules of `repo-tools ste`). |

Only a MUST issue changes the exit code of `check`. A file that does not parse is also a failure,
because an unknown file is not a clean file. A repository with no source file fails too.

`stub` is a dry run until you pass `--apply`. Each stub holds the marker `TODO:`, so `check` fails
until you replace the stub with real prose. The command parses a file again after the change.
A file that would no longer parse stays unchanged. The command skips a file that is a link or
resolves outside the root, and it names the skipped file.

To gate a pull request and not the whole backlog, give `check` the changed files:

```sh
git diff --name-only origin/main... > changed.txt
repo-tools docs check . --paths-from=changed.txt
```

A `.code-docs.json` file at the root excludes paths. Each entry needs a reason, and the output
names each exclusion:

```json
{ "exclude": [ { "path": "assembly/", "reason": "AssemblyScript" } ] }
```

`docs/design.md` (section 16) gives the rules, the exit codes and the differences from the Python
tool. `docs/parity-docs.md` records the comparison with that tool on 9 repositories.

## Query the graph

`repo-tools query` answers questions from `dependency-graph.json` (and
`package-export-surfaces.json` for `is-public`). It parses no source file, so run
`repo-tools map` first. It reads each area of the graph, and a path that is not a file of the
graph exits 1. The examples use a copy of `tests/fixtures/depgraph/mono-repo`:

```sh
repo-tools map
repo-tools query dependents packages/core/src/math.ts
# packages/core/src/index.ts
# packages/core/src/worker.ts
# packages/core/tests/math.test.ts
repo-tools query symbol-users add
# packages/cli/src/main.ts
# packages/core/src/index.ts
# packages/core/tests/math.test.ts
repo-tools query is-public packages/core add
# PUBLIC: add is exported from packages/core
repo-tools query is-public packages/core double
# INTERNAL: double is not in the public export surface of packages/core
repo-tools query cycles
# 0 simple cycles
repo-tools query cycles --components
# runtime: 0 cyclic components
# type-only: 0 cyclic components
```

The browser-safety commands serve TypeScript/JavaScript only. A package is the folder above a
`src/index.ts` file (`.` for the root file). Each package is
browser-safe, unless `--node-runtime=<pkg,...>` or the config key `query.nodeRuntimes` lists it.
The `.` entry of a browser-safe package must not reach a file that imports a `node:` builtin:

```sh
repo-tools query node-safety
# packages/core: clean (the . entry reaches no node: code)
repo-tools query --check-browser-safety
# browser-safety check passed: the . entries of 1 browser-safe package reach no node: code.
repo-tools query --emit
# Written: docs/architecture/dependency-reverse.json (4 files)
# Written: docs/architecture/node-safety.json (0 node files, 0 leaks)
```

`--check-browser-safety` exits 1 on a leak. The query reads its reports from `--out`, else from
the config key `query.out`, else from `map.out`, else from `docs/architecture`. Run
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
| `bun run audit:ledger` | Reverts each fix of `docs/fix-ledger-2.0.0.md` in a scratch copy and checks that a test of that fix fails. |
| `bun run check:design` | Finds each reference to a section of `docs/design.md` that has no heading with that number. |

## Design

`docs/design.md` describes the modules, the output rules, the config, the extension contract,
the privacy check and the verification. Its section "The 2.0.0 engine" describes `map`.

## License

MIT. See `LICENSE`.
