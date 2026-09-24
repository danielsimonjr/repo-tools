# Changelog

All notable changes to this project are recorded in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- CLI shell `repo-tools` with the subcommands `depgraph`, `chunk` and `compress`. `--help`, `-h`
  and no argument print the subcommand list. `--version` prints the package version. An unknown
  subcommand exits 1. A subcommand that is not built yet exits 1 with a message.
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
