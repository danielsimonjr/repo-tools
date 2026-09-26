<!-- repo-map:no-verification -->
<!-- GENERATED FILE -- do not edit by hand.
     Regenerate with `repo-tools map`. -->

# Complete File Inventory

This report lists each source file that the map census finds, with a disposition. The census reads the files that git tracks. Outside a git work tree, it walks the folder. The census skips tool state, dependency folders and build output (for example `.git/`, `node_modules/`, `dist/` and `target/`), and `obj/` and `bin/` for C#.

**Language**: typescript

**Total files**: 9

## Disposition counts

| Disposition | Count | Meaning |
| --- | --: | --- |
| `reachable` | 3 | A `src`-area file that an entry root reaches. |
| `build-entry` | 4 | A `src`-area file that is an entry root. |
| `test-only` | 0 | A `src`-area file that only a test reaches. |
| `orphan` | 0 | A `src`-area file that nothing reaches. Delete it, or wire it to a root. |
| `test` | 1 | A file in a `tests/` folder, or a `*.test.ts` or `*.spec.ts` file. |
| `tool` | 0 | A file in a `tools/` or `scripts/` folder outside `src/`. |
| `config` | 1 | A `*.config.*` file of TypeScript or JavaScript. |
| `example` | 0 | A file in `examples/` or `docs/`. |
| `bench` | 0 | A file in `bench/` or `benchmarks/`, or a `*.bench.*` file. |
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

| File | Package | Area | Disposition | Lines |
| --- | --- | --- | --- | --: |
| `packages/cli/src/format.ts` | @scope/cli | src | reachable | 4 |
| `packages/cli/src/main.ts` | @scope/cli | src | build-entry | 5 |
| `packages/core/src/index.ts` | @scope/core | src | build-entry | 3 |
| `packages/core/src/internal.ts` | @scope/core | src | build-entry | 2 |
| `packages/core/src/math.ts` | @scope/core | src | reachable | 11 |
| `packages/core/src/types.ts` | @scope/core | src | reachable | 2 |
| `packages/core/src/worker.ts` | @scope/core | src | build-entry | 4 |
| `packages/core/tests/math.test.ts` | @scope/core | tests | test | 3 |
| `packages/core/tsup.config.ts` | @scope/core | config | config | 6 |

## Skipped links

Links (symbolic links and junctions) that the census did not follow. A link can point to another repository, so no file behind a link is in this inventory or in the graph.

_None._

## Warnings

_None._
