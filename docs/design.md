<!-- repo-map:no-verification -->
<!-- This document is the design; it makes no claim about the graph of this repository. -->

# repo-tools design

This document describes the design of `repo-tools` version 1. It tells a maintainer what the tool
does, how the code is divided, which rules keep the output stable, and which checks prove the
product. The text follows ASD-STE100 Simplified Technical English.

Sections 1 to 13 describe version 1. Section 14 describes the 2.0.0 engine (`repo-tools map`),
which replaces the `depgraph` pipeline. Where the two differ, section 14 applies to 2.0.0.
Section 15 describes `repo-tools check`, the drift gate of the architecture documents. Section 16
describes `repo-tools docs`, which measures and gates the documentation comments of the source.

## 1. Purpose

Several repositories kept their own copies of the same repository tools. The copies drifted: a fix
in one copy did not reach the others. `repo-tools` replaces the copies with one tool, one source
and one test suite.

The tool has five subcommands:

| Subcommand | Job |
|---|---|
| `depgraph` | Writes the dependency graph and the architecture reports of a TypeScript tree. |
| `chunk` | Splits a large file into chunks, merges the chunks back, and shows which chunks changed. |
| `compress` | Writes a compact copy of a file for a model context, and restores a compact JSON file. |
| `query` | Answers structural questions from the `depgraph` reports, and writes two derived reports. |
| `ste` | Checks Markdown or docstring prose against Simplified Technical English. |

## 2. Distribution

The tool ships in two forms.

1. **Compiled executable (primary).** `bun build --compile` makes one file that holds the tool and
   the Bun runtime. The targets are `bun-windows-x64`, `bun-linux-x64` and `bun-darwin-arm64`. The
   executable needs no Bun, Node or `node_modules` on the computer that runs it.
2. **Node bundle (secondary).** `dist/cli.js` is one ESM file for Node 20 or later. It bundles its
   one runtime dependency (js-yaml), so the npm package has no runtime dependencies.

Both forms bundle the installed `node_modules`. Thus the build first compares `node_modules` with
`bun.lock` (`scripts/lockcheck.ts`). On a difference, the build stops with exit 1 and names each
package. A frozen install does not remove a package that the lockfile no longer names, so a stale
package can stay after a correct install. Without the check, the build succeeds and the artifact
fails.

## 3. Module architecture

Each module has one job. `src/cli.ts` calls the subcommand modules. A subcommand module does not
call `src/cli.ts`.

| Module | Job |
|---|---|
| `src/bin.ts` | The process entry. Calls `src/cli.ts` with the process arguments and streams. |
| `src/cli.ts` | Reads the subcommand, calls its module, and prints the help and the version. |
| `src/config.ts` | Reads `repo-tools.config.json`. Merges the flags, the config file and the defaults. Checks each value. |
| `src/io.ts` | Writes each output with LF line endings and one trailing LF. |
| `src/sort.ts` | Compares strings by UTF-16 code unit. No module uses `localeCompare`. |
| `src/mask.ts` | Replaces comment and string text with spaces (offsets and lines stay), and removes comments. It is the one copy of this code. A `/` after `++` or `--` is division. A `/` after `if`, `while`, `for` or `with` is a regular expression. |
| `src/map/command.ts` | Runs `repo-tools map`: the graph, the reports and the gates. `depgraph` is the alias. |
| `src/map/discovery.ts` | The census, the language, the area and the disposition. The skip list is not process state. |
| `src/map/parsing.ts`, `grammars.ts` | Reads imports and exports. A literal relative `import()` is an edge. |
| `src/map/graph.ts` | Joins discovery, reading and resolution, then sets reachability. |
| `src/map/artifacts.ts`, `layers.ts`, `reports.ts` | Writes the core graph, the inventory, the unused analysis and the subsystem view. |
| `src/depgraph/args.ts` | Reads the `map` flags. An unknown flag or a bad value stops the run. |
| `src/depgraph/dirlist.ts` | Lists a folder in sorted order. |
| `src/depgraph/exclude.ts` | The default skip names, and a walk that builds a fresh skip set on each call. |
| `src/depgraph/description.ts` | Reads a JSDoc summary and a fallback description. |
| `src/depgraph/workspaces.ts` | Finds npm, Yarn and pnpm workspaces, and structural workspaces. |
| `src/depgraph/paths.ts` | Makes every path POSIX and relative to the root. |
| `src/depgraph/resolver.ts` | Finds the file of a specifier: `.js` to `.ts`, `dist/` to `src/`, and `package.json` `exports`. |
| `src/depgraph/roots.ts` | Finds the reachability roots: exports, `bin`, scripts and build configs. |
| `src/depgraph/analysis.ts`, `cycles.ts` | Reachability, unused files and exports, statistics, and cyclic components. A package-name edge is included. |
| `src/depgraph/coverage.ts` | Which source files a test reaches, through barrels and side-effect imports too. |
| `src/depgraph/duplicates.ts` | Names that two or more files define, their classes, and the duplicate gate. |
| `src/depgraph/api-surface.ts` | The per-export facts report (`--api-surface`). |
| `src/depgraph/extensions.ts` | Loads the repository-local extensions and runs their hooks. |
| `src/depgraph/reporters/*` | One module per report file, and the generated-file banner. |
| `src/check/*` | `repo-tools check`: the claims parser, the metrics of a fresh graph, the verdict and the command (section 15). |
| `src/docs/*` | `repo-tools docs`: the analysers of Python and TypeScript, the rules, the report, the stub writer and the command (section 16). |
| `src/query/*` | Reads the `map` reports and answers each query. `safety.ts` holds the browser-safety check. |
| `src/chunk/*` | The `split`, `merge` and `status` actions, one splitter per file type, and the manifest. |
| `src/compress/*` | One compressor per format, the legend, and the JSON restore. |

