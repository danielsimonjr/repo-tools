<!-- repo-map:no-verification -->
<!-- GENERATED FILE -- do not edit by hand.
     Regenerate with `repo-tools depgraph`. -->

# Complete File Inventory

Every tracked `.ts` file in the repo — package `src/` and `tests/`, the repo-root cross-package `tests/`, `tools/`, build/test `*.config.ts`, `examples/`, and `docs/` reference sources — tagged with a disposition. A completeness census: no `.ts` may be silently missing. The self-check gate (`verifyFileCensus`) does a MAXIMAL, location-agnostic repo walk (broader than this census’s enumerated discovery) and HARD-FAILS `npm run docs:deps` if any `.ts` on disk is unaccounted, or if any `orphan` exists.

**Excluded by design (not source):** `node_modules/`, `dist/`, `*.d.ts` ambient declarations, and dot-directories (`.git/`, `.remember/`, `.changeset/`, …). The walk set equals the git-tracked `.ts` files, so there is no silent allowlist — every tracked `.ts` appears below with an explicit disposition.

**Total files**: 9

## Disposition counts

| Disposition | Count | Meaning |
| --- | --: | --- |
| `reachable` | 3 | A `src/` file in the module graph, reachable from a root. |
| `build-entry` | 4 | A detected build/subpath/`bin`/worker/`tsup.config` root (index, internal, cli, render-file, run-worker, …). |
| `test-only` | 0 | A `src/` file not reachable from src roots but imported by a test. |
| `orphan` | 0 | A `src/` file reachable from nothing — a delete/wire candidate (hard-fails the gate). |
| `test` | 1 | A test source file (under a `tests/` dir, or a `*.test.ts`/`*.spec.ts`). |
| `tool` | 0 | A file under `tools/` — agent-only meta-tooling (CDG/QDG/benchmarks). |
| `config` | 1 | A build/test config source (`*.config.ts`: vitest/tsup, per-package or root). |
| `example` | 0 | An `examples/` or `docs/` reference/illustration source. |
| **Total** | **9** | |

## Per-area counts

| Area | Files |
| --- | --: |
| `config` | 1 |
| `src` | 7 |
| `tests` | 1 |

## Per-package counts

| Package | Files |
| --- | --: |
| `@scope/cli` | 2 |
| `@scope/core` | 7 |

## All files

| file | package | area | disposition |
| --- | --- | --- | --- |
| `packages/cli/src/format.ts` | @scope/cli | src | reachable |
| `packages/cli/src/main.ts` | @scope/cli | src | build-entry |
| `packages/core/src/index.ts` | @scope/core | src | build-entry |
| `packages/core/src/internal.ts` | @scope/core | src | build-entry |
| `packages/core/src/math.ts` | @scope/core | src | reachable |
| `packages/core/src/types.ts` | @scope/core | src | reachable |
| `packages/core/src/worker.ts` | @scope/core | src | build-entry |
| `packages/core/tests/math.test.ts` | @scope/core | tests | test |
| `packages/core/tsup.config.ts` | @scope/core | config | config |
