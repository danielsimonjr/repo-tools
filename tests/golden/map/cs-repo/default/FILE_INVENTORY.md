<!-- repo-map:no-verification -->
<!-- GENERATED FILE -- do not edit by hand.
     Regenerate with `repo-tools map`. -->

# Complete File Inventory

This report lists each source file that the map census finds, with a disposition. The census reads the files that git tracks. Outside a git work tree, it walks the folder. The census skips tool state, dependency folders and build output (for example `.git/`, `node_modules/`, `dist/` and `target/`), and `obj/` and `bin/` for C#.

**Language**: csharp

**Total files**: 4

## Disposition counts

| Disposition | Count | Meaning |
| --- | --: | --- |
| `reachable` | 3 | A `src`-area file that an entry root reaches. |
| `build-entry` | 1 | A `src`-area file that is an entry root. |
| `test-only` | 0 | A `src`-area file that only a test reaches. |
| `orphan` | 0 | A `src`-area file that nothing reaches. Delete it, or wire it to a root. |
| `test` | 0 | A file in a `test/` or `tests/` folder, or a `*.test.ts` or `*.spec.ts` file. |
| `tool` | 0 | A file in a `tools/` or `scripts/` folder outside `src/`. |
| `config` | 0 | A `*.config.*` file of TypeScript or JavaScript. |
| `example` | 0 | A file in `examples/` or `docs/`. |
| `bench` | 0 | A file in `bench/` or `benchmarks/`, or a `*.bench.*` file. |
| **Total** | **4** | |

## Per-area counts

| Area | Files |
| --- | --: |
| `src` | 4 |

## Per-package counts

| Package | Files |
| --- | --: |
| `App` | 4 |

## All files

| File | Package | Area | Disposition | Lines |
| --- | --- | --- | --- | --: |
| `src/App/Program.cs` | App | src | build-entry | 9 |
| `src/Lib/Format.cs` | App | src | reachable | 6 |
| `src/Lib/Greeter.cs` | App | src | reachable | 7 |
| `src/Lib/Unused.cs` | App | src | reachable | 3 |

## Skipped links

Links (symbolic links and junctions) that the census did not follow. A link can point to another repository, so no file behind a link is in this inventory or in the graph.

_None._

## Warnings

_None._
