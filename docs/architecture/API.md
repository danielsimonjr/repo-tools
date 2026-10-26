# repo-tools API

This document lists the public surface of `repo-tools`: the command line, the config file, the
exit codes and the report files. The package has a `bin` entry and no `main` or `exports` field.
The command line is therefore the only supported interface. The exports of `src/` are internal
and are listed in [COMPONENTS.md](COMPONENTS.md).

## Contents

1. [Install and run](#1-install-and-run)
2. [Global options](#2-global-options)
3. [Subcommands](#3-subcommands)
4. [The config file](#4-the-config-file)
5. [Exit codes](#5-exit-codes)
6. [Report files](#6-report-files)
7. [Output rules](#7-output-rules)
8. [Extensions](#8-extensions)
9. [Verification tables](#9-verification-tables)

---

## 1. Install and run

| Form | Command | Needs |
|---|---|---|
| Package | `repo-tools <subcommand> [options]` after an npm install | Node.js 20 or later |
| Bundle | `node dist/cli.js <subcommand> [options]` | Node.js 20 or later |
| Executable | `repo-tools-linux-x64`, `repo-tools-windows-x64.exe`, `repo-tools-darwin-arm64` | No other runtime |

The package ships `dist/cli.js`, the `dist/*.wasm` grammar files, the license, the readme and the
changelog. The one runtime dependency, `js-yaml`, is inside the bundle.

---

## 2. Global options

| Option | Result |
|---|---|
| `repo-tools`, `repo-tools -h`, `repo-tools --help` | Prints the subcommand list. Exit code 0. |
| `repo-tools --version` | Prints the version. Exit code 0. |
| `repo-tools <subcommand> -h`, `--help` | Prints the help of the subcommand. Exit code 0. |
| An unknown first argument | Prints a message and the subcommand list to `stderr`. Exit code 1. |

---

## 3. Subcommands

| Subcommand | Purpose |
|---|---|
| `map` | Writes the dependency graph and the architecture reports. |
| `depgraph` | Deprecated alias of `map`. It warns and continues. |
| `check` | Compares the Verification tables of Markdown documents with a fresh graph. |
| `docs` | Measures, stubs and gates doc comments. |
| `chunk` | Splits a large file into chunks and merges them back. |
| `compress` | Writes a compact copy of a file, or restores a compact JSON file. |
| `query` | Answers questions about a written graph. |
| `ste` | Checks prose against Simplified Technical English. |
| `clones` | Lists functions and finds functions that copy each other. |

Flags that take a value accept `--name=value`. Where a section says so, they also accept
`--name value`.

### 3.1 `repo-tools map [options] [project-root]`

Builds the graph of a TypeScript or JavaScript, Python, C# or Rust repository. Writes the reports
into the output folder. The census is the set of source files that git tracks.

| Option | Meaning |
|---|---|
| `--root=<path>` | The project root. The default is the current folder. A non-flag argument also sets it. |
| `--config=<path>` | The config file, relative to the root. |
| `--out=<dir>` | The output folder. The default is `docs/architecture`. |
| `--api-surface=<file>` | Writes the per-export facts report to this file. |
| `--api-entry=<path>` | The entry file of the public surface. The default is `src/index.ts`. |
| `--stability-tags=<a,b>` | Whole-word JSDoc stability tags. The default is `public,internal,experimental,beta,alpha`. |
| `--strict-orphans` | Exit 1 when an orphaned source file exists. |
| `--strict-census` | Exit 1 when a source file on disk is not in the census. |
| `--no-extensions` | Loads no extension. |
| `--check-census` | Compares the committed `file-inventory.json` with the census. Writes nothing. |
| `--check-duplicates` | Writes the reports, then exits 1 when a true duplicate is not in the baseline. TypeScript only. |
| `--no-regen` | With `--check-duplicates`: reads the committed `duplicate-symbols.json`. Writes nothing. |
| `--write-duplicate-baseline` | Writes the duplicate baseline from the last `duplicate-symbols.json`. Writes nothing else. |
| `-h`, `--help` | Prints the help. |

The 1.x flags `--src`, `--tests`, `--exclude`, `--also-exclude`, `--all`, `-a`, `--reachable-only`,
`--include-tests` and `-t` have no effect. `map` exits 1 on them. The `depgraph` alias warns and
continues.

```
repo-tools map . --out=docs/architecture
repo-tools map --check-census
repo-tools map --check-duplicates --no-regen
```

### 3.2 `repo-tools check [options] [project-root] --docs=<dir>`

| Option | Meaning |
|---|---|
| `--docs=<dir>` | Required. The folder of the documents. A relative path is relative to the root. An absolute path is used as given. |
| `--root=<path>` | The project root. |
| `--config=<path>` | The config file. The check reads `map.duplicateAllowlist` and `map.verificationMarker`. |
| `-h`, `--help` | Prints the help. |

Each of these problems is a failure:

- A folder has no Markdown file.
- A document has no Verification section.
- A section has no row.
- A claim is unknown.
- The graph build declared a metric unreliable.
- A value differs from the graph.

A line that holds exactly `<!-- repo-map:no-verification -->`
skips a document. The check writes nothing in the repository.

### 3.3 `repo-tools query <command> [options]`

| Command | Meaning |
|---|---|
| `dependents <file>` | The files that import `<file>`. |
| `symbol-users <symbol>` | The files whose internal imports name `<symbol>`. |
| `is-public <pkg> <symbol>` | Whether `<symbol>` is in the public export surface of `<pkg>`. |
| `node-safety [pkg]` | The files that use `node:` builtins and that a browser-safe package reaches. |
| `cycles [--components]` | Every simple cycle (capped), or the strongly connected components. |
| `--emit` | Writes `dependency-reverse.json` and `node-safety.json` into the report folder. |
| `--check-browser-safety` | Exit 1 when the `.` entry of a browser-safe package reaches a file that uses a `node:` builtin. |

| Option | Meaning |
|---|---|
| `--root=<path>` | The project root. |
| `--config=<path>` | The config file. |
| `--out=<dir>` | The report folder. The default order is config `query.out`, config `map.out`, then `docs/architecture`. |
| `--node-runtime=<pkg,...>` | The packages that run on Node only. |

The query reads `dependency-graph.json` and `package-export-surfaces.json`. It refuses a 1.x graph.
Run `map` first.

### 3.4 `repo-tools clones [root] [options]`

| Option | Default | Meaning |
|---|---|---|
| `--out=<dir>` | none | Writes `inventory.jsonl` and `clones.json` here. Without it the command writes no file. |
| `--config=<path>` | `repo-tools.config.json` | The config file. |
| `--src=<path>...` | `auto` | The folders to read. `auto` reads the `src` area. Takes every argument up to the next flag. |
| `--min-nodes=<n>` | 50 | The smallest number of labels of a unit. |
| `--shingle=<n>` | 6 | The labels in one shingle. |
| `--near=<f>` | 0.6 | The smallest Jaccard score of a near pair. |
| `--containment=<f>` | 0.9 | The smallest containment of a near pair. |
| `--containment-min=<n>` | 20 | The smallest shingle count of the smaller unit for the containment rule. |
| `--rare=<n>` | 60 | A shingle in more units than this does not pick candidate pairs. |
| `--min-shared=<n>` | 3 | The rare shingles that a candidate pair must share. |
| `--list-errors=<n>` | 20 | The most paths of files with a parse error that the summary lists. |
| `--root=<path>` | current folder | The root. |

### 3.5 `repo-tools docs <action> [root] [options]`

| Action | Meaning |
|---|---|
| `scan [--out=<dir>]` | Measures the coverage. Writes `COVERAGE.md` and `coverage.json`. The default folder is `docs/code-docs`. |
| `stub [--apply] [--path=<path>]` | Plans a skeleton comment for each exported symbol that has none. A dry run is the default. Each stub holds `TODO:`. |
| `check [--paths <path>... \| --paths-from=<file>]` | The gate. Exit 1 on a MUST issue or a file that does not parse. |

The MUST rules decide the exit code. The SHOULD rules are reported only.

| Rule | Meaning |
|---|---|
| M1 | An exported symbol has a doc comment. A test file is exempt. |
| M2 | The doc comment has a summary line. |
| M3 | The doc comment names no parameter that the signature lacks. |
| M4 | The doc comment holds no `TODO:` marker. |
| M5 | A file uses one doc dialect only: google, numpy, rest, tsdoc or jsdoc. |
| S2 | The summary ends with a full stop. |
| S5 | The comment repeats a type that the signature holds. |
| S6 | The prose follows Simplified Technical English. |

The file `.code-docs.json` at the root excludes paths. Each entry needs a reason:
`{ "exclude": [ { "path": "assembly/", "reason": "AssemblyScript" } ] }`.

### 3.6 `repo-tools ste <file-or-directory>... [options]`

| Option | Meaning |
|---|---|
| `--require=<path>` | The file must exist, and the run must examine it. Repeat for more files. |
| `--since=<rev>` | Reports only findings on lines that the work tree adds or changes since the revision. |
| `--prose <file>` | Checks the file as one docstring. Prints `RULE<TAB>detail`. The findings are advice. |
| `-h`, `--help` | Prints the help. |

A descriptive sentence has at most 25 words. A numbered step or a check box has at most 20. A file
with `<!-- ste:historical-record -->` in its first five lines is skipped and counted.

### 3.7 `repo-tools chunk <action>`

| Command | Meaning |
|---|---|
| `split <file>` | Splits a file into chunks and writes a manifest. |
| `merge <manifest.json>` | Merges the chunks back into one file. |
| `status <manifest.json>` | Shows which chunks changed. |

| Option | Applies to | Meaning |
|---|---|---|
| `-o`, `--output <dir>` | `split` | The chunk folder. The default is `<file>_chunks/`. |
| `-l`, `--level <n>` | `split` | The split level. The default is 2 for Markdown and 1 for other types. |
| `-m`, `--max-lines <n>` | `split` | A chunk with more lines gets the `[LARGE]` mark. The default is 500. |
| `-t`, `--type <type>` | `split` | `auto`, `markdown`, `json` or `typescript`. |
| `-o`, `--output <file>` | `merge` | The output file. The default is the source file of the manifest. |
| `--yes` | `merge`, `status` | Allows a source file outside the parent folder of the chunk folder. |
| `--allow-shrink` | `merge` | Allows a result that is smaller than the file it replaces. |
| `--dry-run` | `split`, `merge` | Shows the result and writes no file. |

### 3.8 `repo-tools compress <input...> [options]`

| Option | Meaning |
|---|---|
| `-o`, `--output <file>` | The output file. The default is `<input>.compact<ext>`. |
| `-f`, `--format <fmt>` | `json`, `yaml`, `markdown`, `csv`, `tsv`, `text`, `log`, `typescript`, `javascript`, `xml` or `html`. The default comes from the extension. |
| `-l`, `--level <lvl>` | `light`, `medium` or `aggressive`. The default is `medium`. |
| `--no-legend` | Accepted for compatibility. The legend is always written. |
| `--no-stats` | Hides the statistics. |
| `--dry-run` | Shows a preview and writes no file. |
| `-d`, `--decompress` | Restores a compact JSON file. Any other format exits 1. |
| `--yes` | With `-d`: writes over an existing output file. |
| `-b`, `--batch` | Processes many files. |
| `-p`, `--pattern <pat>` | The file-name pattern. Only `*` and `?` are wildcards. |
| `-r`, `--recursive` | Also searches the subdirectories. |

---

## 4. The config file

The file `repo-tools.config.json` sits at the root. The `--config` option names another file. A
missing default file is not an error. A missing file that `--config` names is an error. The file
is a JSON object with these keys and no others.

| Key | Meaning |
|---|---|
| `$schema` | A pointer to a JSON Schema. It is not a setting. |
| `map` | The settings of `map` and `check`. |
| `depgraph` | The old name of `map`. A file that holds both `map` and `depgraph` is refused. |
| `query` | The settings of `query`. |
| `clones` | The settings of `clones`. |

### 4.1 `map` section

| Key | Kind | Meaning |
|---|---|---|
| `src` | `"auto"` or a list of paths | The source roots. |
| `tests` | list of paths | The test folders. |
| `out` | path | The output folder. |
| `exclude` | list of names | Folder names that every walk skips. Replaces the default list. |
| `alsoExclude` | list of names | More folder names to skip. |
| `strictOrphans` | boolean | An orphaned source file fails the run. |
| `dispatchCalls` | list of call names | The calls that register a typed-dispatch constant. An empty list switches the tag off. |
| `duplicateAllowlist` | path | The duplicate allowlist file. |
| `duplicateBaseline` | path | The duplicate baseline file. |
| `coveragePolicy` | path | The coverage policy file. |
| `regenerateCommand` | string | The command that the banner of each Markdown report names. |
| `verificationMarker` | string or `null` | The first banner line of each Markdown report. `null` omits it. |
| `apiSurface` | object | `out` (path or `null`), `entry` (path) and `stabilityTags` (list of names). |
| `extensions` | list of paths | The extension modules, in load order. |

### 4.2 `query` section

| Key | Kind | Meaning |
|---|---|---|
| `out` | path | The report folder. |
| `nodeRuntimes` | list of names | The packages that run on Node only. |

### 4.3 `clones` section

| Key | Kind | Flag |
|---|---|---|
| `src` | `"auto"` or list of paths | `--src` |
| `out` | path or `null` | `--out` |
| `minNodes` | whole number, 1 or more | `--min-nodes` |
| `shingleLength` | whole number, 1 or more | `--shingle` |
| `nearThreshold` | number from 0 to 1 | `--near` |
| `containmentThreshold` | number from 0 to 1 | `--containment` |
| `containmentMinShingles` | whole number, 1 or more | `--containment-min` |
| `rareShingleLimit` | whole number, 1 or more | `--rare` |
| `minSharedShingles` | whole number, 1 or more | `--min-shared` |
| `parseErrorList` | whole number, 1 or more | `--list-errors` |

### 4.4 Rules

1. The precedence is: a command-line flag, then the config file, then the default.
2. Every path is relative to the root. An absolute path is an error. The error names the key and
   never the value.
3. An unknown key, a value of the wrong kind and invalid JSON are errors.
4. An error text shows the root as `<root>`.

```json
{
  "map": {
    "out": "docs/architecture",
    "strictOrphans": true,
    "extensions": ["tools/map-extension.mjs"]
  },
  "clones": { "minNodes": 30 }
}
```

---

## 5. Exit codes

| Subcommand | 0 | 1 | 2 |
|---|---|---|---|
| `map` | Success. | An unknown or invalid flag. A root that is not a folder. No source file, or a language the engine cannot read. A missing `--api-entry` file. A failed strict check, census check or duplicate check. An extension that does not load, or a hook that throws. | Not used. |
| `check` | Every claim in every document matches. | A root or docs folder problem. A document that is not UTF-8. No source file. A bad flag. Any claim problem. | Not used. |
| `query` | Success. | An unknown command or flag. A missing or invalid value. A missing, unreadable or 1.x report. A path that is not a file of the graph. A browser-safety leak with `--check-browser-safety`. | Not used. |
| `clones` | The run finished. | The root holds no source file to read. | A usage error, a bad config file or a root that is not a folder. |
| `docs` | The action succeeded and the gate passed. | The gate failed, or the root holds no source file to measure. | A usage error, a root that is not a folder, or a malformed `.code-docs.json`. |
| `ste` | No finding in Markdown mode. Always in `--prose` mode. | A Markdown finding. | A usage error. A path that does not exist. No Markdown file examined. A required file missing or not examined. `--since` cannot use the revision. A file that is not UTF-8. |
| `chunk` | Success. | An error. | Not used. |
| `compress` | All files are done. | An error. | Not used. |

The `chunk` and `compress` subcommands return only 0 and 1. The help of `compress` lists these errors:
an unknown option, an option without a value, a missing input file, and two inputs without `--batch`.
The run writes no file after one of them.

---

## 6. Report files

`map` writes these files into the output folder. The default folder is `docs/architecture`.

| File | Format | Content |
|---|---|---|
| `dependency-graph.json` | JSON | `metadata`, `modules`, `statistics`, `reachability`, `warnings`. |
| `dependency-graph.yaml` | YAML | The same data in YAML. |
| `dependency-summary.compact.json` | JSON | A compact summary. |
| `DEPENDENCY_GRAPH.md` | Markdown | The imports, a Mermaid diagram and a summary table. |
| `dependency-layers.json` | JSON | The subsystem layers. |
| `file-inventory.json` | JSON | `totalFiles`, `byDisposition`, `byArea`, `byPackage`, `files`, `skippedLinks`, `warnings`. |
| `FILE_INVENTORY.md` | Markdown | The inventory as a table. |
| `duplicate-symbols.json` | JSON | `note`, `classificationNote`, `summary`, `duplicates`, `runtime`, `types`. |
| `duplicate-symbols.md` | Markdown | The duplicate names. |
| `unused-analysis.json` | JSON | `caveats`, `summary`, `unreferencedAnywhere`, `referencedInModule`, `unclassifiedExports`, `noImporterFiles`. |
| `unused-analysis.md` | Markdown | The unused files and exports. |
| `test-coverage.json` | JSON | The files that a test imports, and the files that no test imports. |
| `TEST_COVERAGE.md` | Markdown | The same data as a table. |
| `package-export-surfaces.json` | JSON | The exported names of each package. Not written for a language with no surface. |

The `--api-surface` option writes one more file, at the path that the option names.

`query --emit` writes `dependency-reverse.json` and `node-safety.json`. `clones --out` writes
`inventory.jsonl` and `clones.json`. `docs scan` writes `COVERAGE.md` and `coverage.json`.
`chunk split` writes the chunk files and `manifest.json`.

### 6.1 Metrics

`dependency-graph.json` holds these values in `metadata` and `statistics`. A Verification table
can claim each of them by name.

| Group | Names |
|---|---|
| Counts | `totalSourceFiles`, `totalTypeScriptFiles`, `totalModules`, `totalLinesOfCode`, `totalExports` |
| Reachability | `entryRoots`, `reachableFiles`, `dormantFiles`, `orphanedFiles`, `testOnlyFiles` |
| Cycles | `runtimeCircularDeps`, `typeOnlyCircularDeps`, `runtimeCyclicComponents`, `typeOnlyCyclicComponents`, `runtimeFilesInCycles`, `typeOnlyFilesInCycles`, `circularDepsTruncated` |
| Imports | `totalTypeOnlyImports`, `noImporterFileCount`, `unusedExportsCount` |
| Symbols | `totalClasses`, `totalInterfaces`, `totalFunctions`, `totalTypeGuards`, `totalEnums`, `totalConstants`, `totalReExports` |

`totalTypeScriptFiles` and `totalSourceFiles` hold the same value. Only `totalSourceFiles` is
correct for a repository in another language.

---

## 7. Output rules

| Rule | Statement |
|---|---|
| R1 | Every file uses LF line ends and ends with one LF. |
| R2 | Each generated Markdown report starts with a banner that names the regenerate command. |
| R3 | No report holds a timestamp. |
| R4 | Every path in a report is relative to the root and uses `/`. |
| Order | Every list is sorted by UTF-16 code unit. |

The same tree gives the same bytes on every run and on every platform.

---

## 8. Extensions

A repository adds behaviour with an `.mjs` module. The `map.extensions` key lists the modules in
load order. The module has a default export.

```js
export default {
  name: "my-extension",
  preflight(ctx) { /* before the first write */ },
  report(ctx) { /* after the last report */ },
};
```

| Context field | Hook | Meaning |
|---|---|---|
| `root` | both | The absolute project root. |
| `config` | both | The merged map config, frozen. |
| `mask` | both | `blankCommentsAndStrings` and `stripComments`. |
| `graph` | `report` | A frozen copy of `dependency-graph.json`. |
| `write(relPath, text)` | `report` | Writes a file into the output folder with LF line ends. It refuses an empty path, an absolute path and a path outside the output folder. |

A hook that throws or rejects fails the run with exit code 1. The error names the extension.
`--no-extensions` loads none.

---

## 9. Verification tables

A document that the gate reads ends with a `## Verification` section. The section holds a table.

```markdown
## Verification

| Claim | Value | Source |
|---|---|---|
| totalSourceFiles | 289 | dependency-graph.json |
```

The gate reads the `Claim` and `Value` columns. The `Source` column is for the reader. A claim name
that is not a metric is an error. A document can opt out with a line that holds exactly
`<!-- repo-map:no-verification -->`.

## Verification

Generated by `repo-tools map`.
Regenerate: `repo-tools map . --out=docs/architecture` · Check: `repo-tools check . --docs=docs/architecture`

| Claim | Value | Source |
|---|---|---|
| totalSourceFiles | 289 | dependency-graph.json |
| totalTypeScriptFiles | 289 | dependency-graph.json |
| totalModules | 4 | dependency-graph.json |
| totalExports | 716 | dependency-graph.json |
