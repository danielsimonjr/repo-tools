# Changelog

All notable changes to this project are recorded in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

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
- `compress` JSON refuses an integer outside the safe integer range (-9007199254740991 to
  9007199254740991). Compression and `-d` exit 1 with a message that names the integer, and
  write no file. The check reads the source text. Before, `JSON.parse` changed the value
  without a message: `12345678901234567890` became `12345678901234567000`. A known limit, now
  in the help text: an integer-like object key (`"2"`, `"10"`) moves to the start of its
  object, in numeric order, because `JSON.parse` orders the keys so. The values do not change.
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
