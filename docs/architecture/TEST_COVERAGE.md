<!-- repo-map:no-verification -->
<!-- GENERATED FILE -- do not edit by hand.
     Regenerate with `repo-tools map`. -->

# Test Coverage Analysis

## Summary

| Metric | Count |
|--------|-------|
| Total Source Files | 84 |
| Total Test Files | 138 |
| Source Files with Tests | 68 |
| Source Files without Tests | 16 |
| Coverage (raw, direct-import) | **81.0%** |
---

## Source Files Without Test Coverage

The following 16 source files are not directly imported by any test file:

### root/

- `src/bin.ts` → Expected test: `tests/unit/root/bin.test.ts`

### check/

- `src/check/index.ts` → Expected test: `tests/unit/check/index.test.ts`

### chunk/

- `src/chunk/manifest.ts` → Expected test: `tests/unit/chunk/manifest.test.ts`
- `src/chunk/splitters.ts` → Expected test: `tests/unit/chunk/splitters.test.ts`

### clones/

- `src/clones/index.ts` → Expected test: `tests/unit/clones/index.test.ts`
- `src/clones/report.ts` → Expected test: `tests/unit/clones/report.test.ts`

### depgraph/

- `src/depgraph/exclude.ts` → Expected test: `tests/unit/depgraph/exclude.test.ts`

### docs/

- `src/docs/index.ts` → Expected test: `tests/unit/docs/index.test.ts`
- `src/docs/rules.ts` → Expected test: `tests/unit/docs/rules.test.ts`

### map/

- `src/map/package-field.ts` → Expected test: `tests/unit/map/package-field.test.ts`
- `src/map/python-stdlib.ts` → Expected test: `tests/unit/map/python-stdlib.test.ts`

### query/

- `src/query/commands.ts` → Expected test: `tests/unit/query/commands.test.ts`
- `src/query/index.ts` → Expected test: `tests/unit/query/index.test.ts`

### ste/

- `src/ste/index.ts` → Expected test: `tests/unit/ste/index.test.ts`
- `src/ste/rules.ts` → Expected test: `tests/unit/ste/rules.test.ts`
- `src/ste/since.ts` → Expected test: `tests/unit/ste/since.test.ts`

---

## Source Files With Test Coverage

