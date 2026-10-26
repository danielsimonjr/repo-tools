<!-- repo-map:no-verification -->
<!-- GENERATED FILE -- do not edit by hand.
     Regenerate with `repo-tools map`. -->

# Complete File Inventory

This report lists each source file that the map census finds, with a disposition. The census reads the files that git tracks. Outside a git work tree, it walks the folder. The census skips tool state, dependency folders and build output (for example `.git/`, `node_modules/`, `dist/` and `target/`), and `obj/` and `bin/` for C#.

**Language**: typescript

**Total files**: 288

## Disposition counts

| Disposition | Count | Meaning |
| --- | --: | --- |
| `reachable` | 82 | A `src`-area file that an entry root reaches. |
| `build-entry` | 1 | A `src`-area file that is an entry root. |
| `test-only` | 0 | A `src`-area file that only a test reaches. |
| `orphan` | 2 | A `src`-area file that nothing reaches. Delete it, or wire it to a root. |
| `test` | 192 | A file in a `test/` or `tests/` folder, or a `*.test.ts` or `*.spec.ts` file. |
| `tool` | 10 | A file in a `tools/` or `scripts/` folder outside `src/`. |
| `config` | 1 | A `*.config.*` file of TypeScript or JavaScript. |
| `example` | 0 | A file in `examples/` or `docs/`. |
| `bench` | 0 | A file in `bench/` or `benchmarks/`, or a `*.bench.*` file. |
| **Total** | **288** | |

## Per-area counts

| Area | Files |
| --- | --: |
| `config` | 1 |
| `src` | 85 |
| `tests` | 192 |
| `tools` | 10 |

## Per-package counts

| Package | Files |
| --- | --: |
| `(root)` | 203 |
| `@danielsimonjr/repo-tools` | 85 |

## All files

