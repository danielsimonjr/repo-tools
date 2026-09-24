<!-- repo-map:no-verification -->
<!-- GENERATED FILE -- do not edit by hand.
     Regenerate with `repo-tools depgraph`. -->

# Complete File Inventory

Every tracked `.ts` file in the repo — package `src/` and `tests/`, the repo-root cross-package `tests/`, `tools/`, build/test `*.config.ts`, `examples/`, and `docs/` reference sources — tagged with a disposition. A completeness census: no `.ts` may be silently missing. The self-check gate (`verifyFileCensus`) does a MAXIMAL, location-agnostic repo walk (broader than this census’s enumerated discovery) and HARD-FAILS the run if any `.ts` on disk is unaccounted, or (with `--strict-orphans`) if any `orphan` exists.

**Excluded by design (not source):** `node_modules/`, `dist/`, `*.d.ts` ambient declarations, and dot-directories (`.git/`, `.remember/`, `.changeset/`, …). The walk set equals the git-tracked `.ts` files, so there is no silent allowlist — every tracked `.ts` appears below with an explicit disposition.

**Total files**: 16

## Disposition counts

| Disposition | Count | Meaning |
| --- | --: | --- |
| `reachable` | 10 | A `src/` file in the module graph, reachable from a root. |
| `build-entry` | 3 | A detected build/subpath/`bin`/worker/`tsup.config` root (index, internal, cli, render-file, run-worker, …). |
| `test-only` | 0 | A `src/` file not reachable from src roots but imported by a test. |
| `orphan` | 1 | A `src/` file reachable from nothing — a delete/wire candidate (fails the gate with `--strict-orphans`). |
| `test` | 2 | A test source file (under a `tests/` dir, or a `*.test.ts`/`*.spec.ts`). |
| `tool` | 0 | A file under `tools/` — agent-only meta-tooling (CDG/QDG/benchmarks). |
| `config` | 0 | A build/test config source (`*.config.ts`: vitest/tsup, per-package or root). |
| `example` | 0 | An `examples/` or `docs/` reference/illustration source. |
| **Total** | **16** | |

## Per-area counts

| Area | Files |
| --- | --: |
| `src` | 14 |
| `tests` | 2 |

## Per-package counts

| Package | Files |
| --- | --: |
| `(root)` | 16 |

## All files

| file | package | area | disposition |
| --- | --- | --- | --- |
| `src/B.ts` | (root) | src | reachable |
| `src/Z/index.ts` | (root) | src | reachable |
| `src/Z/loop.ts` | (root) | src | reachable |
| `src/Z/zed.ts` | (root) | src | reachable |
| `src/_x.ts` | (root) | src | reachable |
| `src/a.ts` | (root) | src | reachable |
| `src/cli.ts` | (root) | src | build-entry |
| `src/dyn.ts` | (root) | src | reachable |
| `src/index.ts` | (root) | src | build-entry |
| `src/orphan.ts` | (root) | src | orphan |
| `src/ping.ts` | (root) | src | reachable |
| `src/pong.ts` | (root) | src | reachable |
| `src/register.ts` | (root) | src | reachable |
| `src/util/index.ts` | (root) | src | build-entry |
| `tests/a.test.ts` | (root) | tests | test |
| `tests/barrel.test.ts` | (root) | tests | test |

## Skipped links

Links (symbolic links and junctions) that the walks did not follow. A link can point to another repository, so no file behind a link is in this inventory or in the graph.

_None._
