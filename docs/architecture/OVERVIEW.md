# repo-tools Overview

## Project summary

`repo-tools` is one command-line program for the maintenance of a source repository. The program has
nine subcommands. Two of them, `map` and `check`, build a dependency graph of a repository and compare the
architecture documents with that graph. The other subcommands measure documentation comments and find
copied functions. They also answer questions about the graph and check prose against Simplified
Technical English. The last two split or compact large files.

The program targets Node.js 20 or later. It ships in two forms: one ESM bundle (`dist/cli.js`) with
four WebAssembly files next to it, and one compiled executable for each of three platforms. The
executable holds the Bun runtime, so it needs no Node.js on the computer that runs it. The program
has one runtime dependency, `js-yaml`, and the bundle holds it.

The program reads TypeScript, JavaScript, Python, C# and Rust repositories. It uses one language for
one repository: the language with the most source files. A repository in any other language gets an
error and no output.

## Key metrics

Each row gives its scope and its source. The Verification block at the end of this document holds
the rows that the drift gate checks.

| Metric | Value | Scope | Source |
|---|---|---|---|
| Source files, whole repository | 289 | repo-wide | `dependency-graph.json`, `totalSourceFiles` |
| Source files in `src/` | 85 | area `src` | `file-inventory.json`, `byArea` |
| Test files | 193 | area `tests` | `file-inventory.json`, `byArea` |
| Script files | 10 | area `tools` | `file-inventory.json`, `byArea` |
| Lines of code, whole repository | 44494 | repo-wide | `dependency-graph.json`, `totalLinesOfCode` |
| Lines of code in `src/` | 19481 | area `src` | `file-inventory.json`, sum of `loc` |
| Lines of code in `tests/` | 22216 | area `tests` | `file-inventory.json`, sum of `loc` |
| Exports | 716 | repo-wide | `dependency-graph.json`, `totalExports` |
| Functions | 410 | repo-wide | `dependency-graph.json`, `totalFunctions` |
| Interfaces | 140 | repo-wide | `dependency-graph.json`, `totalInterfaces` |
| Classes | 13 | repo-wide | `dependency-graph.json`, `totalClasses` |
| Entry roots | 1 | repo-wide | `dependency-graph.json`, `entryRoots` |
| Runtime import cycles | 1 | repo-wide | `dependency-graph.json`, `runtimeCircularDeps` |
| Type-only import cycles | 4 | repo-wide | `dependency-graph.json`, `typeOnlyCircularDeps` |
| Subcommands | 9 | `src/cli.ts` | A direct read of the registry in `src/cli.ts`. It is not a `repo-tools map` metric. |
| Unit test files | 134 | `tests/unit/` | A direct count of the `*.test.ts` files in `tests/unit/`. It is not a `repo-tools map` metric. |

The counts of source files, functions and exports cover TypeScript only. The test fixtures under
`tests/fixtures/` hold source files that the census counts as test area files. The scope column
states where a figure includes them.

## Directory structure

```
repo-tools/
├── src/                    85 files, 19481 lines. The program.
│   ├── bin.ts              Process entry for the bundle and the executable.
│   ├── cli.ts              Subcommand registry and dispatch.
│   ├── config.ts           The config file: parse, check and merge.
│   ├── io.ts, io-types.ts  Deterministic file output, and the stream type.
│   ├── mask.ts             Blanks comments and strings in source text.
│   ├── py.ts               Python-compatible string helpers and regular-expression parts.
│   ├── sort.ts             Code-unit string order. No other order exists in the program.
│   ├── map/                18 files, 5207 lines. The engine: census, parse, graph, reports.
│   ├── depgraph/           22 files, 4823 lines. Analyzers and reporters that the engine reuses.
│   ├── docs/               9 files, 2227 lines. Doc-comment scan, stub and gate.
│   ├── chunk/              3 files, 1689 lines. Split and merge of large files.
│   ├── compress/           3 files, 1312 lines. Compact copies of files.
│   ├── clones/             6 files, 930 lines. Copied-function finder.
│   ├── query/              6 files, 831 lines. Questions about a graph.
│   ├── ste/                5 files, 770 lines. Simplified Technical English checker.
│   └── check/              4 files, 536 lines. The drift gate of the architecture documents.
├── tests/                  193 files, 22216 lines. Unit tests, fixtures and golden files.
│   ├── unit/               134 test files. Run with `bun test`.
│   ├── fixtures/           Input repositories and files for the tests.
│   └── golden/             Expected output, compared byte for byte.
├── scripts/                10 files, 2791 lines. Build, smoke test, privacy check, audits.
├── docs/
│   ├── design.md           The design of every subcommand.
│   ├── architecture/       These documents, and the reports that `map` writes.
│   └── parity-*.md         Records of the comparison with the earlier Python tools.
└── .github/workflows/      The CI workflow and the build workflow.
```