| Source File | Test Files |
|-------------|------------|
| `check/claims.ts` | `check-claims.test.ts`, `check-command.test.ts`, `check-verify.test.ts` |
| `check/metrics.ts` | `check-metrics.test.ts` |
| `check/verify.ts` | `check-verify.test.ts` |
| `chunk/index.ts` | `chunk-review-2.test.ts`, `chunk-review.test.ts`, `chunk.test.ts` |
| `src/cli.ts` | `check-command.test.ts`, `chunk.test.ts`, `cli.test.ts`, `map-command.test.ts`, `query-args.test.ts`, `query-load.test.ts`, `ste-cli.test.ts`, `ste-options.test.ts` |
| `clones/detect.ts` | `clones-detect.test.ts` |
| `clones/normalise.ts` | `clones-units.test.ts` |
| `clones/settings.ts` | `clones-settings.test.ts` |
| `clones/units.ts` | `clones-detect.test.ts`, `clones-units.test.ts` |
| `compress/formats.ts` | `compress-golden.test.ts`, `compress.test.ts` |
| `compress/index.ts` | `compress-golden.test.ts`, `compress.test.ts` |
| `compress/legend.ts` | `compress-golden.test.ts`, `compress.test.ts` |
| `src/config.ts` | `clones-settings.test.ts`, `config.test.ts`, `depgraph-api-surface.test.ts`, `depgraph-config-wiring.test.ts`, `depgraph-duplicate-gate.test.ts`, `depgraph-extensions.test.ts`, `query-commands.test.ts`, `query-node-safety.test.ts`, `query-port.test.ts` |
| `depgraph/analysis.ts` | `depgraph-analysis.test.ts`, `depgraph-duplicates.test.ts`, `depgraph-report.test.ts` |
| `depgraph/api-surface.ts` | `api-surface.test.ts` |
| `depgraph/args.ts` | `depgraph-api-surface.test.ts`, `depgraph-args.test.ts`, `depgraph-config-wiring.test.ts`, `depgraph-duplicate-gate.test.ts`, `depgraph-report.test.ts` |
| `depgraph/coverage.ts` | `depgraph-inventory-coverage.test.ts`, `depgraph-report.test.ts` |
| `depgraph/cycles.ts` | `depgraph-analysis.test.ts`, `depgraph-f26.test.ts`, `depgraph-report.test.ts`, `map-adapter.test.ts` |
| `depgraph/description.ts` | `depgraph-parse.test.ts` |
| `depgraph/dirlist.ts` | `depgraph-f2.test.ts`, `depgraph-f26.test.ts` |
| `depgraph/duplicates.ts` | `depgraph-duplicate-gate.test.ts`, `depgraph-duplicates.test.ts`, `depgraph-f27.test.ts` |
| `depgraph/extensions.ts` | `depgraph-extensions.test.ts`, `depgraph-report.test.ts` |
| `depgraph/paths.ts` | `depgraph-f31.test.ts`, `depgraph-paths.test.ts` |
| `reporters/banner.ts` | `check-command.test.ts`, `depgraph-f3.test.ts`, `depgraph-report.test.ts` |
| `reporters/coverage.ts` | `depgraph-report.test.ts`, `map-coverage.test.ts` |
| `reporters/duplicates.ts` | `depgraph-duplicates.test.ts` |
| `reporters/json.ts` | `depgraph-report.test.ts` |
| `reporters/markdown.ts` | `depgraph-f21.test.ts`, `depgraph-report.test.ts`, `shared-helpers.test.ts` |
| `reporters/surfaces.ts` | `depgraph-f22.test.ts`, `depgraph-report.test.ts` |
| `reporters/yaml.ts` | `depgraph-f5.test.ts`, `depgraph-report.test.ts` |
| `depgraph/resolver.ts` | `depgraph-f30.test.ts`, `depgraph-f7.test.ts`, `depgraph-parse.test.ts`, `map-adapter.test.ts` |
| `depgraph/roots.ts` | `depgraph-f37.test.ts`, `depgraph-scan.test.ts`, `entry-roots-build-configs.test.ts` |
| `depgraph/types.ts` | `depgraph-analysis.test.ts`, `depgraph-f22.test.ts`, `depgraph-f26.test.ts`, `depgraph-f27.test.ts`, `depgraph-parse.test.ts`, `depgraph-report.test.ts`, `depgraph-scan.test.ts`, `map-adapter.test.ts`, `shared-helpers.test.ts` |
| `depgraph/workspaces.ts` | `depgraph-f13.test.ts`, `depgraph-f34.test.ts`, `depgraph-f36.test.ts`, `depgraph-scan.test.ts` |
| `docs/analyse.ts` | `docs-discovery.test.ts` |
| `docs/discovery.ts` | `docs-discovery.test.ts` |
| `docs/model.ts` | `docs-command.test.ts`, `docs-python.test.ts`, `docs-report.test.ts`, `docs-stub.test.ts`, `docs-typescript.test.ts` |
| `docs/python.ts` | `docs-python.test.ts`, `docs-review.test.ts`, `docs-stub.test.ts` |
| `docs/report.ts` | `docs-report.test.ts` |
| `docs/stub.ts` | `docs-stub.test.ts` |
| `docs/typescript.ts` | `docs-review.test.ts`, `docs-stub.test.ts`, `docs-typescript.test.ts` |
| `src/io-types.ts` | `check-command.test.ts`, `chunk.test.ts`, `cli.test.ts`, `depgraph-report.test.ts`, `map-command.test.ts`, `query-args.test.ts`, `query-load.test.ts`, `ste-cli.test.ts`, `ste-options.test.ts` |
| `src/io.ts` | `io.test.ts`, `shared-helpers.test.ts` |
| `map/adapter.ts` | `depgraph-analysis.test.ts`, `depgraph-duplicates.test.ts`, `depgraph-inventory-coverage.test.ts`, `depgraph-report.test.ts`, `map-adapter.test.ts` |
| `map/artifacts.ts` | `map-artifacts-e2e.test.ts`, `map-artifacts.test.ts`, `map-layers.test.ts`, `map-markdown.test.ts`, `map-reports.test.ts` |
| `map/command.ts` | `depgraph-exit.test.ts`, `depgraph-f1.test.ts`, `depgraph-f2.test.ts`, `depgraph-f3.test.ts`, `depgraph-r1.test.ts`, `depgraph-report.test.ts`, `map-golden.test.ts`, `map-reports-ste.test.ts` |
| `map/coverage.ts` | `map-coverage.test.ts` |
| `map/cycles.ts` | `depgraph-analysis.test.ts`, `depgraph-duplicates.test.ts`, `depgraph-inventory-coverage.test.ts`, `depgraph-report.test.ts`, `entry-roots-build-configs.test.ts`, `map-adapter.test.ts`, `map-artifacts-e2e.test.ts`, `map-artifacts.test.ts`, `map-coverage.test.ts`, `map-graph-e2e.test.ts`, `map-graph.test.ts`, `map-layers.test.ts`, `map-markdown.test.ts`, `map-query.test.ts`, `map-reports.test.ts`, `map-surfaces.test.ts` |
| `map/discovery.ts` | `depgraph-inventory-coverage.test.ts`, `map-artifacts-e2e.test.ts`, `map-artifacts.test.ts`, `map-discovery.test.ts`, `map-graph-e2e.test.ts`, `shared-helpers.test.ts` |
| `map/grammars.ts` | `clones-units.test.ts`, `map-parsing-py.test.ts`, `map-parsing-ts.test.ts`, `map-parsing-tsx.test.ts` |
| `map/graph.ts` | `depgraph-analysis.test.ts`, `depgraph-duplicates.test.ts`, `depgraph-inventory-coverage.test.ts`, `depgraph-report.test.ts`, `entry-roots-build-configs.test.ts`, `map-adapter.test.ts`, `map-artifacts-e2e.test.ts`, `map-artifacts.test.ts`, `map-coverage.test.ts`, `map-graph-e2e.test.ts`, `map-graph.test.ts`, `map-layers.test.ts`, `map-markdown.test.ts`, `map-query.test.ts`, `map-reports.test.ts`, `map-surfaces.test.ts` |
| `map/layers.ts` | `map-layers.test.ts` |
| `map/markdown.ts` | `map-markdown.test.ts` |
| `map/parsing.ts` | `depgraph-f38.test.ts`, `depgraph-f40.test.ts`, `map-parsing-py.test.ts`, `map-parsing-regex.test.ts`, `map-parsing-ts.test.ts`, `map-parsing-tsx.test.ts`, `map-resolvers.test.ts` |
| `map/query.ts` | `map-query.test.ts` |
| `map/reports.ts` | `depgraph-f3.test.ts`, `map-reports.test.ts` |
| `map/resolvers.ts` | `depgraph-f30.test.ts`, `depgraph-parse.test.ts`, `map-resolvers.test.ts` |
| `map/schema.ts` | `map-artifacts.test.ts`, `map-graph.test.ts`, `map-query.test.ts` |
| `map/surfaces.ts` | `map-surfaces.test.ts` |
| `src/mask.ts` | `depgraph-f39.test.ts`, `mask.test.ts`, `node-compat.test.ts` |
| `src/py.ts` | `node-compat.test.ts`, `ste-py.test.ts` |
| `query/args.ts` | `query-args.test.ts`, `query-config.test.ts`, `query-port.test.ts` |
| `query/graph.ts` | `query-port.test.ts`, `query-safety.test.ts` |
| `query/load.ts` | `query-load.test.ts` |
| `query/safety.ts` | `query-port.test.ts`, `query-safety.test.ts` |
| `src/sort.ts` | `compress-golden.test.ts`, `compress.test.ts`, `depgraph-api-surface.test.ts`, `depgraph-scan.test.ts`, `golden-depgraph.test.ts`, `map-golden.test.ts`, `sort.test.ts` |
| `ste/markdown.ts` | `map-reports-ste.test.ts`, `ste-markdown.test.ts` |
| `ste/prose.ts` | `ste-prose.test.ts` |