The core holds no fixed path of one consumer repository. A feature that only one repository uses
goes into an extension in that repository (section 6).

## 4. Output rules

Every `depgraph` report obeys four rules. The rules make two runs on the same tree give the same
bytes, on every operating system.

- **R1.** A file ends with one LF. No file has CR characters.
- **R2.** A Markdown report starts with the generated-file banner. The banner names the command
  that makes the file again.
- **R3.** A report has no timestamp and no date field.
- **R4.** Every path is POSIX and relative to the root.

Two more rules keep the order stable:

- Every sort compares UTF-16 code units (`src/sort.ts`). A locale sort gives a different order on
  a different computer.
- Every directory listing is sorted before use. NTFS lists names in a case-insensitive order; other
  file systems do not.

Standard output and standard error show the root as `<root>`, never as an absolute path.

## 5. Config

The config file is `repo-tools.config.json` at the root, or the file of `--config=<path>`. The file
has a `depgraph` section and a `query` section. The order of precedence is: a flag, then the config
file, then the default.

The tool refuses a config file with an unknown key, a value of the wrong kind, or invalid JSON. A
misspelled key otherwise has no effect and gives no sign of it.

Every path in the config file and in a path flag is relative to the root. An absolute path stops
the run with exit 1, except in `--root`. This rule keeps user paths out of the reports and the
messages.

| Section | Keys |
|---|---|
| `depgraph` | `src`, `tests`, `out`, `exclude`, `alsoExclude`, `strictOrphans`, `duplicateAllowlist`, `duplicateBaseline`, `coveragePolicy`, `regenerateCommand`, `verificationMarker`, `extensions`, `apiSurface` (`out`, `entry`, `stabilityTags`) |
| `query` | `out`, `nodeRuntimes` |

## 6. Extensions

An extension is a `.mjs` module in the consumer repository. `depgraph.extensions` names the modules,
relative to the root. They load in config order. The default export has this shape:

```text
{
  name: string,
  preflight?(ctx: { root, config, mask }): void | Promise<void>,
  report?(ctx: { root, config, mask, graph, write(relPath, text) }): void | Promise<void>
}
```

- `preflight` runs before the first write, in the modes that write. `--check-census` and
  `--check-duplicates --no-regen` run no hook.
- `report` runs after the analysis. `graph` is a frozen copy of the analysis result.
- `mask` gives the functions of `src/mask.ts`, so an extension keeps no copy of its own.
- `write` writes a file in the output folder, and applies rule R1. `write` refuses an empty
  path, an absolute path, and a path out of the output folder. `write` also refuses a symbolic
  link inside the output folder that points outside it.
- A hook that throws, or a module that does not load, stops the run with exit 1. The message names
  the extension.
- `--no-extensions` loads no extension.

**`ctx.write` is a convenience boundary, not a security boundary.** An extension is trusted code of
the repository. An extension can call the file system directly, as any repository script can.
`write` makes the correct path easy. `write` does not stop an extension that writes to another
place. Review an extension as you review any other code in the repository.

## 7. The query subcommand

`repo-tools query` reads `dependency-graph.json` and `package-export-surfaces.json`. It parses no
source file, so `repo-tools depgraph` must run first. A missing report stops the run with exit 1,
and the message says to run `repo-tools depgraph`.

| Form | Answer |
|---|---|
| `query dependents <file>` | The files that import `<file>`. |
| `query symbol-users <symbol>` | The files that import `<symbol>`. |
| `query is-public <pkg> <symbol>` | Is `<symbol>` in the public export surface of `<pkg>`? |
| `query node-safety [pkg]` | The `node:` imports that the `.` entry of a browser-safe package reaches. |
| `query cycles` | The cyclic components, runtime and type-only. |
| `query --emit` | Writes `dependency-reverse.json` and `node-safety.json`. |
| `query --check-browser-safety` | Exits 1 when the `.` entry of a browser-safe package reaches `node:` code. |

Every package is browser-safe, unless `--node-runtime=<pkg,...>` or `query.nodeRuntimes` lists it.
The derived reports obey rules R1 to R4.

## 8. chunk and compress

`chunk split` writes the chunks of a Markdown, JSON or TypeScript file and a manifest.
`chunk merge` writes the file again from the chunks. The manifest holds relative paths and the
SHA-256 of each chunk. The merge refuses these cases, unless a flag permits them:

- a target out of the parent folder of the chunk folder (`--yes`);
- a result smaller than the file that it replaces (`--allow-shrink`).

The merge always refuses a chunk that is a symbolic link, a junction or a folder. The merge also
refuses a chunk whose real path is out of the real chunk folder. No flag permits these cases.

A split followed by a merge gives the input bytes.

`compress` writes a compact copy of a file for a model context. `compress -d` restores JSON only
in version 1. The restore keeps the source text of each number, so a restored value equals the
input value. A runtime without JSON source-text access (Node 20) cannot keep every number. There,
the restore stops with exit 1 when a number would change, and the message gives its JSON path.
`-d` on another format stops with exit 1 and writes no file. `-d` does not write over a file
without `--yes`.