The counts of `src/` subfolders come from `file-inventory.json`. The nine files directly in `src/`
total 1156 lines.

## Key design principles

1. **Two runs on one tree give the same bytes.** Every report ends with one LF and holds no CR, no
   timestamp and no absolute path. Every sort compares UTF-16 code units. A reviewer finds a violation
   with a search for `localeCompare` and for `new Date`.
2. **Every unknown input is an error.** Each of these inputs stops the run. An unknown flag is one. An unknown config key, a value of the
   wrong kind and an unknown claim name are the others. A silent default hides a misspelled setting.
3. **A gate never reads absence as success.** A missing Verification section, a metric that a warning
   makes unsafe, and a run that examined no file each fail. The gate reports each one in its own words.
4. **Paths are relative to the root.** An absolute path in a flag or in the config file stops the run.
   Messages show the root as `<root>`. No user path reaches a report.
5. **One copy of each rule.** The comment masker, the Simplified Technical English rules and the code
   unit sort each exist once. A subcommand imports them and never copies them.
6. **A subcommand module never imports the dispatcher.** `src/cli.ts` imports the subcommands and no
   subcommand imports `src/cli.ts`. The import graph has no edge in the other direction.
7. **The core holds no path of one consumer repository.** A feature that one repository needs goes
   into an extension in that repository.

## How the code gets loaded

Most modules load through a plain `import`. Five mechanisms differ.

- **The dispatcher.** `src/cli.ts` imports each subcommand module at load time and keeps the entries in
  one registry object. A subcommand runs only when the first argument names it.
- **The grammars.** `src/map/grammars.ts` loads the tree-sitter grammars on demand. A run loads the
  TypeScript, TSX or Python grammar only when the census holds a file of that kind. The loader keeps
  one parser for each grammar.
- **The WebAssembly files.** The four `.wasm` files load through Bun's file loader. The bundle writes
  them next to `dist/cli.js`, and a path resolves against the URL of its module. A path never resolves
  against the working folder.
- **The extensions.** `src/depgraph/extensions.ts` loads each `.mjs` module that the config key
  `map.extensions` lists. The loader calls the `preflight` hook before the first write and the `report`
  hook after the last report. A run with `--no-extensions` loads none.
- **The process entry.** `src/bin.ts` has no importer inside the repository. The build script names it as
  its entry file.

## Unused code

`repo-tools map` reports two files with no importer and 120 exports that no other file uses.

| Item | Why it has no importer |
|---|---|
| `src/bin.ts` | The build script bundles it as the process entry. No source file imports a process entry. |
| `src/assets.d.ts` | A type declaration for `.wasm` imports. The compiler reads it. No `import` names it. |
| 117 exports | Each one has a use inside its own module. The export lets a test or a sibling file reach it. |
| 3 exports | Nothing in the repository references them. The tests and the reports do not name them. |

A count of unused exports is not a deletion list. The repository publishes a package, and an export
of an internal module is not part of the package surface. The package surface is the command line.
A static parser also cannot see a module that only a computed `import()` loads. Verify each item with a
search before you remove it.

## Related documentation

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Why the program has this shape: layers, decisions, build and test strategy. |
| [COMPONENTS.md](COMPONENTS.md) | Each module, with the real signatures of its exports. |
| [DATAFLOW.md](DATAFLOW.md) | How one run of each subcommand moves data, step by step. |
| [API.md](API.md) | The public surface: commands, flags, config keys, exit codes and report formats. |
| [FILE_INVENTORY.md](FILE_INVENTORY.md) | Every source file with its area and disposition. Generated. |
| [TEST_COVERAGE.md](TEST_COVERAGE.md) | The source files that a test imports, and the files that no test imports. Generated. |
| [DEPENDENCY_GRAPH.md](DEPENDENCY_GRAPH.md) | Who imports whom. Generated. |
| [unused-analysis.md](unused-analysis.md) | Files and exports with no importer. Generated. |
| [duplicate-symbols.md](duplicate-symbols.md) | Names that more than one file defines. Generated. |
| [../design.md](../design.md) | The design of each subcommand, section by section. |

## Verification

Generated by `repo-tools map`.
Regenerate: `repo-tools map . --out=docs/architecture` · Check: `repo-tools check . --docs=docs/architecture`

| Claim | Value | Source |
|---|---|---|
| totalSourceFiles | 289 | dependency-graph.json |
| totalLinesOfCode | 44494 | dependency-graph.json |
| totalExports | 716 | dependency-graph.json |
| totalFunctions | 410 | dependency-graph.json |
| totalInterfaces | 140 | dependency-graph.json |
| totalClasses | 13 | dependency-graph.json |
| entryRoots | 1 | dependency-graph.json |
| runtimeCircularDeps | 1 | dependency-graph.json |
| typeOnlyCircularDeps | 4 | dependency-graph.json |
| orphanedFiles | 2 | dependency-graph.json |
| unusedExportsCount | 120 | dependency-graph.json |
