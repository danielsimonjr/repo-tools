# Changelog

All notable changes to this project are recorded in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

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

### Added

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

### Fixed

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
