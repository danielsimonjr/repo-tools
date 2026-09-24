# Changelog

All notable changes to this project are recorded in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- depgraph: the duplicate allowlist is read from `duplicate-allowlist.json` in the output folder
  by default (design section 5.1), not from `tools/create-dependency-graph/`. A repo that keeps
  the allowlist at the old path sets `depgraph.duplicateAllowlist` to that path.
- depgraph: the default skip list of every walk is `node_modules`, `dist`, `build`, `coverage`
  and `.git` (design section 3.2). The graph walks skipped `node_modules` only, and the census
  walks skipped `node_modules` and `dist`; the census walks still skip dot-folders. A folder
  with one of these names inside a source folder is now left out; `--exclude` sets another list.
- `compress -d` (K9) restores JSON only in this version. `-d` on any other format (yaml, csv,
  tsv, text, log, typescript, javascript, xml, html, markdown) exits 1 with the message
  "decompress supports JSON only in this version" and writes no file. In batch mode, each such
  file fails with the same message, and the exit code is 1. The original tool replaced text in
  the other formats: this corrupted YAML, CSV and TSV data, and the XML and HTML legend was not
  read. The library function `decompress` throws for a format that is not JSON. The help text
  tells the limit. The compact formats do not change. Removed goldens: the 30 non-JSON
  `tests/golden/compress/*.restored.*` files, and the 30 non-JSON `-d` runs in
  `tests/golden/compress/stdout.json`.

### Fixed

- depgraph flags are strict (D10a). An unknown flag, a flag without its value (`--root`,
  `--root=`), a value on a flag that takes none (`--all=yes`) and a second root (two positional
  arguments, or `--root=` and a positional argument) exit 1 with a message on standard error,
  and the run writes nothing. The parser ignored an unknown flag, so a typing error such as
  `--strict-orphan` gave a run without the gate. The error text names the flag, never its
  value. `--help` and `-h` win over any other argument. `-a`, `-t` (no operation) and `-h`
  stay. No golden changes.
- README: the status line said that the three subcommands are not built yet. It now states
  the current state: all three work, `depgraph` runs with its default settings, and `compress -d`
  restores JSON only.
- depgraph F44: a `.d.ts` file is never a "potentially unused file". A declaration file declares
  ambient types and no file imports it, so the list named every ambient declaration. In the
  `mini-repo` fixture, `src/ambient.d.ts` leaves the list (2 -> 1).
- depgraph F43: in single-package mode, an import of the package's own npm name (`'my-pkg'`,
  `'my-pkg/sub'`) resolves to its own source. The target of the `exports` entry (the first
  condition that is not `types`), else `main`, maps from `dist/` to `src/` and from `.js` to
  `.ts`; when that file does not exist, `'my-pkg'` gives `src/index.ts` and `'my-pkg/sub'` gives
  `src/sub.ts`, else `src/sub/index.ts`. The port classed a self-import as an external package,
  so the files that only a self-import reached were orphans and their exports were unused. The
  edge is now a workspace dependency with `directory: ""` in the JSON and YAML reports. No
  golden changes.
- depgraph F40 (corrects F25): a member call on a dynamic import is a runtime edge also when a
  type-argument list comes before the call. `import('./x').then<T>(cb)` was a type-only edge;
  it is now runtime, as `import('./x').then(cb)` is. `type T = import('./x').Name` and
  `import('./x').Box<T>` with no call after it stay type-only. No golden changes.
- depgraph F39: the comment stripper (`src/mask.ts`) recognizes regular-expression literals. A
  `/` starts a regex after an operator, a punctuator, `=>`, a keyword such as `return`, or at the
  start; after a name, a number, `)` or `]` it is a division. A quote, a backtick or a `/` in a
  regex (`/"/g`, `/a\//`, `/[/`]/`) no longer opens a string or starts a comment, so the in-file
  reference count of an unused export (F24) no longer counts a comment after `/"/` or loses the
  code after `/a\//`. No golden changes.
- depgraph F38: a runtime dynamic `import()` is a namespace use. Its edge records `*`, so the
  exports of a module that only `import()` loads are no longer "unreferenced anywhere". In the
  JSON and YAML reports the edge changes from `imports: []` to `imports: ["*"]`. When a static
  runtime import of the same file exists, that edge gets the `*`. A type-position `import()`
  still records no names. In the `mini-repo` fixture, `dynamicValue` of `src/dyn.ts` leaves the
  unused exports (2 -> 1).
- depgraph F42: a census gap (a `.ts` file that the census does not list, or a census entry that
  is not on disk) gives a warning and exit 0 by default, in both modes. The new flag
  `--strict-census` makes it fail; `--check-census` stays a strict gate. A single package with
  `.ts` folders outside `src/` and the census folders no longer exits 1.
- depgraph F41: both census walks skip a folder that a negated workspace pattern excludes
  (`!packages/skip`), so its files no longer fail the census as "absent" (exit 1). F36 had removed
  the package from the workspaces but not from the census walk.
- depgraph M1 follow-up: the census walks `benchmarks/` and classes its files as `bench` (a new
  disposition). A single package with benchmark scripts failed the census as "absent" and exited 1.
- depgraph M1: the single-package model. The inventory (`FILE_INVENTORY.md`,
  `file-inventory.json`), the census self-check and the dormancy split run in both modes; the
  port ran them in monorepo mode only, so single-package dormancy was always 0. In
  single-package mode the root package is the one package: `src/index.ts`, and the `exports`
  subpaths, `bin` targets, scripts and tsup entries of the root `package.json` are build roots.
  An `exports` subpath that names a folder (`./util`) reaches `src/util/index.ts` when
  `src/util.ts` does not exist. The single-package graph still holds every file and reports
  the dormancy; the new flag `--reachable-only` restricts the graph to reachable files. An
  orphan now gives a warning on standard error, and fails the run only with the new flag
  `--strict-orphans` (also with `--check-census`); the port failed a monorepo run on any
  orphan. In the `mini-repo` goldens, `src/cli.ts` and `src/util/index.ts` are build entries,
  not unused files, `clamp` is in the `util` export surface, `src/orphan.ts` is a dormant
  orphan, and the run writes the two inventory reports.