## 9. The ste subcommand

`repo-tools ste` checks prose against the part of ASD-STE100 that a tool can decide. The rules
cover sentence length, wordy forms, ambiguous references and the passive voice with an agent. The
tool cannot judge the approved dictionary, because that dictionary is licensed.

One rule module (`src/ste/rules.ts`) holds the rules. Two harnesses apply the rules:

- the **Markdown harness** (`src/ste/markdown.ts`, the default mode) is a gate. A finding gives
  exit 1.
- the **docstring harness** (`src/ste/prose.ts`, `--prose <file>`) gives advice. The exit code
  is 0.

The two harnesses came from two skills, and they apply the same rules in different ways. Each row
below comes from a run of both harnesses on the same text.

| Behavior | Markdown harness | Docstring harness |
|---|---|---|
| Input | A Markdown file, or each `.md` file below a folder | One docstring |
| Text removed first | Fences, tables, headings, quotes, HTML comments, frontmatter, `- Not:` lines, link targets | Tag lines (`@param`), section headers (`Args:`), doctest lines, rules, fences |
| Code-like tokens | Removed before every rule | Removed before the wordy rule only |
| A backticked agent (`` by `parse` ``) | Not an agent: no passive finding | An agent: a passive finding |
| Sentence limit | 20 words for a numbered step or a check box, 25 for other text | 20 words |
| A word | A token with a letter or a digit | Any token (a lone `-` counts) |
| A wordy form | Lower case only; each occurrence, with its line | Any case; one finding per form |
| Passive and ambiguous | Each match, with its line | The first match per sentence |
| A paragraph | Wrapped lines join; each list item is its own paragraph | The whole docstring is one text |

The Markdown harness is a port of `ste_check.py` from the architecture-docs skill. The docstring
harness is a port of `code_docs/ste.py` from the code-docs skill. The two skills kept identical
copies of the rules. On a real corpus of Markdown files, the port and `ste_check.py` give the
same findings, byte for byte. The CHANGELOG records the measurement. The port differs from
`ste_check.py` in these ways only:

- **File order.** The port sorts the paths in code-unit order on every operating system. Python
  sorts them without case on Windows, so its order on Windows is different.
- **A file that is not UTF-8.** The port stops with exit 2 and names the file. Python stops with a
  traceback.
- **File selection.** The port reads a file whose name ends in `.md` on every operating system. A
  folder with a `.md` name is not a file, so the port does not read it.
- **The usage text** names `repo-tools ste`.

## 10. Privacy check

The repository is public, and its source came from private repositories. `scripts/privacy-check.ts`
runs on every push and on every pull request. It scans each tracked file and each commit message.
The job fails on one finding.

| Rule | Finds |
|---|---|
| Windows user path | a drive letter followed by the `Users` folder, with either separator |
| POSIX home path | a path in the `home` folder of Linux or the `Users` folder of macOS |
| Private name | a word token whose SHA-256 is in `scripts/privacy-denylist.sha256` |
| Session URL | a link to a coding-agent session |
| Email address | an address, except a `noreply` address |
| Tracked binary | a tracked executable, or a file larger than 5 MB |
| Stale entry | an entry of the accept-list that accepts no finding |

The check prints the file, the line and the rule. It never prints the matched value. A self-test
puts one finding per rule into the checker, and it fails the job when a rule does not fire. A
checker that cannot fail is not a check. The `commit-msg` hook runs the same check before a commit
exists.

**The history is fixed, so the check has an accept-list.** A commit message cannot change after a
merge. A new commit therefore cannot clear a finding in an old message. `scripts/privacy-accepted.txt`
records a reviewed finding of that kind. One entry holds a full commit sha, one finding kind, one
line of the message and a reason. The entry accepts that finding only. The list has no prefix, no
wildcard and no whole-commit waiver. The list never accepts a finding in a tracked file. An entry
that accepts no finding fails the job, so the list cannot outlive the history that it describes.
The check prints each accepted finding with its reason.

**The denylist hides names only from a reader, not from a guesser.** The list holds SHA-256
hashes, so the repository does not publish the names that it protects. But a hash of a short word
is an oracle. A person who guesses a name can hash the guess and find the hash in the list. The
list therefore protects against a casual reader and against an accidental leak. The list does not
keep a name secret from a person who already suspects the name. Do not put a secret value (a key, a token or a
password) on the list. A secret must never be in the repository in any form.

## 11. Build and CI

One script builds the product in two forms, and two workflows run that script. No workflow
publishes the product.

### 11.1 The Node bundle

`bun scripts/build.ts` writes `dist/cli.js`: one ESM file for Node 20 or later. The bundle holds
the third-party code, so the npm package has no runtime dependency (section 2). The script first
compares `node_modules` with `bun.lock`. On a difference, it exits 1.

### 11.2 The compiled executables

`bun scripts/build.ts --compile --target=<target>` writes one executable into `bin/`. Without
`--target`, the target is the host. The three targets are `bun-windows-x64`, `bun-linux-x64` and
`bun-darwin-arm64`. The files are `repo-tools-windows-x64.exe`, `repo-tools-linux-x64` and
`repo-tools-darwin-arm64`. This mode also checks `node_modules` first. The script writes no
checksum file.

### 11.3 The workflows

