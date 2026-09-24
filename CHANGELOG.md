# Changelog

All notable changes to this project are recorded in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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