- depgraph F37: the object form of the tsup `entry` option (`entry: { worker: 'src/worker.ts' }`)
  names build roots, as the array form does (F14). Each string value after a `:` is an entry,
  in file order. The port read the array form only, so an object-form entry was an orphan and
  failed the census self-check.
- depgraph F36: a negated workspace pattern excludes the package folders that it matches, in
  `package.json` `workspaces` (npm and Yarn) and in `pnpm-workspace.yaml`. `!packages/skip` and
  a glob such as `!packages/old-*` work, with or without a leading `./` or a trailing `/`. The
  port removed the negated pattern from the list and never excluded the folder, so a
  `packages/*` pattern still made `packages/skip` a workspace package. The census self-check
  still walks every `.ts` file, so a `.ts` file in an excluded folder fails it as "on disk but
  absent from the census".
- depgraph F35: `package.json` type guards. A root `package.json` that is `null` or not a JSON
  object gives the warning "package.json is not a JSON object, using defaults" (the port
  crashed with a TypeError, exit 1). A workspace `package.json` that is not a JSON object is
  skipped with a warning. A `scripts` value that is not a string, a `scripts` field that is not
  an object, and a workspace pattern that is not a string are ignored with a warning; the
  package stays a workspace package (the port dropped it without a message, and the census
  then failed on its files).
- depgraph F34: no walk follows a link (a symbolic link or a junction). A link can point to
  another repository, to a missing path or to its own parent: the port counted the files of a
  linked sibling tree as its own, crashed with ENOENT on a dangling link, and failed on a
  self-loop. Each walk (source, test, census, maximal and workspace discovery) now checks
  `lstat` and skips a link. The run lists each skipped link on standard output
  (`Skipped N links (not followed):`), and `file-inventory.json` (`skippedLinks`) and
  `FILE_INVENTORY.md` (section "Skipped links") list them too. Goldens: the two inventory
  reports of the `mono-repo` sets gain the empty list and the section.
- depgraph F33: a `node [--flag ...] ./dist/x.js` package script seeds `src/x.ts` as a build
  root. The pre-port pattern held a backspace byte (0x08) where a word boundary was meant, so
  it never matched, and the port kept the byte on purpose. A script-run file was then an
  orphan, and the census self-check exited 1; it now exits 0.
- depgraph F32: removing the `.ts` extension removes the suffix only. The port removed the
  first `.ts` text in a path: the runtime cycle label (`c.rtp` of
  `dependency-summary.compact.json`) of `src/a.tsx.ts` was `ax.ts`, and a single-package module
  took its name from its directory less the first `.ts` (`src/lib.ts/x.ts` was in module `lib`,
  `src/a.ts.d/y.ts` in module `a.d`). The label is now `a.tsx`, and a module name is its
  directory name as it is (`lib.ts`, `a.ts.d`).
- depgraph F31: the `entryPoints` list of `dependency-graph.json` matches the path segments
  `src/index.ts`, not the text suffix. `src/mysrc/index.ts` ends with the text `src/index.ts`
  and was listed as a main entry point. One helper (`isSrcIndex`) now makes this check for the
  entry list, the public surface and unused detection.
- depgraph F30: a relative specifier resolves to a `.tsx` file and to a directory index. The
  candidates are, in order: for `./x.js`, `x.ts` then `x.tsx`; for `./x.ts` or `./x.tsx`, the
  file itself; for `./x`, `x.ts`, `x.tsx`, `x/index.ts` and `x/index.tsx`. The first candidate
  that is in the graph wins. The port mapped every specifier to `<x>.ts`, so `import './Z'`
  pointed at a missing `Z.ts` and `Z/index.ts` looked unused. The scan still reads `.ts` files
  only, so an edge to a `.tsx` file lands when `.tsx` input is on.
- depgraph F29: `export { r as s } from './x.js'` records `s` only as an export of the
  re-exporting file, and `export type { T as U } from` records `U` only. The port recorded the
  source name too (`r` and `s`), so `totalExports` and the export lists were too high. The
  re-export edge still carries the source name `r`, so `r` stays used in `./x.js`.
- depgraph F28: a symbol name is escaped before it goes into a regular expression, and the
  in-file reference count matches the name between identifier boundaries. A `$` in a name was a
  RegExp anchor, and `\b` does not hold next to a `$`. The export declarations also read a `$`
  in a name, so `export const $store` is an export (the port read `a$b` as `a` and skipped
  `$store`).
- depgraph F27: comment removal does not cut a `//` or a `/*` inside a string literal. The port
  removed comments with regular expressions, so `const u = 'http://x'; import('./b.js');` lost
  its import, and a `'src/*'` string removed every line up to the next `*/`. The parser and the
  duplicate classifier now remove comments with the string-aware scanner of `src/mask.ts`. The
  regex functions of `src/mask.ts` are removed.
- depgraph F26: cycles are reported by strongly connected component (Tarjan's algorithm, linear
  time), not by the cycles that a depth-first search meets. The search missed cycles, and the
  cycles that it listed depended on the file order. A runtime component is a component of the
  runtime edges; a type-only component is a component of all edges that is not identical to a
  runtime one. A component has 2 or more files, or 1 file that imports itself. Each component
  lists its `members` in code-unit order and one `cycle`: the shortest cycle through the first
  member. Renamed fields, because the meaning changes: `dependencyGraph.circularDependencies`
  is now `dependencyGraph.cyclicComponents` (`{ runtime: [{ members, cycle }], typeOnly }`,
  without `total`, `runtimeCount` and `typeOnlyCount`); `statistics.runtimeCircularDeps` is now
  `runtimeCyclicComponents`, `statistics.typeOnlyCircularDeps` is now
  `typeOnlyCyclicComponents`, and `runtimeFilesInCycles` and `typeOnlyFilesInCycles` are new.
  In `dependency-summary.compact.json`, `c.rt` and `c.to` are now `c.rtc` and `c.toc`, and
  `c.rtf` and `c.tof` (file counts) are new. `DEPENDENCY_GRAPH.md` and the standard output
  name cyclic components and their file counts.