- Every action in a workflow is pinned to a full 40-character commit SHA. A tag can move; a SHA
  cannot.
- The workflows have `contents: read` permission only. No workflow holds a publish token or
  `id-token: write`. CI builds and tests. CI does not publish.
- `ci.yml` runs on each push and pull request. Its jobs run in parallel:
  - the privacy check;
  - type check, lint and unit tests on Linux, Windows and macOS;
  - on each of the three operating systems, the compiled executable, with the smoke test on the
    executable, on `node dist/cli.js` and on `bun dist/cli.js`;
  - a last job that packs the npm package and records its SHA-256.
- `build.yml` runs on a version tag. It checks that the tag equals the `package.json` version,
  builds the three executables, runs the smoke test on each, and writes their SHA-256 sums.

### 11.4 The release

No workflow creates a release, and no workflow holds a token. The last job of `ci.yml` packs the
npm package, writes its SHA-256 to `SHA256SUMS`, and uploads both as a workflow artifact.
`build.yml` uploads the three executables and their `SHA256SUMS` as workflow artifacts. The release
publishes the tarball that CI built, after a check of its hash against `SHA256SUMS`.

## 12. Verification

| Check | Proves |
|---|---|
| Unit tests (`bun test`) | Each module, and a regression test for each fix. They run on three operating systems. |
| Golden tests | Each report of each fixture equals its committed golden file, byte for byte. |
| Double run | Each golden set runs twice. The second run must be byte-identical to the first. |
| No extensions in goldens | The golden runs use `--no-extensions`. A planted extension that throws proves it. |
| Smoke test (`scripts/smoke.ts`) | On the product itself: `--version`, `--help`, an unknown subcommand, `depgraph` against the goldens, `--api-surface` against its golden, the `chunk` round trip, the `compress` JSON round trip, an extension with both hooks, and the `check` drift gate (a matching claim exits 0, a drifting claim exits 1), run from another folder. Section 12.1 lists the steps. |
| API-surface equivalence | `depgraph --api-surface` gives the same bytes as the generator that the module came from. |
| Fix-ledger audit (`bun run audit:ledger`) | Each fix of `docs/fix-ledger-2.0.0.md` has a test that fails when the fix is reverted. |
| Design references (`bun run check:design`) | Each reference to a section of this document, in a comment, a test title or a workflow, names a heading that exists. The check cannot prove that the heading has the meaning that the reference gives. |

The fix-ledger audit reverts one fix at a time in a scratch copy of the repository. A shared git
clone of the work tree, plus the uncommitted files, forms the copy. Each mutation of
`scripts/fix-ledger-mutations.ts` is an exact text anchor and its replacement, and the anchor
must occur once. The audit runs the unchanged copy first, and the suite must pass there. For each
mutation, the audit runs the test file of the fix, and then the whole suite with `--bail=1`. A
failure in the test file of the fix is `caught-by-own`. A failure in another test is
`caught-elsewhere`, and no failure is `uncaught`. A run in which only tests hit their time limit
is an `error`, because machine load can cause it. Both `caught-elsewhere` and `uncaught` need a
test of the fix, so the exit code is 0 only when every mutation is `caught-by-own`. `docs/fix-ledger-audit.md` holds
the result.

The mini-repo fixture holds names whose case order differs from code-unit order (`B.ts`, `a.ts`,
`_x.ts` and a folder `Z/`). A fixture with lowercase names only cannot find a missing sort.

A killed test run cannot remove its temporary folders. Each test folder name holds the process ID
of its run, and the next run removes the folders of runs that are no longer alive.

### 12.1 The smoke test

`scripts/smoke.ts` runs the steps below against one way to run the tool: a compiled executable,
`node dist/cli.js` or `bun dist/cli.js`. It exits 1 when a step fails.

1. `--version` prints the package version, `--help` lists the subcommands, and an unknown
   subcommand exits 1.
2. `map` on the mini-repo fixture gives its golden files, file by file.
3. `map --api-surface=<file>` gives the API-surface golden.
4. `chunk split` and then `chunk merge`, on a copy of a Markdown fixture, give the input bytes.
5. `compress` and then `compress -d`, on a JSON file, give the same JSON value.
6. CI runs the script for each of the three ways to run the tool, on each operating system.
7. A `map` run loads the fixture `.mjs` extension, and both hooks run.
8. The drift gate: `check` exits 0 on a matching claim and exits 1 on a drifting claim.

## 13. Limits of version 1

- `depgraph` reads TypeScript only (`.ts` and `.tsx`). Other languages are out of scope.
- `compress -d` restores JSON only.
- The API-surface report takes one entry file (`--api-entry`).
- `dependency-graph.json` has no `schemaVersion` key. A new key changes the output of every
  consumer.

## 14. The 2.0.0 engine

`repo-tools map` is the command of the 2.0.0 engine. The engine is a port of the Python tool
`repo_map` of the architecture-docs skill. It reads TypeScript and JavaScript, Python, C# and Rust. The
extras of depgraph 1.x run on its graph. `repo-tools depgraph` is a deprecated alias of `map`
through 2.x.

### 14.1 Modules

