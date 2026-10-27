# repo-tools Architecture

## Purpose of this document

This document explains why `repo-tools` has its present shape. [OVERVIEW.md](OVERVIEW.md) gives the
counts. [COMPONENTS.md](COMPONENTS.md) describes each module. [DATAFLOW.md](DATAFLOW.md) traces one
run. This document gives the layers, the decisions and the reasons for them.

## System context

`repo-tools` runs as one process. It reads a repository from the file system, and it reads `git`
output for the list of tracked files. The program writes report files into one output folder. The program makes no
network call.

```
 caller (shell, CI job, agent)
        │  argv, working folder
        ▼
 ┌────────────────────────────────────────────────────────────┐
 │ src/bin.ts   process entry: argv, stdout, stderr, exit code │
 │ src/cli.ts   registry of nine subcommands, help, version    │
 └───────┬──────────────┬─────────────┬───────────────────────┘
         ▼              ▼             ▼
   graph family    text family    file family
   map, check,     docs, ste,     chunk, compress
   query, clones   (prose rules)
         │              │             │
         ▼              ▼             ▼
 ┌────────────────────────────────────────────────────────────┐
 │ shared core: config, io, mask, py, sort, depgraph/*        │
 └────────────────────────────────────────────────────────────┘
         │
         ▼
 file system · `git ls-files` · tree-sitter grammars (.wasm)
```

The callers are a person at a shell, a CI job and a coding agent. All three use the same command
line. A caller reads the exit code and the files in the output folder.

## Layers

| Layer | Modules | Rule |
|---|---|---|
| Entry | `src/bin.ts`, `src/cli.ts` | Only `bin.ts` touches `process`. `cli.ts` receives an `Io` value. |
| Subcommand | `src/map/command.ts`, `src/check/index.ts`, `src/query/index.ts`, `src/clones/index.ts`, `src/docs/index.ts`, `src/ste/index.ts`, `src/chunk/index.ts`, `src/compress/index.ts` | Each exports `run(argv, io)` and a help text. No subcommand imports `cli.ts`. |
| Engine | `src/map/*`, `src/depgraph/*` | Builds a graph and the reports. Used by four subcommands. |
| Shared core | `src/config.ts`, `src/io.ts`, `src/mask.ts`, `src/py.ts`, `src/sort.ts` | No import of a subcommand. |

The engine layer holds two folders for a historical reason. `src/depgraph/` is the earlier
engine. It holds the analyzers, the reporters and the argument parser. `src/map/` is the engine that
reads five languages and writes the current graph schema. It adapts its graph to the `depgraph` types
(`src/map/adapter.ts`) and reuses the analyzers and reporters. The `depgraph` subcommand is a
deprecated alias of `map`.

## Key decisions

### Decision 1: one program with nine subcommands

**Decision.** One executable holds every tool. `src/cli.ts` keeps one registry object. Each entry
has a summary, a help text and a `run` function.

**Rationale.** The tools share the walker, the masker, the config loader and the sort order. One
program has one version and one install. A caller learns one command-line style.

**Trade-offs.** The bundle is larger than one tool. A defect in a shared module affects every
subcommand. The test suite must cover each subcommand through the registry for that reason.

### Decision 2: the entry function takes `Io`, not `process`

**Decision.** `main(argv, io)` and each `run(argv, io)` receive `{ stdout, stderr }` as functions.
Only `src/bin.ts` binds them to `process.stdout` and `process.stderr`.

**Rationale.** A test calls `main` with two collecting functions. It checks the exit code and the
text with no child process. The same code runs under Node.js and under Bun.

**Trade-offs.** A subcommand must not call `console.log`. A reviewer finds a violation with a search.

### Decision 3: a census of the files that git tracks

**Decision.** The graph covers the source files that `git ls-files` lists. Outside a git work tree,
a pruned walk finds the files. The walk skips links.

**Rationale.** A tracked file is a file of the project. Build output, installed packages and
scratch files stay out, with no ignore list to keep. `map --strict-census` fails when a source file
exists on disk and is not in the census.

**Trade-offs.** An untracked new file does not appear until the author adds it. The census check
reports the gap as a warning, and it fails with `--strict-census`.

### Decision 4: one language for each repository

**Decision.** `detectLanguage` counts the source files of each language and picks the largest
count. A repository with no readable language is an error. The run writes no output.

**Rationale.** One resolver and one reader apply to one graph. A mixed graph would hide that a
count is a count of one language. A refusal is safer than a number about the wrong files.

**Trade-offs.** A repository with two large languages gets a graph of one. The `metadata.language`
field names the choice, and a reader must check it before trusting a count.

### Decision 5: tree-sitter grammars for TypeScript, TSX and Python

**Decision.** `src/map/grammars.ts` loads the grammars from four `.wasm` files. Parsers read
TypeScript, JavaScript and Python. The C# and Rust readers use text rules in
`src/map/parsing.ts`.

**Rationale.** A grammar parse sees the import forms that a regular expression misses. A text rule
is enough for the C# `using` and the Rust `mod` and `use` forms that decide the edges.

**Trade-offs.** The package ships four binary files next to the bundle. A grammar loads in
asynchronous code, so `buildGraph` is asynchronous.

### Decision 6: deterministic output

**Decision.** Every report is LF text with one final newline, with no timestamp and no absolute
path. Every sort uses UTF-16 code-unit order (`src/sort.ts`). JSON and YAML writers use fixed
formats (`pyJsonDumps`, `generateYaml`).