- depgraph F25: a dynamic `import()` is a runtime edge unless it is in a type position. A type
  position is `typeof import(...)`, or `import(...).Name` with no call after it (a type alias,
  an annotation, an interface member). `await import()`, `import().then(...)`, a bare
  `import();`, `const p = import()`, `Promise.all([import()])` and `return import()` are
  runtime. The port recorded every `import()` as type-only, so a runtime cycle through a
  dynamic import was classed as type-only. A runtime `import()` of a file that a type-only
  import also names adds a runtime edge. In the `mini-repo` fixture, the `./dyn.js` edge of
  `src/B.ts` is now `Import`, not `Import (type-only)`, and the type-only import count is 3.
- depgraph F24: the in-file reference count of an unused export reads the source without
  comments. An export named only in its own JSDoc or in a `//` comment stays in "Unreferenced
  anywhere (deletion candidates)"; the port counted the comment text as a use. A use in code
  still counts. Comments are removed with the string-aware scanner of `src/mask.ts`.
- depgraph F23: a dynamic `import()` with a backtick-quoted relative specifier, such as
  ``import(`./x.js`)``, is a dependency edge. A template with a `${` substitution names no fixed
  file and gives no edge. The port read single and double quotes only.
- depgraph F21: in `DEPENDENCY_GRAPH.md`, an export list of more than 8 names
  (`LONG_EXPORT_LIST_THRESHOLD`) renders as a fenced `text` block under its label, with the names
  separated by ", " and wrapped at 100 characters. A list of names is data, not prose; the long
  inline list read as one long sentence. A list of 8 names or fewer stays inline, and the names
  and their order do not change. The other reports keep their list form.
- depgraph F20 (already in the privacy check; a regression test pins it): a repository whose
  git index tracks a `.exe` file fails the privacy check with a `binary` finding, and this
  repository tracks no `.exe` file.
- depgraph F19 (already in the port; a regression test pins it): a test that imports a barrel
  covers each file that the barrel re-exports, through `export *`, `export { } from` and a
  chain of barrels. A file that no barrel re-exports stays untested.
- depgraph F18: a `.d.ts` file is not in the test coverage denominator. It declares types and
  holds no code that a test can run; the port listed it as an untested source file. The graph
  keeps the file. In the `mini-repo` fixture, `src/ambient.d.ts` leaves the coverage reports:
  5/14 source files have tests (35.7%), not 5/15 (33.3%).
- depgraph F17: a package `src/index.ts` that re-exports nothing is an entry root, not a
  "potentially unused file" (the port exempted only the root `src/index.ts`). Regression tests
  now pin the other classifier roots, which were already in the port: a `bin` target, an
  `exports` subpath entry with its `export type { } from` names, an export that only a test uses
  (not unused) and a file that only a test reaches (`test-only`), and the build roots that a
  `tsc -p` tsconfig and a config `new URL()` seed.
- depgraph F16 (already in the port; a regression test pins it): the default output folder is
  `docs/architecture`, in lower case. A run creates exactly one folder under `docs/`, with that
  exact name, in single-package mode and in monorepo mode.
- depgraph F15: `package-export-surfaces.json` lists the public surface of each package only: the
  names of a package root (`src/index.ts`, an `exports` subpath, a `bin` target, a config entry)
  and of each file that a re-export chain from a root makes public. An export that only relative
  imports inside the package use is internal and is not listed (the port listed every named
  export). The run computes one public surface for all modules, so a file that a root in another
  module re-exports stays public. Known limit: in single-package mode the `exports` subpaths and
  `bin` targets of the root `package.json` are not roots yet (single-package mode is fix M1).