| Module | Job |
|---|---|
| `src/map/discovery.ts` | The census: the files that git tracks (else a pruned walk), the language of the repository, and the area and disposition of each file. |
| `src/map/grammars.ts` | Loads the tree-sitter grammars (TypeScript, TSX, Python) once each, when a run needs them. |
| `src/map/parsing.ts` | One reader per language: tree-sitter for TypeScript/JavaScript and Python, regular expressions for C# and Rust. |
| `src/map/resolvers.ts` | One resolver per language: an import to a file of the census, a built-in, or an external package. |
| `src/map/graph.ts` | Builds the graph: edges, entry roots, barrel expansion, reachability and cycles. |
| `src/map/schema.ts` | The graph types and the core JSON shape (schema version 2.0.0). |
| `src/map/cycles.ts` | The simple cycles and the strongly connected components, for the graph and the query. |
| `src/map/artifacts.ts` | The four core files: `dependency-graph.json`, `file-inventory.json`, `duplicate-symbols.json` and `unused-analysis.json`. |
| `src/map/adapter.ts` | Changes the graph into the parsed-file records of depgraph, so that the depgraph analyzers run on the graph. |
| `src/map/layers.ts`, `reports.ts`, `markdown.ts`, `coverage.ts`, `surfaces.ts` | The extras: the subsystem view, the Markdown reports, test coverage and the export surfaces. |
| `src/map/query.ts` | The read-only queries of the Python tool: `dependents`, `symbolUsers` and `cycles`. |
| `src/map/command.ts` | The command: flags, config, the order of the reports, the gates and the extension hooks. |

### 14.2 The command

- The flags of depgraph stay. The 1.x scan-scope flags (`--src`, `--tests`, `--exclude`,
  `--also-exclude`, `--all`, `--reachable-only`, `--include-tests`) have no effect, because the
  census is the set of files that git tracks. `map` exits 1 on them, and the alias warns.
- The config section is `map`. Its old name, `depgraph`, is also read. A file with both sections
  exits 1.
- Input files never come from the output folder. The duplicate allowlist, the duplicate baseline
  and the coverage policy default to `docs/architecture/`.
- `--api-surface=<file>` writes the per-export facts report of one entry file. `--api-entry=<path>`
  names the entry file, and `--stability-tags=<a,b>` sets the tags. A missing entry file stops the
  run with exit 1 before the run writes any file.
- A repository with no source file, or with a language that the engine cannot read, exits 1
  and gets no output folder.

### 14.3 Output rules

The output rules R1 to R4 (section 4) apply. The core graph has the shape of the Python tool,
with `schemaVersion` 2.0.0 and no `generated` date. The 2.0.0 additions are listed in
`docs/parity-2.0.0.md`: the component and export-kind statistics, the subsystem view in
`dependency-layers.json`, and the superset keys of `file-inventory.json` and
`duplicate-symbols.json`.

### 14.4 Deliberate differences from the Python tool

- A workspace monorepo gets the entry roots of each workspace package.
- An import of a workspace package by name is an edge to its entry file.
- A Rust `use` alias is the whole word `as` and a name. A path keeps the letters `as` inside a
  name (`HashMap`, `wasm`).
- A literal relative `import()` is an edge. The Python tool records none. A runtime call is a
  namespace use (`*`). A type-position `import('./c').Name` records that name. `typeof import()`
  records no names. A template that contains `${`, and a specifier that is not relative, are not
  edges. The parity record gives the merge rules and the verdict `repo_map-wrong`.
- A namespace import (`import * as ns`, `export * as ns`) is a namespace use. It counts every
  export of the target file as used, as a runtime `import()` does. The Python tool lists those
  exports as unused. The parity record gives the verdict `repo_map-wrong`.
- A name that a file mentions only in a comment is not an in-module reference. The count reads
  the source with the comments removed. The Python tool counts the comment, so the name is
  "referenced in module" there and "unreferenced anywhere" here.
- A bodiless `export function f(): T;` is not an export. The Python tool does the same
  (`repo_map-kept`). An overload plus an implementation records the name once.

A folder named `dist`, `build`, `coverage`, `node_modules` or `.git` under `src/` stays on the
skip list. When that folder holds a source file, the run warns, and the files stay out of the
census. A `build/` folder at the root stays silent. A top-level `$schema` key in the config file
is not a setting. Census messages name the configured regenerate command. The test-coverage note
names the configured coverage-policy path. A root config that names a source file with
`new URL`, and a source file that launches a sibling with `new URL('./x.js', import.meta.url)`,
seed roots. An `exports` or `main` target is a root after `dist/` maps to `src/`, including when
that file is not `src/index.ts`. A workspace subpath uses the export target, then
`<sub>.ts`, then `<sub>/index.ts`. A package-name import is an edge for cycles and for test
coverage.

### 14.5 The query

`repo-tools query` reads the core graph and refuses a 1.x graph. `dependents`, `symbol-users` and
`cycles` read each area of the graph. A path that is not a file of the graph exits 1. `cycles`
lists the simple cycles, and `cycles --components` lists the strongly connected components. The
browser-safety commands serve TypeScript/JavaScript only.

### 14.6 Assets

The Node bundle needs the four tree-sitter `.wasm` files: the runtime and the TypeScript, TSX
and Python grammars. The build writes them next to
`dist/cli.js`, and the npm package holds them. The compiled executable holds them in its file
system. A relative asset path resolves against the URL of its module, never against the working
folder.

## 15. The check subcommand

`repo-tools check` is the drift gate of the architecture documents. The command is a port of
`check.py` of the architecture-docs skill. The check reads the `## Verification` tables of the
Markdown files in a folder. The check builds a fresh graph of the repository, and the check
compares each claim with the graph. A stale report on disk cannot hide drift, because the check
never reads one.