---

## Test File Details

| Test File | Imports from Source |
|-----------|---------------------|
| `tests/a.test.ts` | 0 files |
| `tests/barrel.test.ts` | 0 files |
| `tests/math.test.ts` | 0 files |
| `tests/index.test.ts` | 0 files |
| `unit/api-surface.test.ts` | 1 files |
| `unit/build.test.ts` | 0 files |
| `unit/check-claims.test.ts` | 1 files |
| `unit/check-command.test.ts` | 4 files |
| `unit/check-metrics.test.ts` | 1 files |
| `unit/check-verify.test.ts` | 2 files |
| `unit/chunk-review-2.test.ts` | 1 files |
| `unit/chunk-review.test.ts` | 1 files |
| `unit/chunk.test.ts` | 3 files |
| `unit/cli.test.ts` | 2 files |
| `unit/clones-command.test.ts` | 0 files |
| `unit/clones-detect.test.ts` | 2 files |
| `unit/clones-settings.test.ts` | 2 files |
| `unit/clones-units.test.ts` | 3 files |
| `unit/compress-golden.test.ts` | 4 files |
| `unit/compress.test.ts` | 4 files |
| `unit/config.test.ts` | 1 files |
| `unit/depgraph-analysis.test.ts` | 6 files |
| `unit/depgraph-api-surface.test.ts` | 3 files |
| `unit/depgraph-args.test.ts` | 1 files |
| `unit/depgraph-config-wiring.test.ts` | 2 files |
| `unit/depgraph-duplicate-gate.test.ts` | 3 files |
| `unit/depgraph-duplicates.test.ts` | 6 files |
| `unit/depgraph-exit.test.ts` | 1 files |
| `unit/depgraph-extensions.test.ts` | 2 files |
| `unit/depgraph-f1.test.ts` | 1 files |
| `unit/depgraph-f10.test.ts` | 0 files |
| `unit/depgraph-f11.test.ts` | 0 files |
| `unit/depgraph-f12.test.ts` | 0 files |
| `unit/depgraph-f13.test.ts` | 1 files |
| `unit/depgraph-f14.test.ts` | 0 files |
| `unit/depgraph-f15.test.ts` | 0 files |
| `unit/depgraph-f16.test.ts` | 0 files |
| `unit/depgraph-f17.test.ts` | 0 files |
| `unit/depgraph-f18.test.ts` | 0 files |
| `unit/depgraph-f19.test.ts` | 0 files |
| `unit/depgraph-f2.test.ts` | 2 files |
| `unit/depgraph-f20.test.ts` | 0 files |
| `unit/depgraph-f21.test.ts` | 1 files |
| `unit/depgraph-f22.test.ts` | 2 files |
| `unit/depgraph-f23.test.ts` | 0 files |
| `unit/depgraph-f24.test.ts` | 0 files |
| `unit/depgraph-f25.test.ts` | 0 files |
| `unit/depgraph-f26.test.ts` | 3 files |
| `unit/depgraph-f27.test.ts` | 2 files |
| `unit/depgraph-f28.test.ts` | 0 files |
| `unit/depgraph-f29.test.ts` | 0 files |
| `unit/depgraph-f3.test.ts` | 3 files |
| `unit/depgraph-f30.test.ts` | 2 files |
| `unit/depgraph-f31.test.ts` | 1 files |
| `unit/depgraph-f32.test.ts` | 0 files |
| `unit/depgraph-f33.test.ts` | 0 files |
| `unit/depgraph-f34.test.ts` | 1 files |
| `unit/depgraph-f35.test.ts` | 0 files |
| `unit/depgraph-f36.test.ts` | 1 files |
| `unit/depgraph-f37.test.ts` | 1 files |
| `unit/depgraph-f38.test.ts` | 1 files |
| `unit/depgraph-f39.test.ts` | 1 files |
| `unit/depgraph-f4.test.ts` | 0 files |
| `unit/depgraph-f40.test.ts` | 1 files |
| `unit/depgraph-f41.test.ts` | 0 files |
| `unit/depgraph-f42.test.ts` | 0 files |
| `unit/depgraph-f43.test.ts` | 0 files |
| `unit/depgraph-f44.test.ts` | 0 files |
| `unit/depgraph-f5.test.ts` | 1 files |
| `unit/depgraph-f6.test.ts` | 0 files |
| `unit/depgraph-f7.test.ts` | 1 files |
| `unit/depgraph-f8.test.ts` | 0 files |
| `unit/depgraph-f9.test.ts` | 0 files |
| `unit/depgraph-inventory-coverage.test.ts` | 5 files |
| `unit/depgraph-m1.test.ts` | 0 files |
| `unit/depgraph-parse.test.ts` | 4 files |
| `unit/depgraph-paths.test.ts` | 1 files |
| `unit/depgraph-r1.test.ts` | 1 files |
| `unit/depgraph-report.test.ts` | 17 files |
| `unit/depgraph-scan.test.ts` | 4 files |
| `unit/depgraph-tsx.test.ts` | 0 files |
| `unit/design-refs.test.ts` | 0 files |
| `unit/docs-command.test.ts` | 1 files |
| `unit/docs-discovery.test.ts` | 2 files |
| `unit/docs-python.test.ts` | 2 files |
| `unit/docs-report.test.ts` | 2 files |
| `unit/docs-review.test.ts` | 2 files |
| `unit/docs-stub.test.ts` | 4 files |
| `unit/docs-typescript.test.ts` | 2 files |
| `unit/entry-roots-build-configs.test.ts` | 3 files |
| `unit/fix-ledger-audit.test.ts` | 0 files |
| `unit/golden-depgraph.test.ts` | 1 files |
| `unit/io.test.ts` | 1 files |
| `unit/lockcheck.test.ts` | 0 files |
| `unit/map-adapter.test.ts` | 6 files |
| `unit/map-artifacts-e2e.test.ts` | 4 files |
| `unit/map-artifacts.test.ts` | 5 files |
| `unit/map-command.test.ts` | 2 files |
| `unit/map-coverage.test.ts` | 4 files |
| `unit/map-discovery.test.ts` | 1 files |
| `unit/map-golden.test.ts` | 2 files |
| `unit/map-graph-e2e.test.ts` | 3 files |
| `unit/map-graph.test.ts` | 3 files |
| `unit/map-layers.test.ts` | 4 files |
| `unit/map-markdown.test.ts` | 4 files |
| `unit/map-open-items.test.ts` | 0 files |
| `unit/map-parsing-py.test.ts` | 2 files |
| `unit/map-parsing-regex.test.ts` | 1 files |
| `unit/map-parsing-ts.test.ts` | 2 files |
| `unit/map-parsing-tsx.test.ts` | 2 files |
| `unit/map-project-name.test.ts` | 0 files |
| `unit/map-query.test.ts` | 4 files |
| `unit/map-reports-ste.test.ts` | 2 files |
| `unit/map-reports.test.ts` | 4 files |
| `unit/map-resolvers.test.ts` | 2 files |
| `unit/map-surfaces.test.ts` | 3 files |
| `unit/mask.test.ts` | 1 files |
| `unit/no-literal-bom.test.ts` | 0 files |
| `unit/node-compat.test.ts` | 2 files |
| `unit/offline.test.ts` | 0 files |
| `unit/privacy-accepted.test.ts` | 0 files |
| `unit/privacy-check.test.ts` | 0 files |
| `unit/query-args.test.ts` | 3 files |
| `unit/query-commands.test.ts` | 1 files |
| `unit/query-config.test.ts` | 1 files |
| `unit/query-emit.test.ts` | 0 files |
| `unit/query-load.test.ts` | 3 files |
| `unit/query-node-safety.test.ts` | 1 files |
| `unit/query-port.test.ts` | 4 files |
| `unit/query-safety.test.ts` | 2 files |
| `unit/shared-helpers.test.ts` | 4 files |
| `unit/sort.test.ts` | 1 files |
| `unit/ste-cli.test.ts` | 2 files |
| `unit/ste-markdown.test.ts` | 1 files |
| `unit/ste-options.test.ts` | 2 files |
| `unit/ste-prose.test.ts` | 1 files |
| `unit/ste-py.test.ts` | 1 files |
| `unit/temp.test.ts` | 0 files |