- depgraph F14: every `entry: [...]` array of a tsup config names build roots (the port read
  only the first), and each `tsup.config.*` file (`.ts`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs`,
  `.json`) is read whenever it exists, also when no `build` or `dev` script calls `tsup`. In
  the `mono-repo` fixture, `packages/core/src/worker.ts` (the second entry array) is now a build
  entry, not an orphan, so the census passes and the run exits 0 (it exited 1).
- depgraph F13 (already in the port; a regression test pins it): the packages of a pnpm
  workspace come from `pnpm-workspace.yaml`. The new fixture `tests/fixtures/depgraph/pnpm-repo`
  has a `packages/*` glob and a plain folder pattern, and every package is found.
- depgraph F12: a single-package repo without `src/` keeps its files in the graph. The scan of
  each top-level source folder was already in the port, but the module map took only `src/`
  paths, so `dependency-graph.json` held no modules. Now `<dir>/x.ts` goes to module `<dir>`
  and `<dir>/<sub>/x.ts` to module `<dir>/<sub>`.
- depgraph F11 (already in the port; a regression test pins it): a dynamic `import('./x.js')`
  is a dependency edge, so its target is not an unused file. Fix F25 sets the kind of the edge.
- depgraph F10: test coverage follows chains of bare side-effect imports. When a test imports
  `a`, and `a` holds `import './b.js';` and `b` holds `import './c.js';`, then `b` and `c` are
  covered (a command registry is this shape). A namespace import does not carry coverage, and a
  side-effect cycle ends.
- depgraph F9 (already in the port; a regression test pins it): each `package.json` `exports`
  subpath is a reachability root, so its target file and the files it imports are reachable.
- depgraph F8 (already in the port; a regression test pins it): an import in a test file counts
  as usage, so an export or a file that only a test uses is not reported as unused.
- depgraph F7: an import of compiled output lands on its source file. `../dist/x.js` resolves
  to `src/x.ts`, and `../dist/src/x.js` (a build that mirrors the source tree) also resolves to
  `src/x.ts`, so a test of the built package covers the source and counts as usage. A `dist/`
  folder inside `src/` stays source. The `bin` case (`dist/src/cli.js` seeds `src/cli.ts`) was
  already in the port; the test pins it.
- depgraph F6 (already in the port; a regression test pins it): a comment inside a multi-line
  `{ }` import, export or re-export list is not part of a symbol name in any report.
- depgraph F5: before it writes dependency-graph.yaml, depgraph probes the loaded js-yaml. When
  that copy ignores the `quoteStyle` option, the run stops with exit 1 and a message, and writes
  no YAML with the wrong quote characters. The report sets `quoteStyle: 'single'` explicitly.
- depgraph F4: dependency-graph.yaml is built with js-yaml 5.4.2 (pinned exactly; it was
  4.3.2). js-yaml 5 has no default export and no `quotingType` option, and ships its own types,
  so `@types/js-yaml` is removed. The YAML of every golden set is byte-identical.
- depgraph R1: every report ends with exactly one LF. The JSON reports had no trailing newline,
  and `duplicate-symbols.md` and `unused-analysis.md` had two. The goldens change in the last
  byte only.
- The chunk link tests remove their links the right way on each system: `unlinkSync` for the
  ordinary symlink that Linux and macOS create, `rmdirSync` for a Windows junction. Their cleanup
  failed on Linux and macOS with ENOTDIR.
- `compress` JSON keeps the text of every number, in the compact file and after `-d`
  (lossless passthrough). The parser keeps the source text of each number (`JSON.parse` with
  the source text of the reviver, and `JSON.rawJSON`), so a number that a JavaScript number
  cannot hold does not change: `12345678901234567890`, `1e400`, `-1e400`, `1e-400`,
  `12345678901234567890.5` and `0.12345678901234567890123` come back byte for byte. Before, a
  plain `JSON.parse` changed them (`1e400` became `null`, `1e-400` became `0`, and
  `12345678901234567890.5` became `12345678901234567000`), and the unreleased fixes refused
  the file instead (exit 1). Those refusals are removed. On a runtime without source-text
  access, `compress` refuses a number that would change, with its JSON path (for example
  `$.items[3].v`). The help text tells the rule. The library function `assertSafeNumbers` is
  removed; `parseLossless` and `assertNumbersKept` replace it. A known limit, in the help
  text: an integer-like object key (`"2"`, `"10"`) moves to the start of its object, in numeric
  order, because `JSON.parse` orders the keys so. The values do not change.
- `compress --batch` finds a compact file by its name in any case: `X.COMPACT.md` is skipped
  in compression and selected by `-d`. `-d` removes `.compact` in any case from the base name
  (`B.COMPACT.json` gives `B.json`). Before, batch compression wrote `X.COMPACT.compact.md`.
- `compress -d` does not write over an existing output file without `--yes`, in single mode
  (also with `-o`) and in batch mode. It exits 1 with a message, and the file does not change.
  `--dry-run` needs no `--yes`. Before, `-d` wrote over the file with no backup, so edits made
  after the compression were lost. The unit golden test removes the original file before the
  `-d` run, because the goldens hold runs without `--yes`; the golden files do not change.
- `chunk merge` names the chunk number and the chunk file name when a JSON chunk is not valid
  JSON or is not a JSON object, for example `JSON chunk 2 (002-b.json) is not valid JSON: ...`.
  Before, the message was only the parser error, for example `JSON Parse error: Unexpected EOF`.
- The `chunk` round-trip tests merge into a new file (`-o`) and compare that file with the
  input. Before, they merged over the source and compared the source, so a merge that wrote
  nothing passed: with the final write removed, 19 of 20 of these tests passed; now 15 of 20
  fail, as they must.
- `chunk` does not let a manifest target its own chunk folder. `merge` and `status` exit 1 when
  the `sourceFile` is in the chunk folder (by path text or by real path), and `merge` exits 1
  when `-o` names a file in the chunk folder. `split -o` exits 1 when the chunk folder holds the
  source file. A chunk file named `manifest.json`, in any case, is an unsafe chunk file name.
  Before, a `sourceFile` that named a chunk file overwrote that chunk, a `sourceFile` of
  `manifest.json` overwrote the manifest (with `--allow-shrink` or a larger result), and a
  chunk named `MANIFEST.JSON` read the manifest as a chunk.
- `chunk` keeps mixed and CR line breaks. `split` records each line break of a file with mixed
  or CR-only line breaks in the manifest, as runs such as `"lineBreaks": "crlf*2,lf*1"`, and
  `merge` puts each one back. The shrink guard compares the restored bytes. A merge of the
  unchanged chunks gives the file byte for byte, also without a final line break. When an edit
  changes the number of lines, every line break uses the most common original one, and `merge`
  shows a note. A manifest without the field merges as before. Before, a mixed file split and
  merged without edits exited 1 on the shrink guard, and a CR-only file silently became LF.
- `chunk split -o` refuses a chunk folder on another volume (another drive or share) than the
  source file. It exits 1 with a message and writes nothing. Before, split wrote an absolute
  `sourceFile` in the manifest, and `merge` and `status` then refused that manifest, so the
  edited chunks could not be merged.
- `chunk merge` and `chunk status` read only regular chunk files in the chunk folder. A chunk
  file that is a symbolic link, a junction or a folder, or whose real path is outside the real
  chunk folder, gives exit 1 with a message. Before, a chunk file that was a symbolic link read
  any file into the merged source.
- `chunk merge` and `chunk status` compare the real paths when they check that the source file
  is in the parent folder of the chunk folder. Before, the check compared the path text only:
  a `sourceFile` such as `../link/t.md`, where `link` is a junction or a symbolic link to an
  outside folder, passed the check, and `merge` wrote the outside file with exit 0. Now the real
  path of the parent folder and of the nearest existing folder of the source file must agree.
  A path that does not resolve is outside. `--yes` still confirms an outside source file.
- `compress` JSON: an abbreviation does not equal a key in the data. The set of used
  abbreviations now starts with every key in the document and with the reserved keys `_legend`
  and `data`. Before, the input `{"name":"a","n":"b"}` at `medium` gave the compact file
  `{"_legend":{"n":"name"},"n":"b"}`: the value `"a"` was lost in the compact file, and `-d`
  gave `{"name":"b"}`. The compact format does not change.
- `compress` JSON keeps the shape of the top-level value. The compressor writes an array, a
  single value (a string, a number, `true`, `false` or `null`) and an object with the one key
  `data` as `{"_legend":{...},"data":<value>}`. `-d` unwraps `data` when `_legend` and `data`
  are the only keys. Before, a top-level array became an object with the keys `"0"`, `"1"`, ...,
  and a single value came back as `{"data":<value>}`.
- `compress -b -d` processes only the files with `.compact` in the name, and prints the number
  of skipped files. It never writes to its input: when the output name equals the input name,
  it writes `<name>.restored<ext>`, as single mode does. Before, `compress -b -d -p "*.*" dir`
  restored every matched file and wrote the result over the input when the name had no
  `.compact` (for example `conf.yaml` and `d.csv`).
- `compress -d` removes `.compact` from the file base name only, where it comes before the
  extension or at the end. A folder name does not change. Before, `-d` removed the first
  `.compact` anywhere in the path: `p.compact/r.compact.md` gave `p/r.compact.md`. A base name
  with `.compact` in another place (`a.compact-old.json`) gives `a.compact-old.restored.json`.
- `compress` JSON keeps a `__proto__` key. The key rename defines each key as an own property.
  Before, the rename assigned the key `__proto__`, which set the prototype of the copy: `-d` on
  `{"__proto__":{"k":1},"b":2}` gave `{"b":2}`.
- `compress --pattern` escapes every RegExp metacharacter. Only `*` and `?` are wildcards.
  Before, only `.` was escaped: `a+b.md` also matched `aab.md`, `[x].md` matched `x.md`, and
  `a[.md` stopped the run with a `SyntaxError`.
- `compress` command-line errors exit 1 with a message and write no file: an unknown option
  (for example `--nope`, or `--level=aggressive`, which is not a supported form), an option
  without a value (a trailing `-o`, or `-o` followed by another option), a missing file in
  `--batch` mode, and two or more inputs without `--batch`. Before, an unknown option was
  ignored, an option without a value used a default value, `compress -b missing.json ok.md`
  warned and exited 0, and `compress a.md b.md` processed only `a.md` and exited 0. The help
  text lists these errors, and no longer tells a `--pattern` default that applied only to a
  `-p` without a value.
- Dependabot uses the `bun` ecosystem instead of `npm`, so an update changes `bun.lock` with
  `package.json`; the npm ecosystem changed only `package.json`, and every CI job then failed on
  the frozen lockfile. The `bun` ecosystem gives version updates only; advisories still reach the
  repository as Dependabot alerts.
- Privacy check: the address in the `Signed-off-by: dependabot[bot]` trailer is allowed, so a
  Dependabot pull request no longer fails the email rule on its own trailer.
- depgraph F3: every Markdown report starts with the verification marker and the do-not-edit
  banner, and the banner names the regenerate command. The default command is
  `repo-tools depgraph` (it was `npm run docs:deps`, a script name of one consumer); a null
  marker omits the marker line. The configuration keys come with task D10.
- depgraph F1: no report holds a date stamp. The `lastUpdated`, compact `d`, `generated` and
  `generatedAt` fields and the `**Generated**` and `**Last Updated**` lines are gone, so two runs
  on one tree give the same bytes on any day. A test runs every golden set under two mocked
  clocks and requires identical bytes and no ISO date.
- depgraph F22: every depgraph sort uses UTF-16 code-unit order; no source file calls
  `localeCompare`, so the order does not depend on the ICU data of the runtime. The export
  surfaces and the coverage lists of both fixtures change in order only.
- depgraph F2: every walk lists folders in code-unit order through one module
  (`src/depgraph/dirlist.ts`), so the reports do not depend on the order that the file system
  returns. A reversed listing now gives the same bytes. The `mini-repo` goldens change in order
  only. `scripts/update-depgraph-goldens.ts` rewrites the goldens in the commit of a fix.
- `compress` (K5): `--level` and `--format` are validated. An unknown value (for example
  `--level fast`) exits 1 with a message that lists the valid values, and writes no file. The
  original tool accepted any value and used other settings without a message.
- `compress` (K6): the batch walk sorts the entry names of each folder in code-unit order. The
  original tool used the `readdir` order, which differs by file system, so the batch output and
  the order of the written files differed by machine. The sort is by entry name, not by full
  path, because the path separator differs by OS.
- `compress`: batch compression skips a file with `.compact` in its name and prints the number
  of skipped files. The original tool compressed its own output again, for example into
  `README.compact.compact.md`. Batch decompression (`-d`) still selects `.compact` files.
- `compress`: a directory without `--batch` exits 1 with a message. The original tool stopped
  with an `EISDIR` stack trace. In batch mode, a directory without `--pattern` exits 1 with a
  message (the original reported an `EISDIR` failure for the folder), and `--pattern` with a
  file in place of a directory exits 1 with a message (the original stopped with `ENOTDIR`).
  `--batch --pattern` without a directory searches the working folder, as before.
- `compress -d` for JSON renames the keys by structure. The original tool replaced each
  abbreviation everywhere in the text, so an abbreviation such as `n` also changed every `n` in
  other keys and in values (`"items"` became `"itemetadatas"`). Now a JSON object with a
  top-level object round-trips to a deep-equal value. The compact format does not change. The
  three JSON restore goldens now hold the correct output.
- `chunk merge` and `chunk status` check the manifest before they read or write a file. A chunk
  file name must be a plain file name: a name with `/`, `\`, `:`, or the name `.` or `..`, exits
  1. A 2.x manifest with an absolute `sourceFile` exits 1; a 1.x manifest can still hold one.
  When the source file is outside the parent folder of the chunk folder, `merge` exits 1 unless
  `-o <file>` names the target or `--yes` is given, and `status` exits 1 unless `--yes` is given.
  Before this fix, a manifest from another person could make `merge` overwrite any file and read
  any file into it. The manifest reader also checks the shape (version, `sourceFile`, `chunks`
  with `filename` and `hash`). A bad shape exits 1 with a message that starts with
  "invalid manifest", not with an internal Node error.
- `chunk merge` (K7): a JSON array or an invalid JSON file merges back to its original text.
  `split` writes such a file as one whole-file chunk (`_array` or `_invalid_json`), but `merge`
  read every JSON chunk as an object, skipped the chunk and wrote `{}` over the source file.
- `chunk` (K8): a split and then a merge of the unchanged chunks gives the source file byte for
  byte, for each file type. A property test runs this cycle on every chunk fixture: Markdown, a
  JSON object, a JSON array, invalid JSON, TypeScript, and the de3118a lexer fixture. Before
  this fix, the TypeScript merge dropped blank lines, plain block comments, the final newline
  and each top-level statement that is not a declaration (for example `console.log(main());` and
  `module.exports = ...`). The TypeScript splitter now puts each line of the file into one
  section: the text between two units goes to the earlier unit up to its last blank line, and a
  comment directly above a declaration goes to that declaration. A top-level statement becomes a
  section `_statement`. `export default`, `declare`, `export abstract class`, `const enum` and
  `declare module` are declarations. A JSON key chunk now holds the member text of the source as
  it is, and the manifest field `jsonLayout` holds the text around the members, so the JSON
  merge keeps the formatting, the number text and the key order. A manifest without
  `jsonLayout` merges by object, as before. Changed goldens: the TypeScript chunks, manifest,
  merged file and output; the JSON chunks `004-list.json` and `005-nested.json`, manifest,
  merged file and output.
- `chunk merge` (K7): merge does not write a result that is smaller than the file it replaces,
  or an empty result over a non-empty file, unless `--allow-shrink` is given. Without the flag,
  merge exits 1, writes nothing and makes no backup. A merge that loses text is more often a
  defect than an edit, and before this fix the loss was silent.
- `chunk merge` writes a CRLF source file back with CRLF line endings. `split` writes chunk
  files with LF line endings and records `"lineEnding": "crlf"` in the manifest when every line
  break of the source is CRLF; `merge` then writes CRLF again. Before this fix, a merge changed
  every line of a CRLF file. The field is optional and the manifest stays version 2.0.0: an LF
  file writes no field, and an older 2.0.0 reader ignores it. For a file with mixed line
  endings, `split` prints a warning, and the chunks and the merge use LF.
- `chunk`: an unknown flag (for example `--ouput`), a flag of another action, a flag without
  its value and a second file exit 1 with a message, and write nothing. The original ignored
  them: `-o` without a value wrote to the default folder, and a mistyped flag ran with the
  default settings. Flags can now come before the file.
- `chunk merge` keeps a `__proto__` key of a JSON object. The merge used `Object.assign`, so a
  `__proto__` key set the prototype of the result and the key was lost from the file.
- `chunk` (fix K1): the manifest stores `sourceFile` relative to the chunk folder, with `/`
  separators. You can move the source file and the chunk folder together, and `merge` still
  finds the source. The manifest holds no absolute path. `merge` and `status` print the
  resolved source path.
- `chunk` (fix K2): the manifest has no `createdAt` field. Two splits of one file give
  byte-identical manifests. `merge` and `status` print the `Created:` line only for an old
  manifest that has the field.
- `chunk` (fix K3): chunk hashes and the source hash are SHA-256 (64 hex digits). The old
  32-bit hash gave the same value for different texts, for example `Aa` and `BB`, so `status`
  and `merge` reported a changed chunk as unchanged.
- `chunk`: `split` writes manifest version `2.0.0`, because K1, K2 and K3 change the format
  that a 1.1.0 reader expects. The manifest file ends with one LF. `merge` and `status` still
  read a 1.1.0 manifest, with an absolute or a relative `sourceFile`, and compare its chunks
  with the old 32-bit hash. A manifest of another major version exits 1 with a message.
- `chunk`: invalid flag values exit 1 with a message and write no files. This applies to a
  `--type` other than `auto`, `markdown`, `json` or `typescript`, a `--level` that is not a
  number of 1 or more, and a `--max-lines` that is not a number of 0 or more. The original
  wrote chunk files named `...undefined` for an unknown type, ignored a NaN level or max-lines,
  and crashed on level 0. A directory given as the file or the manifest exits 1 with a message;
  the original crashed with `EISDIR`.
- `chunk split`: the merge hint names `repo-tools chunk merge`, not the old `chunker merge`.

### Added

- depgraph per-export facts report (D10a, design section 6.2). `--api-surface=<file>` (config
  `depgraph.apiSurface.out`) writes the `buildApiSurfaceReport` output: `schemaVersion` 1, the
  entry, the stability tags, the counts, each surface symbol with its signature, `async`,
  stability tag and export path, and the exports of every file of the graph walk.
  `--api-entry=<path>` (`depgraph.apiSurface.entry`, default `src/index.ts`) sets the entry, and
  `--stability-tags=<a,b>` (`depgraph.apiSurface.stabilityTags`) sets the tags. The report file
  and the entry resolve against the root. The report has no timestamp, so two runs give the same
  bytes. When the report is on and the entry file does not exist, the run exits 1 before any
  write. Without the flag, no other output changes. New golden:
  `tests/golden/depgraph/mini-repo/api-surface.json`; `scripts/update-depgraph-goldens.ts`
  writes it too.
- depgraph config and flags in the pipeline (D10a). `--src=<a,b>` / `depgraph.src` names the
  source folders of a single package (`auto`: `src/` if present, else each top-level folder with
  TypeScript); the census and the test search follow them. `--tests=<a,b>` / `depgraph.tests`
  names the test folders under the root and each package folder. `--out=<dir>` /
  `depgraph.out` sets the output folder; standard output names it relative to the root, and
  `--check-census` reads the inventory there. `--exclude=<a,b>` / `depgraph.exclude` replaces
  the folder names that every walk skips, and `--also-exclude=<a,b>` / `depgraph.alsoExclude`
  adds to them. `depgraph.strictOrphans` is the config form of `--strict-orphans`.
  `depgraph.regenerateCommand` and `depgraph.verificationMarker` set the banner of every
  Markdown report (`null` omits the marker line). `depgraph.duplicateAllowlist` and
  `depgraph.coveragePolicy` name the allowlist and the coverage policy files. A list flag with an
  empty item and a path flag with an absolute path exit 1. No golden changes.
- depgraph config file (D10a, `src/config.ts`). `repo-tools.config.json` at the root, or the
  file that `--config=<path>` names, holds a `depgraph` object with the keys of design section
  5.1: `src`, `tests`, `out`, `exclude`, `alsoExclude`, `strictOrphans`, `duplicateAllowlist`,
  `duplicateBaseline`, `coveragePolicy`, `regenerateCommand`, `verificationMarker`,
  `apiSurface.out`, `apiSurface.entry`, `apiSurface.stabilityTags` and `extensions`. Each key
  has a default and a type. Precedence: a command-line flag, then the config file, then the
  default. Every path in the config and in `--config` is relative to the root, not to the
  current folder. An unknown key, a value of the wrong type, an absolute path, a missing
  `--config` file, an unreadable file and invalid JSON exit 1 before any write; the error text
  shows the root as `<root>`. The default of `tests` is `["test", "tests"]`, the two folder
  names that the pipeline reads today. This commit loads and checks the config; the next
  commits connect the keys to the pipeline.
- README: a "Build an executable" section (prerequisites, the lockfile install, `bun run compile`,
  cross-platform targets, file names and sizes, how to run and smoke-test the executable) and a
  "Reports" section that names every file `depgraph` writes and what each answers.
- depgraph port review: the `node dist/x.js` script-root pattern keeps the pre-port byte that
  stops it from matching, so the port seeds no such root (the pre-port behaviour; fix F33
  changes it later). The `--check-census` "not found" message ends with a newline. The
  characterization test also compares the port's standard output with a golden
  (`_stdout.port.txt`) and checks both separator forms of the root.
- `repo-tools depgraph` (task D8, port complete). The reporters (`reporters/markdown.ts`,
  `json.ts`, `yaml.ts`, `unused.ts`, `inventory.ts`, `coverage.ts`, `surfaces.ts`,
  `banner.ts`), an extension stub (`extensions.ts`) and the pipeline (`index.ts`: scan, parse,
  analyze, report, gate) are in. Flags: `--root=<dir>` or a first path argument, `--all`/`-a`,
  `--include-tests`/`-t` (no operation), `--check-census` and `--help`. The command writes
  the reports into `<root>/docs/architecture`, and it names paths relative to the root on
  standard output. Exit 1: no TypeScript file, a failed census self-check (monorepo mode) or a
  failed `--check-census`. The port reproduces the four characterization golden sets byte for
  byte (dates and the root masked), and a Windows-only test checks each report and the exit
  code. The WASM, WebGPU and parallel pairing reports and the WASM build gate of the pre-port
  generator are not in the core; they come back as an extension. `Io` moves to
  `src/io-types.ts`, and `src/cli.ts` re-exports it.
- depgraph port, part 6 (task D7, classifier and report only): `duplicates.ts` (own
  definitions, the allowlist, the definer and entry classes, the canonical hint and the tag
  tally) and `reporters/duplicates.ts` (duplicate-symbols.md and duplicate-symbols.json). The
  flags `--check-duplicates`, `--no-regen` and `--write-duplicate-baseline` come later.
- depgraph port, part 5 (task D6): `inventory.ts` (the census: area, disposition and counts per
  file, the census self-check and the no-regenerate check of `--check-census`) and
  `coverage.ts` (direct-import test coverage with barrel tracing, and the optional coverage
  policy). The self-check returns its failure text and does not throw, so the pipeline can
  return exit code 1.
- depgraph port, part 4 (task D5): `analysis.ts` (modules, the dependency matrix, reachability,
  the depth-first cycle search, the public surface, unused files and exports, the statistics
  and the dormant split). The cycle search and the in-file reference count keep the pre-port
  behavior until fixes F26 and F24.
- depgraph port, part 3 (tasks D3 and D4, second half): `resolver.ts` (relative specifier to a
  `.ts` path, package specifier to a workspace package and its entry file) and `parser.ts`
  (imports, side-effect imports, `import()` expressions, re-exports, export declarations, the
  file description and the fallback description). The parser keeps the pre-port behavior: a
  relative `import()` is a type-only edge (fix F25), and comments are removed with the regex
  functions of `src/mask.ts` (fix F6).
- depgraph port, part 2 (tasks D2 and D4, first half): `scanner.ts` (the graph walk, the test
  walk, the source-root rule, the census walk and the maximal repo walk), `workspaces.ts` (npm,
  Yarn and pnpm workspaces, and the structural fallback) and `roots.ts` (`exports` subpaths,
  `bin` targets, script entries, `tsc -p` tsconfig entries, tsup config entries, root config
  references and `new URL()` launches). `roots.ts` moves in this commit because workspace
  detection reads the build roots of each package. The walks keep the listing order of the file
  system until fix F2. Runtime dependency: `js-yaml` 4.3.2, pinned to the version of the
  characterization goldens.
- depgraph port, part 1 (task D1): `src/depgraph/types.ts` holds the shared types of the
  pipeline. `src/depgraph/paths.ts` gives POSIX paths relative to the root. `src/mask.ts` is the
  one comment and string masking module: `blankCommentsAndStrings` and `stripComments` read the
  source as tokens, and the `*Regex` functions keep the comment removal of the pre-port
  generator byte for byte until the fixes replace it.
- `compress` round-trip tests (design 13.3 step 5): for JSON, `compress` then `compress -d`
  gives a deep-equal value at each level. For the other 10 formats, the chain from the fixture
  gives the golden restored file. The smoke test `scripts/smoke.ts` has a fourth step: a JSON
  round trip through the command under test, in a temp folder.
- Subcommand `compress` (design 3.4 and 4): a port of the CTON context compressor. It writes a
  compact copy of a file for a model context, or restores a compact file with `-d`. Single-file
  mode and batch mode (`-b`, `-p`, `-r`) are available. The code is in `src/compress/`:
  `formats.ts` holds one compressor for each of the 11 formats, `legend.ts` builds and parses the
  legends, and `index.ts` holds the arguments, the help and the batch walk. The CTON format and
  the legend syntax do not change. Characterization goldens in `tests/golden/compress/` come from
  the original tool, run on the fixtures in `tests/fixtures/compress/`, and the port gives the
  same bytes and the same console output. An error now returns exit code 1 with a message; the
  original tool stopped with a stack trace. `Io` moves to `src/io-types.ts`, so a subcommand
  module does not import `cli.ts`; `cli.ts` exports it again.
- Subcommand `repo-tools chunk` (design 3.3, section 4): `split <file>`, `merge <manifest.json>`
  and `status <manifest.json>`, with `-o`, `-l`, `-m`, `-t` and `--dry-run`. The code is a port
  of the original chunker in `src/chunk/` (`index.ts`, `splitters.ts`, `manifest.ts`). Goldens
  in `tests/golden/chunk/` hold the output of the original tool on three fixtures, and the port
  gives the same bytes. The TypeScript splitter keeps the lexer fixes for template literals,
  strings in template expressions, regex literals, comments and escaped quotes (fix K4). `Io`
  moves to `src/io-types.ts`, so a subcommand does not import `cli.ts`.
- depgraph API-surface module (task D9): `src/depgraph/api-surface.ts`, ported from the
  universal-physics-tensor dependency-graph tool with its behaviour unchanged. It reads source
  text without a compiler API and exports `maskNonCode`, `extractExportDetails`,
  `extractReExports`, `resolveSurface`, `createTsResolver`, `buildApiSurfaceReport` and
  `DEFAULT_STABILITY_TAGS`. The only code changes are `as string` type assertions that satisfy
  `noUncheckedIndexedAccess`; they emit no JavaScript. No CLI flag uses the module yet.
  `tests/unit/api-surface.test.ts` holds the 20 original tests, moved to `bun:test`.
- depgraph test base (task D0): two fixture repositories (`mini-repo`, a single package with
  case-order names, an exports subpath, a bin, a barrel, a dynamic import, a runtime cycle, a
  type-only cycle, an orphan, a `.d.ts` and a `.tsx` file; `mono-repo`, npm workspaces with an
  exports subpath, a `dist/src` bin, two tsup entry arrays and a cross-package import) and the
  characterization goldens of the pre-port generator for both, with and without `--all`.
  `bunfig.toml` limits `bun test` to `tests/unit`, because the fixtures hold their own test
  files as data.
- Shared helpers: `src/sort.ts` sorts in UTF-16 code-unit order (fix F22: no `localeCompare`,
  so the order does not depend on the ICU data of the runtime), and `src/io.ts` writes files
  with LF line endings and formats JSON with one trailing LF.
- CLI shell `repo-tools` with the subcommands `depgraph`, `chunk` and `compress`. `--help`, `-h`
  and no argument print the subcommand list. `--version` prints the package version. An unknown
  subcommand exits 1. A subcommand that is not built yet exits 1 with a message.
- Build: `bun run build` writes the Node-compatible ESM bundle `dist/cli.js` with a node
  shebang. `bun run compile` writes one compiled executable for the host (or `--target`) into
  `bin/`. Targets: `bun-windows-x64`, `bun-linux-x64`, `bun-darwin-arm64`. An unknown flag or
  target exits 1.
- Smoke test `scripts/smoke.ts`: runs `--version`, `--help` and an unknown subcommand against one
  way to run the tool (the executable, `node dist/cli.js` or `bun dist/cli.js`).
- Smoke test step 4 (design 13.3): `chunk split` on a copy of a Markdown fixture in a temporary
  folder, then the copy is deleted, then `chunk merge`. The merged file must equal the fixture
  byte for byte.
- Extension-load probe `scripts/ext-probe.ts`: CI compiles it with the product's flags and proves
  that a compiled executable imports an external `.mjs` extension and runs its `preflight` and
  `report` hooks, on all three operating systems, before any extension code exists.
- CI job `executable` on Linux, Windows and macOS (arm64): compile, smoke the executable and the
  bundle under Node 20 and Bun, run the extension probe, and `npm pack --dry-run`. CI job
  `package`: uploads the npm tarball and its SHA-256 as a workflow artifact. Workflow
  `build.yml` (tag `v*` or manual): checks that a tag equals the `package.json` version, builds
  the three executables, uploads each one unzipped, and writes and verifies one `SHA256SUMS`.
  A downloaded Linux or macOS executable has no execute bit; run `chmod +x` on it. No workflow
  creates a release or holds a token.
- Privacy check `scripts/privacy-check.ts`. It scans the content in the git index (every
  tracked blob, symlink targets included) and every commit object reachable from HEAD, and it
  fails when the commit count differs from `git rev-list --count`. It fails on:
  - an absolute user path, in the Windows, drive-less, POSIX, Git Bash and WSL forms;
  - an email address, except a whole-address `noreply` or GitHub SSH address;
  - a session URL, in a file or in a commit message;
  - a tracked `.exe` or a file over 5 MB;
  - a word token whose SHA-256 is in `scripts/privacy-denylist.sha256`. The check removes
    accents and invisible characters, and it also checks each part of a joined word (`-`, `_`
    and camelCase), so a name joined to another word is still found.
  UTF-16 files are decoded. Files with NUL bytes are scanned in their printable runs. A report
  names the file, the line and the rule, never the matched value; a path that itself holds a
  finding is named by a number and a hash. The script runs a self-test first, and it fails when
  the denylist holds fewer than 20 hashes. Attribution exemptions apply only to `person` tokens:
  a license file at the root, a line that starts with a copyright notice, the lines of an
  `author`, `owner`, `authors`, `contributors` or `maintainers` JSON value, and the public org in
  a GitHub URL or the npm scope. Commit messages get no exemption.
- `scripts/privacy-hash.ts` writes denylist lines from a word list that stays outside the
  repository. It rejects an entry that the checker can never match.
- `.githooks/commit-msg` (executable) rejects a commit message that fails the privacy check. It
  scans `#` lines too, and it stops at the scissors line of `git commit -v`. Install it with
  `bun run hooks`.
- CI workflow `ci.yml`: the privacy check, and typecheck, lint and tests on Linux, Windows and
  macOS (arm64). Every action is pinned to a full commit SHA. The workflow has read-only
  permissions and holds no token. Dependabot updates the actions and the dev dependencies.
- Project scaffold: Bun and TypeScript (strict), `bun:test`, Biome lint and format, MIT license,
  LF line endings through `.gitattributes`.