### 15.1 The command

`repo-tools check [root] --docs=<dir> [--config=<file>]`

- The root is the first argument that is not a flag, or `--root=<path>`. The default is the
  current folder.
- `--docs` is required. A relative path is relative to the root and can start with `../`. An
  absolute path is used as given, so a staged document set outside the repository can pass the
  gate before it is installed. Standard error shows the folder as `<root>/<path>`, or as
  `<docs>` when the path is absolute.
- The check reads the files of the docs folder that end in `.md` (any letter case), without a
  sub-folder, in code-unit order. A document is UTF-8. A byte that is not valid UTF-8 stops the run with a
  message.
- The check loads the config file as `map` does. The check uses two keys of the `map` section:
  `duplicateAllowlist` and `verificationMarker`. The allowlist defaults to
  `docs/architecture/duplicate-allowlist.json` and never comes from the docs folder. The check
  writes nothing in the repository. The four core reports go into a scratch folder, and the
  check removes that folder before the check returns.

### 15.2 What a claim is

A claim is a row `| name | value | source |` of a table inside a Verification section. The heading
must be "Verification", with an optional colon and an optional trailing parenthesis. A heading
that only contains the word does not open a section. The section ends at the next heading of the
same level or a shallower level. A table outside a section is not a claim. The header row and the
separator rows are not claims.

The claim names are the scalar entries of five sources. A later source replaces an earlier
source on a shared name. The order is: `metadata` and `statistics` of `dependency-graph.json`,
`totalFiles` of `file-inventory.json`, and `summary` of `duplicate-symbols.json` and
`unused-analysis.json`. A table value, such as the tag counts of the
duplicate summary, is not a metric. A claim that names one is an unknown claim.

### 15.3 What the check reports

Every failure mode is a problem line on standard error, and the exit code is 1. An empty problem
list means "checked, and every claim matched". It never means "found nothing to check".

| Case | Problem |
|---|---|
| The docs folder is missing, or holds no `.md` file | A message that stops the run. |
| A document without a Verification section | A problem that names the opt-out marker. |
| A section without a parseable row | A problem with other words than the previous case. |
| A claim that names no metric | `unknown claim`. The check never skips it. |
| A cycle count, when the cycle enumeration was truncated | The claim cannot be verified. The count is a floor. |
| A reachability metric, when the build found no entry-point root | The claim cannot be verified. The metric is an artifact of the missing roots. |
| A value that differs from the graph | `claims A but actual is B`. |

The reachability metrics are `orphanedFiles`, `reachableFiles`, `dormantFiles`,
`testOnlyFiles`, `entryRoots` and `noImporterFileCount`. `unusedExportsCount` is not in the set,
because it counts import edges and never reads the roots. A warning of another kind taints no
metric. A package-derivation warning, for example, only changes the package of a file.

A drift line for `orphanedFiles`, `unusedExportsCount`, `unusedExportCount`, `dormantFiles`,
`testOnlyFiles`, `unreferencedAnywhereCount` or `noImporterFileCount` ends with a note: the count
is not a deletion list. A file that only a dynamic `import()` with a computed path loads is live,
and it still counts.

The check skips a document that has the opt-out marker on a line of its own. A line matches when
it equals the marker after the spaces at both ends are removed. A marker inside a sentence, a
code span or a table cell does not match. Such a document would skip its own table, and a stale
claim would pass in silence. The check looks for the marker first, before the sections. So
the marker wins over a heading that looks like a Verification heading. `repo-tools map` writes the
marker alone on a line at the top of each generated report. The marker is
`<!-- repo-map:no-verification -->`, and the config key `map.verificationMarker` adds a second
line of this kind. A blank value of that key matches no line.

On success the check prints one line on standard output.

### 15.4 Differences from the Python tool

| Topic | Python tool | `repo-tools check` |
|---|---|---|
| Success | No output. | One line on standard output. |
| Docs flag | `--docs DIR`. | `--docs=<dir>`, as every flag of this tool. |
| Boolean metric | The document states `True` or `False`. | The document can state the value in any letter case. A drift line shows `true` or `false`. |
| Table values | None exist. | A table value is not a metric (section 15.2). |
| Dead-looking note | Not on `unusedExportCount`. | On `unusedExportCount` too. |
| Opt-out marker | One fixed marker. It matches anywhere in the text. | The fixed marker, and the marker of `map.verificationMarker`. Each must stand alone on a line. |
| Repository without a source file | A graph of zero files. | Exit 1 with the message of `map`. |
| Error text | Wraps only `OSError`, `ValueError` and `TypeError`. | Every error is a message with exit 1, and no stack trace. |
| Line breaks | `splitlines` also splits on form feed, vertical tab and U+2028. | A line break is CRLF, LF or CR. |
| File names | `glob("*.md")` is case-insensitive on Windows only. | The ending `.md` matches in any letter case on every system, so no file is skipped silently. |
| Byte-order mark | Stays in the first line, and hides a heading there. | Removed. |

## 16. The docs subcommand

`repo-tools docs` measures the documentation comments of the source files, plans the missing
comments, and gates the result. The command is a port of `code_docs.py` of the code-docs skill. It
reads TypeScript, JavaScript and Python. Tree-sitter parses each file. A regular expression cannot
tell an exported declaration from the word "export" in a string. A regular expression also cannot
attach a comment to the declaration below it.

