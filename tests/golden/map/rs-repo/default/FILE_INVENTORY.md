<!-- repo-map:no-verification -->
<!-- GENERATED FILE -- do not edit by hand.
     Regenerate with `repo-tools map`. -->

# Complete File Inventory

This report lists each source file that the map census finds, with a disposition. The census reads the files that git tracks. Outside a git work tree, it walks the folder. The census skips tool state, dependency folders and build output (for example `.git/`, `node_modules/`, `dist/` and `target/`), and `obj/` and `bin/` for C#.

**Language**: rust

**Total files**: 5

## Disposition counts

| Disposition | Count | Meaning |
| --- | --: | --- |
| `reachable` | 3 | A `src`-area file that an entry root reaches. |
| `build-entry` | 2 | A `src`-area file that is an entry root. |
| `test-only` | 0 | A `src`-area file that only a test reaches. |
| `orphan` | 0 | A `src`-area file that nothing reaches. Delete it, or wire it to a root. |
| `test` | 0 | A file in a `test/` or `tests/` folder, or a `*.test.ts` or `*.spec.ts` file. |
| `tool` | 0 | A file in a `tools/` or `scripts/` folder outside `src/`. |
| `config` | 0 | A `*.config.*` file of TypeScript or JavaScript. |
| `example` | 0 | A file in `examples/` or `docs/`. |
| `bench` | 0 | A file in `bench/` or `benchmarks/`, or a `*.bench.*` file. |
| **Total** | **5** | |

## Per-area counts

| Area | Files |
| --- | --: |
| `src` | 5 |

## Per-package counts

| Package | Files |
| --- | --: |
| `(root)` | 5 |

## All files

| File | Package | Area | Disposition | Lines |
| --- | --- | --- | --- | --: |
| `src/lib.rs` | (root) | src | build-entry | 9 |
| `src/main.rs` | (root) | src | build-entry | 3 |
| `src/net/mod.rs` | (root) | src | reachable | 6 |
| `src/net/wire.rs` | (root) | src | reachable | 3 |
| `src/util.rs` | (root) | src | reachable | 4 |

## Skipped links

Links (symbolic links and junctions) that the census did not follow. A link can point to another repository, so no file behind a link is in this inventory or in the graph.

_None._

## Warnings

- emit_file_inventory: no readable package.json at the root -- package derivation skipped, every file reports '(root)'