**Rationale.** A report in git changes only when the code changes. A reviewer reads a diff of a
generated file as a diff of the repository. The same tree gives the same bytes on all three
operating systems.

**Trade-offs.** The program cannot use the locale sort or `Date`. The JSON writer copies the format
of an earlier Python tool, so a few rules look unusual.

### Decision 7: a gate that compares documents with a fresh graph

**Decision.** `repo-tools check` builds the graph again. It compares each `| claim | value | source |`
row of a Verification table with the measured value.

**Rationale.** A stale report on disk cannot hide drift. A claim name that the tool does not know
is an error, so a misspelled metric does not pass.

**Trade-offs.** The gate costs one full graph build. It checks only the numbers that the graph
holds. A hand-checked fact needs its own source line in the text.

### Decision 8: unknown input is an error

**Decision.** An unknown flag, an unknown config key, a value of the wrong kind and an absolute
path each stop the run. `src/config.ts` checks every key against a table of kinds.

**Rationale.** A silent default hides a misspelled setting. A committed config file with an absolute
path would hold one user's folder. The error text names the key and never the value.

**Trade-offs.** A new setting needs a table entry before a config file can use it.

### Decision 9: repository-specific rules live in extensions

**Decision.** The core holds no name of a consumer repository. A repository adds behaviour with an
`.mjs` module that `map.extensions` lists. The module exports `preflight` and `report` hooks.

**Rationale.** The core stays reusable. A hook receives a read-only copy of the configuration
(`readOnlyCopy`), so it cannot change the run.

**Trade-offs.** An extension is code that runs with the rights of the user. `--no-extensions`
turns all of them off.

### Decision 10: the public surface is the command line

**Decision.** `package.json` has a `bin` entry and no `main` or `exports` field. The files that
the package ships are `dist/cli.js`, `dist/*.wasm`, the license, the readme and the changelog.

**Rationale.** The program is a tool, not a library. An internal export is free to change. The
exports that no other file uses are therefore not defects.

**Trade-offs.** A caller who wants a function must run the command and read its files.

## Build and packaging

`scripts/build.ts` bundles `src/bin.ts` into `dist/cli.js` for Node.js 20 or later. The same script,
with `--compile --target=<target>`, builds one executable for each of three targets: `bun-linux-x64`,
`bun-windows-x64` and `bun-darwin-arm64`. The bundle holds the one runtime dependency, `js-yaml`.
`scripts/lockcheck.ts` compares `node_modules` with `bun.lock`.

The CI workflow `ci.yml` has four kinds of job.

| Job | Work |
|---|---|
| `privacy` | Runs `scripts/privacy-check.ts`. The script runs its own self-test first. |
| `test` | Installs with a frozen lock file. Runs type check, lint and `bun test` on Linux, Windows and macOS. |
| `executable` | Builds the bundle and one executable for each target. Runs `scripts/smoke.ts` against the executable, against Node.js and against Bun. Runs `npm pack --dry-run`. |
| `package` | Builds the bundle, packs the package with `npm pack` and writes a SHA-256 list. Uploads the tarball as a workflow artifact. |

Each action is pinned to a commit hash. The workflow has the `contents: read` permission. No job
publishes a package. A second workflow, `build.yml`, runs on a `v*` tag. It checks that the tag
equals the version in `package.json` and builds the three executables. It uploads workflow
artifacts and creates no release.

## Test strategy

| Kind | Where | Method |
|---|---|---|
| Unit | `tests/unit/` | `bun test`. Tests call `main` or `run` with collecting `Io` functions. |
| Fixture | `tests/fixtures/` | Small repositories and files in `chunk`, `compress`, `depgraph` and `extension` folders. |
| Golden | `tests/golden/` | Expected report text for `chunk`, `compress` and `map`. A test compares the bytes. `scripts/update-map-goldens.ts` rewrites the map goldens. |
| Smoke | `scripts/smoke.ts` | Runs a built artifact against a fixture and checks the output. |
| Audit | `scripts/fix-ledger-audit.ts`, `scripts/fix-ledger-mutations.ts`, `scripts/design-refs.ts` | The ledger audit restores one fixed defect in a scratch copy and runs the tests. `design-refs.ts` finds references to a design section that has no heading. |

A fix whose restored defect passes every test has no lock. The audit reports that case.

## Import cycles

The graph has one runtime import cycle: `src/compress/formats.ts` and `src/compress/legend.ts`
import each other. `formats.ts` imports legend functions. `legend.ts` imports the `FileFormat`
type from `formats.ts`, so the second edge is a type name in a signature. The cycle stays inside
one folder.

The graph also has four type-only cycles. A type-only import is erased at build time, so a type-only cycle adds no
load-order risk.

## Unused-code note

`repo-tools map` lists 120 exports that no other file imports, and 2 files with no importer.
[OVERVIEW.md](OVERVIEW.md) explains each class. The decision to keep them follows from Decision 10.

## Verification

Generated by `repo-tools map`.
Regenerate: `repo-tools map . --out=docs/architecture` · Check: `repo-tools check . --docs=docs/architecture`

| Claim | Value | Source |
|---|---|---|
| totalSourceFiles | 289 | dependency-graph.json |
| entryRoots | 1 | dependency-graph.json |
| runtimeCircularDeps | 1 | dependency-graph.json |
| typeOnlyCircularDeps | 4 | dependency-graph.json |
| unusedExportsCount | 120 | dependency-graph.json |
| orphanedFiles | 2 | dependency-graph.json |
