<!-- repo-map:no-verification -->
<!-- GENERATED FILE -- do not edit by hand.
     Regenerate with `repo-tools map`. -->

# Unused Files and Exports Analysis

## Summary

- **Files with no in-repo importer**: 2
- **Dormant files**: 2
  - **Orphaned (reachable from nothing)**: 2
  - **Test-only (only a test reaches them)**: 0
- **Potentially unused exports**: 120
  - **Unreferenced anywhere**: 3
  - **Referenced in their own module**: 117
  - **Not classified**: 0

## Caveats

- A literal relative `import(...)` is a graph edge. A runtime call is a namespace use (`*`), so the exports of that file count as used. A type-position `import(...).Name` counts only `Name`, and `typeof import(...)` counts none. A dynamic import built from a variable or a template, and other runtime loads (e.g. `new Worker(path)`), are still invisible -- a file or export reached ONLY through one of those is reported as no-importer/unreferenced even though it may be live.
- `noImporterFiles` is NOT a deletion-candidate list. A file with zero in-repo importers is expected, not suspicious, for: a standalone script invoked directly (e.g. a smoketest run via `node script.mjs`, never `import`ed by anything), or a build/lint config file loaded by its own tool rather than by source code (e.g. `eslint.config.mjs`, read by eslint itself). Cross-check against package.json scripts / tool configs before treating any entry here as dead.
- Only NAMED exports are analysed (`FileNode.exports` carries named exports only) -- `export default` usage is not checked here.
- The split of exports into `referencedInModule` and `unreferencedAnywhere` is a TEXT-LEVEL heuristic. The analysis counts whole-identifier occurrences in the source of the defining file, minus the declaration site itself. The count is not an AST reference count. The analysis can over-count a name that also appears in a string literal or comment. When the source text cannot be read (no `RepoGraph.root_path`, or the file is missing), the export lands in `unclassifiedExports`. The analysis does not guess a bucket for it.
- `unreferencedAnywhereNotes`'s dynamic-import check (`_dynamic_import_referrers`) only sees `import(...)` calls with a LITERAL string specifier. A dynamic import built from a variable or template literal (e.g. `import(`./cmds/${name}.js`)`, a command-dispatcher pattern) is invisible to it -- 'found none' in a note means no LITERAL match was found, NOT that nothing imports the file.

## Dormant files: orphaned

Source files that no root and no test reaches. Verify each one before you delete it.

- `src/assets.d.ts`
- `src/bin.ts`

## Dormant files: test-only

Source files that only a test reaches. They ship nothing, but a test uses them.

_None._

## Files with no in-repo importer

No file of this repository imports these files. Do not use the list as a deletion list.

- `src/assets.d.ts`
- `src/bin.ts`

## Exports unreferenced anywhere

No other file imports these names, and their own module does not use them.

- `src/depgraph/types.ts`: `RunContext`
- `src/depgraph/workspaces.ts`: `negatedWorkspaceFolders`
- `src/map/artifacts.ts`: `artifactName`

### Notes

- `src/depgraph/types.ts` `RunContext`: Checked for a dynamic import() call with a LITERAL string specifier resolving to 'src/depgraph/types.ts' across the whole repo and found none. This scan can only see import() calls with a literal string specifier -- a dynamic import built from a variable or template literal (e.g. import(`./cmds/${name}.js`)) is invisible to it, so 'found none' means no LITERAL match was found, NOT that nothing imports this. 'RunContext' may still be consumed via such a call. Also verify against consumption this scan cannot see at all (docs examples, published API surface, a runtime-built path/`new Worker(...)`) before deleting.
- `src/depgraph/workspaces.ts` `negatedWorkspaceFolders`: Checked for a dynamic import() call with a LITERAL string specifier resolving to 'src/depgraph/workspaces.ts' across the whole repo and found none. This scan can only see import() calls with a literal string specifier -- a dynamic import built from a variable or template literal (e.g. import(`./cmds/${name}.js`)) is invisible to it, so 'found none' means no LITERAL match was found, NOT that nothing imports this. 'negatedWorkspaceFolders' may still be consumed via such a call. Also verify against consumption this scan cannot see at all (docs examples, published API surface, a runtime-built path/`new Worker(...)`) before deleting.
- `src/map/artifacts.ts` `artifactName`: Checked for a dynamic import() call with a LITERAL string specifier resolving to 'src/map/artifacts.ts' across the whole repo and found none. This scan can only see import() calls with a literal string specifier -- a dynamic import built from a variable or template literal (e.g. import(`./cmds/${name}.js`)) is invisible to it, so 'found none' means no LITERAL match was found, NOT that nothing imports this. 'artifactName' may still be consumed via such a call. Also verify against consumption this scan cannot see at all (docs examples, published API surface, a runtime-built path/`new Worker(...)`) before deleting.

## Exports referenced in their own module

No other file imports these names, but their own module uses them.