### 16.1 The command

```
repo-tools docs scan  [root] [--out=<dir>]
repo-tools docs stub  [root] [--apply] [--path=<path>]
repo-tools docs check [root] [--paths <path>... | --paths-from=<file>]
```

- The root is the first argument that is not a flag, or `--root=<path>`. The default is the
  current folder. A root that is not a folder exits 2.
- `scan` writes `COVERAGE.md` and `coverage.json`. The default folder is `docs/code-docs` below the
  root. `--out=<dir>` sets another folder. A relative `--out` path is relative to the current
  folder. `scan` prints the counts and exits 0.
- `stub` plans one skeleton comment for each symbol that has an M1 issue. The default is a dry run.
  A dry run prints one line for each planned stub and writes nothing. `--apply` writes the stubs.
  `--path=<path>` limits the stubs to one file, or to the files below one folder.
- `check` is the gate. On success it prints `PASS` and exits 0. On a failure it prints `FAIL` and
  one line for each MUST issue, up to 100 lines, and exits 1. A file that does not parse is a MUST
  issue.
- `--paths` limits `check` to the given files, for example the files of a pull request. The flag
  takes every argument up to the next flag, so the root goes before it. `--paths-from=<file>`
  reads one path on each line, as `git diff --name-only` writes them. A path can start with `./`
  or be absolute. An empty list checks nothing and passes. A path with no report is skipped,
  because a deleted file is a changed file. A `note:` line names each source path that the run did
  not measure.
- A flag with a value takes `--name=value` or `--name value`. An unknown flag, a missing value, a
  second root and a flag of another action exit 2.
- Standard error shows the root as `<root>`.

The exit codes are:

| Code | Meaning |
|---|---|
| 0 | The action succeeded. For `check`, the gate passed. |
| 1 | The gate failed, or the root holds no source file to measure. |
| 2 | A usage error, a root that is not a folder, or a malformed `.code-docs.json`. |

A root with no source file is a failed gate and not a pass. A gate that measures nothing has the
look of enforcement and none of the substance.

### 16.2 Modules

| Module | Job |
|---|---|
| `src/docs/index.ts` | The command: the flags, the three actions and the exit codes. |
| `src/docs/model.ts` | The shapes `DocSymbol`, `FileReport` and `Stats`, and the `TODO:` marker. |
| `src/docs/discovery.ts` | The source files, the skip lists, and the exclusions of `.code-docs.json`. |
| `src/docs/analyse.ts` | Reads each file and calls the analyser of its language. |
| `src/docs/python.ts`, `typescript.ts` | One analyser for each language. Each finds the declarations and the doc of each one. |
| `src/docs/rules.ts` | The rules M1 to M4, S2, S5 and S6. Both analysers call one function. |
| `src/docs/report.ts` | The counts, `COVERAGE.md` and `coverage.json`. |
| `src/docs/stub.ts` | Plans the skeleton comments and applies them. |

The analysers use the tree-sitter loader of `repo-tools map` (section 14.1). The S6 rule calls the
prose check of `repo-tools ste`.

### 16.3 What the tool measures

**The files.** The files are the files that git tracks with the suffix `.py`, `.ts`, `.tsx`,
`.js`, `.jsx`, `.mjs` or `.cjs`. A file below a folder named `node_modules`, `dist`, `build`,
`bundle`, `out`, `coverage`, `vendor` or `target` is not read. The same holds for the other
generated or cache folders that `src/docs/discovery.ts` lists. A file with a generated name
(`.d.ts`, `.min.js`, `.bundle.js`, `.g.ts`, `_pb2.py`) is not read either. A stub in a generated
file disappears at the next build.

Outside a git work tree, a walk of the file system finds the files. The provenance string says so.
If git tracks no source file but the folder holds untracked source, the run measures the untracked
files and says so. If git tracks source and the folder also holds untracked source, the run does
not measure the untracked files. It warns with their count. Every report states its provenance,
because two counts from two methods cannot be compared.

`.code-docs.json` at the root excludes paths from every action. Each entry has a `path` and a
non-empty `reason`. The path matches whole segments: `assembly/` does not match
`assembly_tools/`. The output names each exclusion. A file that is not valid JSON, an entry
without a reason, or a wrong shape exits 2. A broken config would hide files.

**The symbols.** The tool reports the declarations that can have a doc.

- In TypeScript and JavaScript: functions, generators, classes, abstract classes, interfaces,
  type aliases and methods. A constant that holds an arrow function is not a symbol. A method is
  not exported, because its class is. A declaration is exported when an `export` statement wraps
  it. A doc is a block comment that starts with `/**` and ends directly above the declaration, or
  above the outermost `export` statement. A plain block comment and a line comment are not
  documentation.
- In Python: functions, async functions and classes, at any depth. With a literal `__all__` at the
  top of a module, a name is exported when `__all__` lists it. Without `__all__`, a name is
  exported when it has no leading underscore, or when it has the form `__x__`. The doc is the
  docstring: the first statement of the body, when it is a string.

A `.tsx` or `.jsx` file needs the TSX grammar, and another file needs the TypeScript grammar. The
wrong grammar gives a tree of error nodes and not an exception. Thus a file with a parse error is
an unparsed file. The tool does not know the content of such a file, so the file never counts as
clean. Two constructs are valid TypeScript that
the grammar cannot read: a property named `abstract`, and `export type * from 'm'`. The analyser
rewrites both to text of equal length before the parse, so each position of the tree still points
at the real source.