| File | Package | Area | Disposition | Lines |
| --- | --- | --- | --- | --: |
| `scripts/build.ts` | (root) | tools | tool | 118 |
| `scripts/design-refs.ts` | (root) | tools | tool | 125 |
| `scripts/fix-ledger-audit.ts` | (root) | tools | tool | 657 |
| `scripts/fix-ledger-mutations.ts` | (root) | tools | tool | 660 |
| `scripts/lockcheck.ts` | (root) | tools | tool | 128 |
| `scripts/privacy-check.ts` | (root) | tools | tool | 562 |
| `scripts/privacy-hash.ts` | (root) | tools | tool | 53 |
| `scripts/smoke.ts` | (root) | tools | tool | 390 |
| `scripts/update-depgraph-goldens.ts` | (root) | tools | tool | 19 |
| `scripts/update-map-goldens.ts` | (root) | tools | tool | 79 |
| `src/assets.d.ts` | @danielsimonjr/repo-tools | src | orphan | 5 |
| `src/bin.ts` | @danielsimonjr/repo-tools | src | orphan | 8 |
| `src/check/claims.ts` | @danielsimonjr/repo-tools | src | reachable | 79 |
| `src/check/index.ts` | @danielsimonjr/repo-tools | src | reachable | 191 |
| `src/check/metrics.ts` | @danielsimonjr/repo-tools | src | reachable | 89 |
| `src/check/verify.ts` | @danielsimonjr/repo-tools | src | reachable | 177 |
| `src/chunk/index.ts` | @danielsimonjr/repo-tools | src | reachable | 706 |
| `src/chunk/manifest.ts` | @danielsimonjr/repo-tools | src | reachable | 203 |
| `src/chunk/splitters.ts` | @danielsimonjr/repo-tools | src | reachable | 780 |
| `src/cli.ts` | @danielsimonjr/repo-tools | src | build-entry | 137 |
| `src/clones/detect.ts` | @danielsimonjr/repo-tools | src | reachable | 137 |
| `src/clones/index.ts` | @danielsimonjr/repo-tools | src | reachable | 254 |
| `src/clones/normalise.ts` | @danielsimonjr/repo-tools | src | reachable | 113 |
| `src/clones/report.ts` | @danielsimonjr/repo-tools | src | reachable | 132 |
| `src/clones/settings.ts` | @danielsimonjr/repo-tools | src | reachable | 68 |
| `src/clones/units.ts` | @danielsimonjr/repo-tools | src | reachable | 226 |
| `src/compress/formats.ts` | @danielsimonjr/repo-tools | src | reachable | 455 |
| `src/compress/index.ts` | @danielsimonjr/repo-tools | src | reachable | 506 |
| `src/compress/legend.ts` | @danielsimonjr/repo-tools | src | reachable | 351 |
| `src/config.ts` | @danielsimonjr/repo-tools | src | reachable | 481 |
| `src/depgraph/analysis.ts` | @danielsimonjr/repo-tools | src | reachable | 385 |
| `src/depgraph/api-surface.ts` | @danielsimonjr/repo-tools | src | reachable | 800 |
| `src/depgraph/args.ts` | @danielsimonjr/repo-tools | src | reachable | 243 |
| `src/depgraph/coverage.ts` | @danielsimonjr/repo-tools | src | reachable | 280 |
| `src/depgraph/cycles.ts` | @danielsimonjr/repo-tools | src | reachable | 114 |
| `src/depgraph/description.ts` | @danielsimonjr/repo-tools | src | reachable | 76 |
| `src/depgraph/dirlist.ts` | @danielsimonjr/repo-tools | src | reachable | 54 |
| `src/depgraph/duplicates.ts` | @danielsimonjr/repo-tools | src | reachable | 555 |
| `src/depgraph/exclude.ts` | @danielsimonjr/repo-tools | src | reachable | 48 |
| `src/depgraph/extensions.ts` | @danielsimonjr/repo-tools | src | reachable | 197 |
| `src/depgraph/paths.ts` | @danielsimonjr/repo-tools | src | reachable | 50 |
| `src/depgraph/reporters/banner.ts` | @danielsimonjr/repo-tools | src | reachable | 31 |
| `src/depgraph/reporters/coverage.ts` | @danielsimonjr/repo-tools | src | reachable | 198 |
| `src/depgraph/reporters/duplicates.ts` | @danielsimonjr/repo-tools | src | reachable | 111 |
| `src/depgraph/reporters/json.ts` | @danielsimonjr/repo-tools | src | reachable | 180 |
| `src/depgraph/reporters/markdown.ts` | @danielsimonjr/repo-tools | src | reachable | 442 |
| `src/depgraph/reporters/surfaces.ts` | @danielsimonjr/repo-tools | src | reachable | 55 |
| `src/depgraph/reporters/yaml.ts` | @danielsimonjr/repo-tools | src | reachable | 44 |
| `src/depgraph/resolver.ts` | @danielsimonjr/repo-tools | src | reachable | 130 |
| `src/depgraph/roots.ts` | @danielsimonjr/repo-tools | src | reachable | 446 |
| `src/depgraph/types.ts` | @danielsimonjr/repo-tools | src | reachable | 210 |
| `src/depgraph/workspaces.ts` | @danielsimonjr/repo-tools | src | reachable | 174 |
| `src/docs/analyse.ts` | @danielsimonjr/repo-tools | src | reachable | 58 |
| `src/docs/discovery.ts` | @danielsimonjr/repo-tools | src | reachable | 242 |
| `src/docs/index.ts` | @danielsimonjr/repo-tools | src | reachable | 494 |
| `src/docs/model.ts` | @danielsimonjr/repo-tools | src | reachable | 100 |
| `src/docs/python.ts` | @danielsimonjr/repo-tools | src | reachable | 460 |
| `src/docs/report.ts` | @danielsimonjr/repo-tools | src | reachable | 197 |
| `src/docs/rules.ts` | @danielsimonjr/repo-tools | src | reachable | 79 |
| `src/docs/stub.ts` | @danielsimonjr/repo-tools | src | reachable | 193 |
| `src/docs/typescript.ts` | @danielsimonjr/repo-tools | src | reachable | 404 |
| `src/io-types.ts` | @danielsimonjr/repo-tools | src | reachable | 10 |
| `src/io.ts` | @danielsimonjr/repo-tools | src | reachable | 47 |
| `src/map/adapter.ts` | @danielsimonjr/repo-tools | src | reachable | 166 |
| `src/map/artifacts.ts` | @danielsimonjr/repo-tools | src | reachable | 702 |
| `src/map/command.ts` | @danielsimonjr/repo-tools | src | reachable | 421 |
| `src/map/coverage.ts` | @danielsimonjr/repo-tools | src | reachable | 85 |
| `src/map/cycles.ts` | @danielsimonjr/repo-tools | src | reachable | 178 |
| `src/map/discovery.ts` | @danielsimonjr/repo-tools | src | reachable | 463 |
| `src/map/grammars.ts` | @danielsimonjr/repo-tools | src | reachable | 84 |
| `src/map/graph.ts` | @danielsimonjr/repo-tools | src | reachable | 659 |
| `src/map/layers.ts` | @danielsimonjr/repo-tools | src | reachable | 76 |
| `src/map/markdown.ts` | @danielsimonjr/repo-tools | src | reachable | 232 |
| `src/map/package-field.ts` | @danielsimonjr/repo-tools | src | reachable | 19 |
| `src/map/parsing.ts` | @danielsimonjr/repo-tools | src | reachable | 894 |
| `src/map/python-stdlib.ts` | @danielsimonjr/repo-tools | src | reachable | 300 |
| `src/map/query.ts` | @danielsimonjr/repo-tools | src | reachable | 139 |
| `src/map/reports.ts` | @danielsimonjr/repo-tools | src | reachable | 109 |
| `src/map/resolvers.ts` | @danielsimonjr/repo-tools | src | reachable | 325 |
| `src/map/schema.ts` | @danielsimonjr/repo-tools | src | reachable | 182 |
| `src/map/surfaces.ts` | @danielsimonjr/repo-tools | src | reachable | 173 |
| `src/mask.ts` | @danielsimonjr/repo-tools | src | reachable | 267 |
| `src/py.ts` | @danielsimonjr/repo-tools | src | reachable | 183 |
| `src/query/args.ts` | @danielsimonjr/repo-tools | src | reachable | 179 |
| `src/query/commands.ts` | @danielsimonjr/repo-tools | src | reachable | 255 |
| `src/query/graph.ts` | @danielsimonjr/repo-tools | src | reachable | 57 |
| `src/query/index.ts` | @danielsimonjr/repo-tools | src | reachable | 120 |
| `src/query/load.ts` | @danielsimonjr/repo-tools | src | reachable | 120 |
| `src/query/safety.ts` | @danielsimonjr/repo-tools | src | reachable | 100 |
| `src/sort.ts` | @danielsimonjr/repo-tools | src | reachable | 18 |
| `src/ste/index.ts` | @danielsimonjr/repo-tools | src | reachable | 255 |
| `src/ste/markdown.ts` | @danielsimonjr/repo-tools | src | reachable | 220 |
| `src/ste/prose.ts` | @danielsimonjr/repo-tools | src | reachable | 104 |
| `src/ste/rules.ts` | @danielsimonjr/repo-tools | src | reachable | 96 |
| `src/ste/since.ts` | @danielsimonjr/repo-tools | src | reachable | 95 |
| `tests/fixtures/chunk/module.ts` | (root) | tests | test | 51 |
| `tests/fixtures/chunk/parser.ts` | (root) | tests | test | 59 |
| `tests/fixtures/compress/sample.js` | (root) | tests | test | 21 |
| `tests/fixtures/compress/sample.ts` | (root) | tests | test | 27 |
| `tests/fixtures/depgraph/mini-repo/src/B.ts` | (root) | tests | test | 13 |
| `tests/fixtures/depgraph/mini-repo/src/Z/index.ts` | (root) | tests | test | 1 |
| `tests/fixtures/depgraph/mini-repo/src/Z/loop.ts` | (root) | tests | test | 6 |
| `tests/fixtures/depgraph/mini-repo/src/Z/zed.ts` | (root) | tests | test | 10 |
| `tests/fixtures/depgraph/mini-repo/src/_x.ts` | (root) | tests | test | 4 |
| `tests/fixtures/depgraph/mini-repo/src/a.ts` | (root) | tests | test | 17 |
| `tests/fixtures/depgraph/mini-repo/src/ambient.d.ts` | (root) | tests | test | 1 |
| `tests/fixtures/depgraph/mini-repo/src/cli.ts` | (root) | tests | test | 6 |
| `tests/fixtures/depgraph/mini-repo/src/dyn.ts` | (root) | tests | test | 2 |
| `tests/fixtures/depgraph/mini-repo/src/index.ts` | (root) | tests | test | 7 |
| `tests/fixtures/depgraph/mini-repo/src/orphan.ts` | (root) | tests | test | 2 |
| `tests/fixtures/depgraph/mini-repo/src/ping.ts` | (root) | tests | test | 6 |
| `tests/fixtures/depgraph/mini-repo/src/pong.ts` | (root) | tests | test | 5 |
| `tests/fixtures/depgraph/mini-repo/src/register.ts` | (root) | tests | test | 2 |
| `tests/fixtures/depgraph/mini-repo/src/util/index.ts` | (root) | tests | test | 4 |
| `tests/fixtures/depgraph/mini-repo/src/view.tsx` | (root) | tests | test | 4 |
| `tests/fixtures/depgraph/mini-repo/tests/a.test.ts` | (root) | tests | test | 3 |
| `tests/fixtures/depgraph/mini-repo/tests/barrel.test.ts` | (root) | tests | test | 3 |
| `tests/fixtures/depgraph/mono-repo/packages/cli/src/format.ts` | (root) | tests | test | 4 |
| `tests/fixtures/depgraph/mono-repo/packages/cli/src/main.ts` | (root) | tests | test | 5 |
| `tests/fixtures/depgraph/mono-repo/packages/core/src/index.ts` | (root) | tests | test | 3 |
| `tests/fixtures/depgraph/mono-repo/packages/core/src/internal.ts` | (root) | tests | test | 2 |
| `tests/fixtures/depgraph/mono-repo/packages/core/src/math.ts` | (root) | tests | test | 11 |
| `tests/fixtures/depgraph/mono-repo/packages/core/src/types.ts` | (root) | tests | test | 2 |
| `tests/fixtures/depgraph/mono-repo/packages/core/src/worker.ts` | (root) | tests | test | 4 |
| `tests/fixtures/depgraph/mono-repo/packages/core/tests/math.test.ts` | (root) | tests | test | 3 |
| `tests/fixtures/depgraph/mono-repo/packages/core/tsup.config.ts` | (root) | config | config | 6 |
| `tests/fixtures/depgraph/pnpm-repo/apps/web/src/index.ts` | (root) | tests | test | 4 |
| `tests/fixtures/depgraph/pnpm-repo/apps/web/tests/index.test.ts` | (root) | tests | test | 3 |
| `tests/fixtures/depgraph/pnpm-repo/packages/core/src/index.ts` | (root) | tests | test | 6 |
| `tests/fixtures/depgraph/pnpm-repo/packages/util/src/index.ts` | (root) | tests | test | 4 |
| `tests/fixtures/extension/probe.mjs` | (root) | tests | test | 15 |
| `tests/golden/chunk/typescript/chunks/001-imports.ts` | (root) | tests | test | 8 |
| `tests/golden/chunk/typescript/chunks/002-function-render.ts` | (root) | tests | test | 9 |
| `tests/golden/chunk/typescript/chunks/003-const-quote-re.ts` | (root) | tests | test | 2 |
| `tests/golden/chunk/typescript/chunks/004-function-escaped.ts` | (root) | tests | test | 5 |
| `tests/golden/chunk/typescript/chunks/005-class-box.ts` | (root) | tests | test | 14 |
| `tests/golden/chunk/typescript/chunks/006-interface-shape.ts` | (root) | tests | test | 3 |
| `tests/golden/chunk/typescript/chunks/007-type-pair.ts` | (root) | tests | test | 1 |
| `tests/golden/chunk/typescript/chunks/008-enum-color.ts` | (root) | tests | test | 4 |
| `tests/golden/chunk/typescript/chunks/009-function-helper.ts` | (root) | tests | test | 3 |
| `tests/golden/chunk/typescript/chunks/010-const-limit.ts` | (root) | tests | test | 1 |
| `tests/golden/chunk/typescript/merged.ts` | (root) | tests | test | 59 |
| `tests/golden/compress/js.aggressive.compact.js` | (root) | tests | test | 1 |
| `tests/golden/compress/js.light.compact.js` | (root) | tests | test | 21 |
| `tests/golden/compress/js.medium.compact.js` | (root) | tests | test | 15 |
| `tests/golden/compress/ts.aggressive.compact.ts` | (root) | tests | test | 1 |
| `tests/golden/compress/ts.light.compact.ts` | (root) | tests | test | 27 |
| `tests/golden/compress/ts.medium.compact.ts` | (root) | tests | test | 17 |
| `tests/unit/api-surface.test.ts` | (root) | tests | test | 297 |
| `tests/unit/build.test.ts` | (root) | tests | test | 241 |
| `tests/unit/check-claims.test.ts` | (root) | tests | test | 120 |
| `tests/unit/check-command.test.ts` | (root) | tests | test | 536 |
| `tests/unit/check-metrics.test.ts` | (root) | tests | test | 125 |
| `tests/unit/check-verify.test.ts` | (root) | tests | test | 357 |
| `tests/unit/chunk-golden.ts` | (root) | tests | test | 70 |
| `tests/unit/chunk-review-2.test.ts` | (root) | tests | test | 348 |
| `tests/unit/chunk-review.test.ts` | (root) | tests | test | 376 |
| `tests/unit/chunk.test.ts` | (root) | tests | test | 322 |
| `tests/unit/cli.test.ts` | (root) | tests | test | 93 |
| `tests/unit/clones-command.test.ts` | (root) | tests | test | 493 |
| `tests/unit/clones-detect.test.ts` | (root) | tests | test | 211 |
| `tests/unit/clones-settings.test.ts` | (root) | tests | test | 150 |
| `tests/unit/clones-units.test.ts` | (root) | tests | test | 237 |
| `tests/unit/compress-golden.test.ts` | (root) | tests | test | 134 |
| `tests/unit/compress.test.ts` | (root) | tests | test | 696 |
| `tests/unit/config.test.ts` | (root) | tests | test | 323 |
| `tests/unit/depgraph-analysis.test.ts` | (root) | tests | test | 187 |
| `tests/unit/depgraph-api-surface.test.ts` | (root) | tests | test | 142 |
| `tests/unit/depgraph-args.test.ts` | (root) | tests | test | 65 |
| `tests/unit/depgraph-config-wiring.test.ts` | (root) | tests | test | 266 |
| `tests/unit/depgraph-duplicate-gate.test.ts` | (root) | tests | test | 246 |
| `tests/unit/depgraph-duplicates.test.ts` | (root) | tests | test | 293 |
| `tests/unit/depgraph-exit.test.ts` | (root) | tests | test | 91 |
| `tests/unit/depgraph-extensions.test.ts` | (root) | tests | test | 241 |
| `tests/unit/depgraph-f1.test.ts` | (root) | tests | test | 50 |
| `tests/unit/depgraph-f10.test.ts` | (root) | tests | test | 46 |
| `tests/unit/depgraph-f11.test.ts` | (root) | tests | test | 31 |
| `tests/unit/depgraph-f12.test.ts` | (root) | tests | test | 59 |
| `tests/unit/depgraph-f13.test.ts` | (root) | tests | test | 45 |
| `tests/unit/depgraph-f14.test.ts` | (root) | tests | test | 69 |
| `tests/unit/depgraph-f15.test.ts` | (root) | tests | test | 34 |
| `tests/unit/depgraph-f16.test.ts` | (root) | tests | test | 42 |
| `tests/unit/depgraph-f17.test.ts` | (root) | tests | test | 126 |
| `tests/unit/depgraph-f18.test.ts` | (root) | tests | test | 31 |
| `tests/unit/depgraph-f19.test.ts` | (root) | tests | test | 40 |
| `tests/unit/depgraph-f2.test.ts` | (root) | tests | test | 60 |
| `tests/unit/depgraph-f20.test.ts` | (root) | tests | test | 40 |
| `tests/unit/depgraph-f21.test.ts` | (root) | tests | test | 98 |
| `tests/unit/depgraph-f22.test.ts` | (root) | tests | test | 47 |
| `tests/unit/depgraph-f23.test.ts` | (root) | tests | test | 28 |
| `tests/unit/depgraph-f24.test.ts` | (root) | tests | test | 40 |
| `tests/unit/depgraph-f25.test.ts` | (root) | tests | test | 33 |
| `tests/unit/depgraph-f26.test.ts` | (root) | tests | test | 267 |
| `tests/unit/depgraph-f27.test.ts` | (root) | tests | test | 41 |
| `tests/unit/depgraph-f28.test.ts` | (root) | tests | test | 31 |
| `tests/unit/depgraph-f29.test.ts` | (root) | tests | test | 32 |
| `tests/unit/depgraph-f3.test.ts` | (root) | tests | test | 48 |
| `tests/unit/depgraph-f30.test.ts` | (root) | tests | test | 62 |
| `tests/unit/depgraph-f31.test.ts` | (root) | tests | test | 35 |
| `tests/unit/depgraph-f32.test.ts` | (root) | tests | test | 34 |
| `tests/unit/depgraph-f33.test.ts` | (root) | tests | test | 34 |
| `tests/unit/depgraph-f34.test.ts` | (root) | tests | test | 129 |
| `tests/unit/depgraph-f35.test.ts` | (root) | tests | test | 74 |
| `tests/unit/depgraph-f36.test.ts` | (root) | tests | test | 61 |
| `tests/unit/depgraph-f37.test.ts` | (root) | tests | test | 45 |
| `tests/unit/depgraph-f38.test.ts` | (root) | tests | test | 46 |
| `tests/unit/depgraph-f39.test.ts` | (root) | tests | test | 70 |
| `tests/unit/depgraph-f4.test.ts` | (root) | tests | test | 34 |
| `tests/unit/depgraph-f40.test.ts` | (root) | tests | test | 47 |
| `tests/unit/depgraph-f41.test.ts` | (root) | tests | test | 45 |
| `tests/unit/depgraph-f42.test.ts` | (root) | tests | test | 70 |
| `tests/unit/depgraph-f43.test.ts` | (root) | tests | test | 173 |
| `tests/unit/depgraph-f44.test.ts` | (root) | tests | test | 34 |
| `tests/unit/depgraph-f5.test.ts` | (root) | tests | test | 31 |
| `tests/unit/depgraph-f6.test.ts` | (root) | tests | test | 68 |
| `tests/unit/depgraph-f7.test.ts` | (root) | tests | test | 72 |
| `tests/unit/depgraph-f8.test.ts` | (root) | tests | test | 34 |
| `tests/unit/depgraph-f9.test.ts` | (root) | tests | test | 41 |
| `tests/unit/depgraph-inventory-coverage.test.ts` | (root) | tests | test | 115 |
| `tests/unit/depgraph-m1.test.ts` | (root) | tests | test | 126 |
| `tests/unit/depgraph-parse.test.ts` | (root) | tests | test | 64 |
| `tests/unit/depgraph-paths.test.ts` | (root) | tests | test | 27 |
| `tests/unit/depgraph-r1.test.ts` | (root) | tests | test | 51 |
| `tests/unit/depgraph-report.test.ts` | (root) | tests | test | 256 |
| `tests/unit/depgraph-scan.test.ts` | (root) | tests | test | 177 |
| `tests/unit/depgraph-tsx.test.ts` | (root) | tests | test | 52 |
| `tests/unit/design-refs.test.ts` | (root) | tests | test | 148 |
| `tests/unit/docs-command.test.ts` | (root) | tests | test | 459 |
| `tests/unit/docs-discovery.test.ts` | (root) | tests | test | 213 |
| `tests/unit/docs-helpers.ts` | (root) | tests | test | 88 |
| `tests/unit/docs-python.test.ts` | (root) | tests | test | 369 |
| `tests/unit/docs-report.test.ts` | (root) | tests | test | 158 |
| `tests/unit/docs-review.test.ts` | (root) | tests | test | 249 |
| `tests/unit/docs-stub.test.ts` | (root) | tests | test | 264 |
| `tests/unit/docs-typescript.test.ts` | (root) | tests | test | 606 |
| `tests/unit/dynamic-imports.ts` | (root) | tests | test | 25 |
| `tests/unit/entry-roots-build-configs.test.ts` | (root) | tests | test | 115 |
| `tests/unit/fix-ledger-audit.test.ts` | (root) | tests | test | 382 |
| `tests/unit/golden-depgraph.test.ts` | (root) | tests | test | 20 |
| `tests/unit/io.test.ts` | (root) | tests | test | 32 |
| `tests/unit/lockcheck.test.ts` | (root) | tests | test | 112 |
| `tests/unit/map-adapter.test.ts` | (root) | tests | test | 179 |
| `tests/unit/map-artifacts-e2e.test.ts` | (root) | tests | test | 228 |
| `tests/unit/map-artifacts.test.ts` | (root) | tests | test | 826 |
| `tests/unit/map-command.test.ts` | (root) | tests | test | 274 |
| `tests/unit/map-coverage.test.ts` | (root) | tests | test | 298 |
| `tests/unit/map-discovery.test.ts` | (root) | tests | test | 374 |
| `tests/unit/map-golden.test.ts` | (root) | tests | test | 48 |
| `tests/unit/map-graph-e2e.test.ts` | (root) | tests | test | 243 |
| `tests/unit/map-graph.test.ts` | (root) | tests | test | 601 |
| `tests/unit/map-layers.test.ts` | (root) | tests | test | 142 |
| `tests/unit/map-markdown.test.ts` | (root) | tests | test | 152 |
| `tests/unit/map-open-items.test.ts` | (root) | tests | test | 139 |
| `tests/unit/map-parsing-py.test.ts` | (root) | tests | test | 160 |
| `tests/unit/map-parsing-regex.test.ts` | (root) | tests | test | 168 |
| `tests/unit/map-parsing-ts.test.ts` | (root) | tests | test | 274 |
| `tests/unit/map-parsing-tsx.test.ts` | (root) | tests | test | 182 |
| `tests/unit/map-project-name.test.ts` | (root) | tests | test | 73 |
| `tests/unit/map-query.test.ts` | (root) | tests | test | 310 |
| `tests/unit/map-reports-ste.test.ts` | (root) | tests | test | 104 |
| `tests/unit/map-reports.test.ts` | (root) | tests | test | 139 |
| `tests/unit/map-resolvers.test.ts` | (root) | tests | test | 187 |
| `tests/unit/map-surfaces.test.ts` | (root) | tests | test | 115 |
| `tests/unit/mask.test.ts` | (root) | tests | test | 33 |
| `tests/unit/no-literal-bom.test.ts` | (root) | tests | test | 61 |
| `tests/unit/node-compat.test.ts` | (root) | tests | test | 95 |
| `tests/unit/offline.test.ts` | (root) | tests | test | 71 |
| `tests/unit/offline.ts` | (root) | tests | test | 31 |
| `tests/unit/privacy-accepted.test.ts` | (root) | tests | test | 279 |
| `tests/unit/privacy-check.test.ts` | (root) | tests | test | 463 |
| `tests/unit/query-args.test.ts` | (root) | tests | test | 106 |
| `tests/unit/query-commands.test.ts` | (root) | tests | test | 208 |
| `tests/unit/query-config.test.ts` | (root) | tests | test | 64 |
| `tests/unit/query-emit.test.ts` | (root) | tests | test | 94 |
| `tests/unit/query-fixture.ts` | (root) | tests | test | 99 |
| `tests/unit/query-load.test.ts` | (root) | tests | test | 148 |
| `tests/unit/query-node-safety.test.ts` | (root) | tests | test | 145 |
| `tests/unit/query-port.test.ts` | (root) | tests | test | 139 |
| `tests/unit/query-safety.test.ts` | (root) | tests | test | 25 |
| `tests/unit/sort.test.ts` | (root) | tests | test | 34 |
| `tests/unit/ste-cli.test.ts` | (root) | tests | test | 161 |
| `tests/unit/ste-markdown.test.ts` | (root) | tests | test | 106 |
| `tests/unit/ste-options.test.ts` | (root) | tests | test | 307 |
| `tests/unit/ste-prose.test.ts` | (root) | tests | test | 132 |
| `tests/unit/ste-py.test.ts` | (root) | tests | test | 49 |
| `tests/unit/temp.test.ts` | (root) | tests | test | 73 |
| `tests/unit/temp.ts` | (root) | tests | test | 71 |
| `tests/unit/tree.ts` | (root) | tests | test | 79 |

## Skipped links

Links (symbolic links and junctions) that the census did not follow. A link can point to another repository, so no file behind a link is in this inventory or in the graph.

_None._

## Warnings

_None._