- `src/check/claims.ts`: `Claim`, `Scan`
- `src/check/metrics.ts`: `MetricsOptions`
- `src/chunk/manifest.ts`: `isPlainFileName`, `legacyHash`, `validateManifest`
- `src/chunk/splitters.ts`: `Section`, `chunkExtension`
- `src/cli.ts`: `SubcommandName`
- `src/clones/detect.ts`: `NearPair`
- `src/clones/normalise.ts`: `Normal`
- `src/clones/report.ts`: `RunStats`
- `src/clones/units.ts`: `DOC_LIMIT`, `UnitKind`
- `src/compress/formats.ts`: `CompressionResult`, `Compressor`, `estimateTokens`
- `src/compress/legend.ts`: `SubstringCandidate`
- `src/config.ts`: `ApiSurfaceConfig`, `ConfigSections`, `DEFAULT_API_ENTRY`, `QueryConfig`, `QuerySettings`
- `src/depgraph/analysis.ts`: `DormantSplit`
- `src/depgraph/api-surface.ts`: `ExportKind`, `Surface`, `SurfaceOptions`, `maskNonCode`
- `src/depgraph/args.ts`: `SCAN_SCOPE_FLAGS`
- `src/depgraph/coverage.ts`: `CategoryBreakdown`, `ClassifiedUntested`, `CoveragePolicyCategory`, `ReExportMap`
- `src/depgraph/cycles.ts`: `shortestCycleThrough`
- `src/depgraph/dirlist.ts`: `linkLog`
- `src/depgraph/duplicates.ts`: `BaselineNames`, `DUPLICATE_BASELINE_NOTE`, `DupCategory`, `DupDefinerTag`, `DupExportKey`, `DuplicateAllowlistEntry`, `DuplicateBaseline`, `DuplicateDefiner`, `DuplicateNames`, `NewDuplicate`, `duplicateSymbolsNote`
- `src/depgraph/extensions.ts`: `DepgraphExtension`, `ExtensionMask`, `PreflightContext`, `ReportContext`, `readOnlyCopy`
- `src/depgraph/reporters/coverage.ts`: `CoverageBasisOptions`, `NAMESPACE_IMPORT_BASIS`
- `src/depgraph/reporters/markdown.ts`: `SummaryRow`
- `src/depgraph/reporters/surfaces.ts`: `SurfaceFilter`
- `src/depgraph/resolver.ts`: `KnownFiles`
- `src/depgraph/roots.ts`: `PackageRootFields`
- `src/depgraph/types.ts`: `ExternalDependency`, `FileExports`, `NodeDependency`, `WorkspaceDependency`
- `src/depgraph/workspaces.ts`: `matchesWorkspaceGlob`
- `src/docs/analyse.ts`: `RepoAnalysis`
- `src/docs/discovery.ts`: `Discovery`, `SKIP_DIRS`
- `src/docs/index.ts`: `unquoteGitPath`
- `src/docs/model.ts`: `Issue`, `Tier`
- `src/docs/rules.ts`: `RuleOptions`, `isTestFile`
- `src/docs/stub.ts`: `Applied`
- `src/map/artifacts.ts`: `DependencyGraphOptions`, `DuplicateSymbolsOptions`, `pyJsonDumps`
- `src/map/coverage.ts`: `TestCoverageOptions`, `isTestFile`
- `src/map/cycles.ts`: `sccContaining`
- `src/map/discovery.ts`: `CSHARP_SKIP_DIRS`, `CSHARP_SUFFIXES`, `DiscoveredFile`, `LANGUAGE_SCANS`, `PYTHON_SUFFIXES`, `RUST_SUFFIXES`, `ReachFlags`, `SKIP_DIRS`, `SOURCE_SUFFIXES`, `candidateFiles`, `gitTracked`, `gitTrackedLinks`, `isReparsePoint`
- `src/map/grammars.ts`: `GrammarName`
- `src/map/graph.ts`: `mapDistToSrc`
- `src/map/layers.ts`: `ProjectIdentity`
- `src/map/markdown.ts`: `duplicatesMarkdown`, `inventoryMarkdown`, `unusedMarkdown`
- `src/map/parsing.ts`: `RawImport`, `expandUsePath`, `pubUseNames`
- `src/map/query.ts`: `LoadedGraph`, `QueryCycleResult`
- `src/map/reports.ts`: `SubsystemReportOptions`
- `src/map/resolvers.ts`: `PythonResolver`, `Resolver`
- `src/map/schema.ts`: `GraphJson`, `ModuleEntry`
- `src/query/args.ts`: `QueryCommand`, `QueryOptions`
- `src/query/load.ts`: `GraphEdge`
- `src/query/safety.ts`: `ROOT_PACKAGE`, `entryOf`
- `src/ste/index.ts`: `HISTORICAL_MARKER`
- `src/ste/markdown.ts`: `Finding`
- `src/ste/prose.ts`: `ProseFinding`
- `src/ste/rules.ts`: `DETERMINERS`, `IRREGULAR_PARTICIPLES`
- `src/ste/since.ts`: `AddedLines`

## Exports not classified

The analysis could not read the source of these names.

_None._