The coverage percentage is the exported symbols with a doc, divided by all exported symbols. The
count includes the symbols of test files. A report with no exported symbol shows 100.

### 16.4 The rules

| Rule | Tier | The rule |
|---|---|---|
| M1 | MUST | An exported symbol has a doc. A test file is exempt. |
| M2 | MUST | The doc has a summary line. |
| M3 | MUST | The doc names no parameter that the signature lacks. |
| M4 | MUST | The doc holds no `TODO:` marker. |
| M5 | MUST | A file uses one doc dialect. |
| S2 | SHOULD | The summary ends with a full stop. |
| S5 | SHOULD | The doc does not repeat a type that the signature holds. |
| S6 | SHOULD | The prose follows Simplified Technical English. The detail names the `STE-*` rule. |

Only a MUST issue decides the exit code of `check`. A SHOULD issue is in the report and the gate
does not read it. A test file is a path below `test`, `tests`, `__tests__` or `spec`, or a file
named `test_*`, `*_test.*`, `*.test.*` or `*.spec.*`. A test file is exempt from M1 only. A stale
doc is wrong in a test file too, so M3, M4 and M5 still apply. A symbol with an M1 issue gets no
other issue, because every other rule reads the doc.

The dialects are `google`, `numpy` and `rest` for Python, and `tsdoc` and `jsdoc` for TypeScript. A
comment with no marker of a dialect has none, and it never makes a file mixed. JSDoc puts a
`{type}` after a tag and TSDoc never does. Thus the `{type}` form is the evidence of JSDoc. M5
shows the dialects as a list in the Python style, for example `['jsdoc', 'tsdoc']`.

S5 reads an `Args` or `Parameters` block with a type in brackets in Python. In a `.ts` or `.tsx`
file, S5 reads a `{type}` after `@param`. In a `.js` file the brace is correct JSDoc, so S5 does
not apply there. The S6 check reads the prose of the doc. The prose has no comment delimiter, tag
line or code.

### 16.5 The stub writer

`stub` is the only part of the command that changes a source file. Five properties make the change
safe.

1. A dry run is the default. A write needs `--apply`.
2. An existing doc is never changed. Only a symbol with an M1 issue gets a stub.
3. The insertions go bottom up. Each remaining insertion point stays valid.
4. The file is parsed again after the insertions. A file that no longer parses is not changed, and
   the output says `REVERTED`.
5. Every stub holds the marker `TODO:`. The gate fails on a surviving marker (M4), so a skeleton
   cannot become the finished doc.

The writer keeps the line ends of the file. A file with CRLF stays CRLF. A file that holds a
carriage return with no line feed is skipped, and the output names the file. A Python stub goes
inside the body, below the line that ends the signature. The writer finds that line by the depth
of the round brackets, so a signature on many lines works. A TypeScript stub goes above the
outermost `export` statement, and thus above each decorator.

### 16.6 Differences from the Python tool

`docs/parity-docs.md` gives the measurement. The table lists each difference.

| Topic | Python tool | `repo-tools docs` |
|---|---|---|
| Python parser | The `ast` module. | Tree-sitter. The declarations and the lines are the same. A few errors that CPython finds while it builds the tree, for example `def f(*)` and `del f()`, pass here. |
| Python syntax error | `SyntaxError: ` and the message of CPython. | `SyntaxError: invalid syntax at line N`, or an `IndentationError`, a Python 2 statement or a leading zero. The line is the line of the first error node. |
| Byte-order mark in a Python file | The file does not parse. | The mark is removed, and the file parses. |
| Docstring text | Decoded by CPython. | Decoded with the same rules. `\N{name}` stays as written, because the tool has no table of Unicode names. |
| Order of the symbols | A Python file: breadth first (`ast.walk`). A TypeScript file: by line, and two symbols on one line in reverse order. | The order of the file, for both languages. |
| One-line summary | `/** Text. */` gives `Text. */`, so S2 fails. | The closing `*/` is not part of the summary. |
| STE of a comment | The delimiters count as words. | A delimiter is not prose. This removes false STE-LEN issues and finds the STE-REF issue of the first sentence. |
| `.tsx` and `.jsx` | The TypeScript grammar. | The TSX grammar, for the scan and for the check after a stub. |
| Root with no source file | `PASS` with 0 of 0, exit 0. | Exit 1 with a message. |
| Root that is not a folder | The same pass, with 0 files. | Exit 2 with a message. |
| Malformed `.code-docs.json` | A Python trace, exit 1. | Exit 2 and one message. |
| Targets of `stub` | Each exported symbol with no doc, test files too. | Each symbol with an M1 issue. A test file is exempt from M1, so it gets no stub. |
| Line ends of `stub` | Writes LF in a file that had CRLF. | Keeps CRLF. |
| `--paths` | Compares the text of the paths. | Removes a `./` prefix and makes an absolute path relative to the root. A `note:` line names an unmeasured source path. |
| `exported_documented_pct` in JSON | A float: `55.0`. | A number: `55`. The key names are the same. |
| Line ends of standard output | The line end of the platform. | LF always (rule R1). |
| `COVERAGE.md` | Ends with a Verification list. The footer says that `check` recomputes each value of the report. | The same list. `check` measures the code again and does not read the file, and the footer says so. |
