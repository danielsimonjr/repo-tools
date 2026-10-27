# repo-tools Data Flow

This document traces one run of each subcommand from the command line to the exit code. Each
section names the functions in call order. [COMPONENTS.md](COMPONENTS.md) gives their signatures.

## Contents

1. [Common path](#1-common-path)
2. [map](#2-map)
3. [check](#3-check)
4. [query](#4-query)
5. [clones](#5-clones)
6. [docs](#6-docs)
7. [ste](#7-ste)
8. [chunk](#8-chunk)
9. [compress](#9-compress)
10. [Cross-cutting rules](#10-cross-cutting-rules)

---

## 1. Common path

Every run starts the same way.

```
process.argv.slice(2)
  └─ src/bin.ts          main(argv, { stdout, stderr })
       └─ src/cli.ts     main → isSubcommand? → help? → sub.run(rest, io)
            └─ <subcommand>.run(argv, io) → Promise<number>
  process.exitCode = <number>
```

1. `src/bin.ts` passes the arguments after the program name to `main`.
2. `main` prints the usage for no argument, `--help` and `-h`. It prints the version for
   `--version`.
3. `main` returns exit code 1 for a first argument that is not a subcommand.
4. `main` prints the help of a subcommand when `--help` or `-h` follows the name.
5. `main` calls `run(rest, io)` of the subcommand and returns its number.
6. `bin.ts` sets `process.exitCode` and lets the process end.

Each subcommand `run` function catches its own errors. It writes one line that starts with
`repo-tools <name>:` to `stderr`. Then the function returns a number. The exit codes are in
[API.md](API.md).

---

## 2. map

`map` is the main flow. `check`, `clones` and `docs` reuse parts of it.

### 2.1 Entry: `runMap` in `src/map/command.ts`

```
runMap(argv, io, command)
  1. parseDepgraphArgs(argv, cwd, command)      flags → DepgraphOptions
  2. maskRoot on every stderr line               root path → <root>
  3. resolve the root; isDirectory(root)
  4. loadConfigFile(root, options.config)        repo-tools.config.json → DepgraphSettings
  5. mergeMapConfig(cli, file)                   flag > file > default → DepgraphConfig
  6. one of:
       --write-duplicate-baseline                write the baseline; stop
       --check-census                            compare the committed inventory; stop
       --check-duplicates [--no-regen]           write reports (or read them), then compare
       none of these                             run the report pipeline
```

An unknown flag, a removed 1.x scan-scope flag or an invalid value stops the run at step 1 with
exit code 1 and writes nothing. The `depgraph` alias warns about its deprecation and continues.

### 2.2 Graph build: `buildGraph` in `src/map/graph.ts`

```
buildGraph(root)
  detectLanguage(root)                  count files for each language; pick the largest
  discover(root, language, skippedLinks)  git-tracked census; a pruned walk outside git
  detectWorkspaces(root)                TypeScript only
  loadGrammar(...)                      load the .wasm grammar that the census needs
  for each file:
      read source → parseTs | parsePy | parseCs | parseRs      → ParsedModule
      getResolver(language).resolve(import) → file | stdlib | alias | package
  expandBarrelStarReexports             repeat until no edge changes
  find entry roots                      package.json, build configs, HTML, launched scripts
  collect warnings                      skipped folders, no roots
  newRepoGraph(...)                     name from package.json, else the folder name
  refineSrcDispositions                 reachability from the roots and from the test roots
```

The result is a `RepoGraph`. The data moves through these shapes.

| Step | Shape |
|---|---|
| Census | `DiscoveredFile` (path, area, language) |
| Parse | `ParsedModule` (raw imports, exports, counts) |
| Resolve | `Dependency` edges between census files |
| Graph | `RepoGraph` of `FileNode` values |
| Adapt | `ParsedFile[]` for the analyzers, through `toParsedFiles` |

### 2.3 Report pipeline

`runPipeline` validates `--api-entry` before it writes any file. It loads the extensions and runs
each `preflight` hook. It builds the graph with `graphOf`, creates the output folder, and writes
the reports in this order.

| Order | Function | Files written |
|---|---|---|
| 1 | `emitDependencyGraph` | `dependency-graph.json` |
| 2 | `emitFileInventory` | `file-inventory.json` |
| 3 | `emitDuplicateSymbols` | `duplicate-symbols.json` |
| 4 | `emitUnusedAnalysis` | `unused-analysis.json` |
| 5 | `subsystemView`, `emitDependencyLayers` | `dependency-layers.json` |
| 6 | `emitSubsystemReports` | `DEPENDENCY_GRAPH.md`, `dependency-graph.yaml`, `dependency-summary.compact.json` |
| 7 | `emitMarkdownReports` | `FILE_INVENTORY.md`, `duplicate-symbols.md`, `unused-analysis.md` |
| 8 | `emitTestCoverage` | `TEST_COVERAGE.md`, `test-coverage.json` |
| 9 | `emitExportSurfaces` | `package-export-surfaces.json`, when the language has a surface |
| 10 | `emitApiSurface` | the per-export facts report, only with `--api-surface` or the config key |

The pipeline then prints one `Written:` line for each file. It prints the graph warnings to
`stderr`. An orphaned source file gives a warning, and `--strict-orphans` makes it an error. A
source file on disk that the census lacks gives a warning, and `--strict-census` makes it an
error. A successful census check prints `census passed: N files`. The `report` hook of each
extension runs last.

Every writer goes through `src/io.ts`, so each file ends with one LF and holds no CR.

### 2.4 Modes that write no report

| Mode | Reads | Result |
|---|---|---|
| `--check-census` | The committed `file-inventory.json` and a fresh census | Exit 1 on a difference. |
| `--check-duplicates` | `duplicate-symbols.json` (fresh, or committed with `--no-regen`) and the baseline | Exit 1 when a true duplicate is not in the baseline. |
| `--write-duplicate-baseline` | The `duplicate-symbols.json` of the last run | Writes the baseline file. |

---

## 3. check

```
run(argv, io)                              src/check/index.ts
  parse flags; resolve root and --docs folder
  loadConfigSections(root, config)         map.duplicateAllowlist, map.verificationMarker
  read every *.md file of the docs folder  UTF-8 only; none → exit 1
  collectMetrics(root)                     src/check/metrics.ts
      graphOf(root)                        a fresh graph
      emitDependencyGraph, emitFileInventory, emitDuplicateSymbols, emitUnusedAnalysis
          → a scratch folder (mkdtemp), removed in `finally`
      merge scalar values of: dependency-graph metadata + statistics,
          inventory totalFiles, duplicates summary, unused summary
  verifyDocs(docs, measured, markers)      src/check/verify.ts
      for each document:
          marker line alone on a line → skip the document
          no `## Verification` section → problem
          no claim row → problem
          claim name not measured → problem
          metric made unreliable by a build warning → problem
          value differs → problem
  print each problem; exit 0 or 1
```

The gate builds the graph again. It never reads the reports on disk, so a stale report cannot hide
drift. A truncated cycle count (`circularDepsTruncated`) and a graph with no entry roots make the
metrics that depend on them unreliable. A claim on such a metric fails. A count of dead-looking
files gets a note that it is not a deletion list.

---

## 4. query

```
run(argv, io)                              src/query/index.ts
  parseQueryArgs(argv, cwd)                command and options
  resolve root; must be a folder
  mergeQueryConfig(flags, loadConfigSections(root, config))
  loadQueryInput(root, config.out)         read dependency-graph.json and the surfaces
      refuse a 1.x graph; collect warnings
  print each warning to stderr
  switch (command):
      dependents | symbol-users | is-public | cycles | node-safety
      check-browser-safety | emit
```

The query reads the written graph. It parses no source file. A report folder that is missing or
unreadable is an error with exit code 1.

| Command | Data path |
|---|---|
| `dependents <file>` | `dependents` of `src/map/query.ts` over the loaded graph → the importers of the file |
| `symbol-users <symbol>` | `symbolUsers` over the internal imports that name the symbol |
| `is-public <pkg> <symbol>` | `loadSurfaces` → membership in the surface of the package |
| `cycles [--components]` | `simpleCycles`, or the strongly connected components |
| `node-safety [pkg]` | `computeTaint` → `findLeaks` for each browser-safe package |
| `--emit` | Writes `dependency-reverse.json` and `node-safety.json` |
| `--check-browser-safety` | Exit 1 when a leak exists |

---

## 5. clones

```
run(argv, io)                              src/clones/index.ts
  parseArgs(argv)                          flags → options.settings
  root = resolve(options.root); must be a folder
  loadConfigSections(root, config).clones
  mergeClonesConfig(flags, file)           flag > file > default
  execute(root, config, io)
      selectFiles(root, config.src)        discover(root, "typescript"), no .d.ts
          "auto" → the files of the src area; a list → the files below those folders
          none found → NothingToRead → exit 1
      readUnits(root, files, minNodes)
          readSource → grammarFor → loadGrammar → parserFor(...).parse(source)
          unitsOf(rootNode, source, file, minNodes)    function units
          a tree with an error is listed; its units still count
      detect(units, config)                exact groups and near pairs
      print summaryText(...)
      when config.out is set: write inventory.jsonl and clones.json
```

Any other error exits with code 2. The command reads only: it writes a file only when an output
folder is set.

---

## 6. docs

```
run(argv, io)                              src/docs/index.ts
  action = scan | stub | check
  analyseRepo(root)                        src/docs/analyse.ts
      discover(root)                       tracked files; skip folders; read .code-docs.json
      assertReadableLanguage(root)         refuse a repository of another language
      for each file: analyseTypeScript | analysePython → FileReport
          each symbol → applyRules → Issue list (MUST, SHOULD)
```

| Action | Data path |
|---|---|
| `scan` | `summarise(reports)` → `writeOutputs` → `COVERAGE.md` and `coverage.json` |
| `stub` | For each symbol with an M1 issue: `planTypeScript` or `planPython` → insertions. A dry run prints them. With `--apply`, `applyInsertions` checks the changed text with a parser and writes the file only when it parses. |
| `check` | Select the reports in scope (`--paths`, `--paths-from`) → print MUST issues → exit 1 on a MUST issue or an unparsed file |

`stub` skips a file that is a link or leaves the root, and a file with a bare carriage return. A
stub carries the marker `TODO:`, and rule M4 fails on it until the author writes the text.

---

## 7. ste

```
run(argv, io)                              src/ste/index.ts
  argv[0] == "--prose" → runProse (advice only; exit 0)
  parseMarkdownArgs(argv) → paths, required, since
  for each path:
      targetsFor(path)                     the file, or each .md file below the folder
      historical marker in the first five lines → skip and count
      read as UTF-8                         failure → exit 2
      checkMarkdownFindings(name, text)    sentence length, wordy forms, ambiguity, passive
      --since: addedLinesSince(file, rev) → keep findings on added lines; count the hidden ones
      print "=== name: OK | N problem(s) ==="
  print TOTAL line
  checks: missing paths, required files not examined, no file examined → exit 2
  exit 1 when a finding exists, else 0
```

A mistyped path never looks like a clean run. A run that examines no Markdown file is an error.

---

## 8. chunk

| Action | Data path |
|---|---|
| `split <file>` | Read the file → `detectFileType` → `splitMarkdown`, `splitJson` or `splitTypeScript` → write one chunk file for each section → `writeManifest` with a SHA-256 hash for each chunk and the line-break runs |
| `status <manifest>` | `readManifest` → `validateManifest` → hash each chunk file → list the changed chunks |
| `merge <manifest>` | `readManifest` → read the chunk files → join (JSON through `mergeJson`) → `restoreLineBreaks` → refuse an unsafe write → write the output |

A merge refuses a source outside the parent folder of the chunk folder unless `--yes` is present.
It refuses a result that is smaller than the file it replaces unless `--allow-shrink` is present.
A merge of unchanged chunks gives the source file again, byte for byte.

---

## 9. compress

```
run(argv, io, deps)                        src/compress/index.ts
  parse flags; single or --batch
  for each input:
      detectFormat(path) or --format
      -d:  decompress(content, format)     JSON only; refuse an existing output without --yes
      else: getCompressor(format)(content, level) → CompressionResult
            JSON: numbers keep their text (parseLossless, assertNumbersKept)
            legend: findRepeatedSubstrings → applySubstringCompression
            calculateStats → print statistics unless --no-stats
      write <input>.compact<ext>, or print a preview with --dry-run
```

---

## 10. Cross-cutting rules

| Rule | Where it applies |
|---|---|
| Every report ends with one LF and holds no CR. | All writers in `src/io.ts`. |
| Every sort uses UTF-16 code units. | `src/sort.ts` and every caller. |
| The root appears as `<root>` in an error. | `maskRoot` in `map`, `query` and `clones`. |
| A path in a flag or config key is relative to the root. | `checkValue` in `src/config.ts`. |
| An unknown key or flag stops the run before it writes. | `src/config.ts` and each argument parser. |
| A run that examined nothing is an error. | `map` (no source file), `ste` (no Markdown file), `docs` (no source file), `clones` (no file to read). |

## Verification

Generated by `repo-tools map`.
Regenerate: `repo-tools map . --out=docs/architecture` · Check: `repo-tools check . --docs=docs/architecture`

| Claim | Value | Source |
|---|---|---|
| totalSourceFiles | 289 | dependency-graph.json |
| entryRoots | 1 | dependency-graph.json |
| totalModules | 4 | dependency-graph.json |
