<!-- repo-map:no-verification -->
<!-- GENERATED FILE -- do not edit by hand.
     Regenerate with `repo-tools map`. -->

# Complete File Inventory

This report lists each source file that the map census finds, with a disposition. The census reads the files that git tracks. Outside a git work tree, it walks the folder. The census skips tool state, dependency folders and build output (for example `.git/`, `node_modules/`, `dist/` and `target/`), and `obj/` and `bin/` for C#.

**Language**: typescript

**Total files**: 18

## Disposition counts

| Disposition | Count | Meaning |
| --- | --: | --- |
| `reachable` | 10 | A `src`-area file that an entry root reaches. |
| `build-entry` | 3 | A `src`-area file that is an entry root. |
| `test-only` | 0 | A `src`-area file that only a test reaches. |
| `orphan` | 3 | A `src`-area file that nothing reaches. Delete it, or wire it to a root. |
| `test` | 2 | A file in a `tests/` folder, or a `*.test.ts` or `*.spec.ts` file. |
| `tool` | 0 | A file in a `tools/` or `scripts/` folder outside `src/`. |
| `config` | 0 | A `*.config.*` file of TypeScript or JavaScript. |
| `example` | 0 | A file in `examples/` or `docs/`. |
| `bench` | 0 | A file in `bench/` or `benchmarks/`, or a `*.bench.*` file. |
| **Total** | **18** | |

## Per-area counts

| Area | Files |
| --- | --: |
| `src` | 16 |
| `tests` | 2 |

## Per-package counts

| Package | Files |
| --- | --: |
| `(root)` | 2 |
| `mini-repo` | 16 |

## All files

| File | Package | Area | Disposition | Lines |
| --- | --- | --- | --- | --: |
| `src/B.ts` | mini-repo | src | reachable | 13 |
| `src/Z/index.ts` | mini-repo | src | reachable | 1 |
| `src/Z/loop.ts` | mini-repo | src | reachable | 6 |
| `src/Z/zed.ts` | mini-repo | src | reachable | 10 |
| `src/_x.ts` | mini-repo | src | reachable | 4 |
| `src/a.ts` | mini-repo | src | reachable | 17 |
| `src/ambient.d.ts` | mini-repo | src | orphan | 1 |
| `src/cli.ts` | mini-repo | src | build-entry | 6 |
| `src/dyn.ts` | mini-repo | src | orphan | 2 |
| `src/index.ts` | mini-repo | src | build-entry | 7 |
| `src/orphan.ts` | mini-repo | src | orphan | 2 |
| `src/ping.ts` | mini-repo | src | reachable | 6 |
| `src/pong.ts` | mini-repo | src | reachable | 5 |
| `src/register.ts` | mini-repo | src | reachable | 2 |
| `src/util/index.ts` | mini-repo | src | build-entry | 4 |
| `src/view.tsx` | mini-repo | src | reachable | 4 |
| `tests/a.test.ts` | (root) | tests | test | 3 |
| `tests/barrel.test.ts` | (root) | tests | test | 3 |

## Skipped links

Links (symbolic links and junctions) that the census did not follow. A link can point to another repository, so no file behind a link is in this inventory or in the graph.

_None._

## Warnings

_None._
