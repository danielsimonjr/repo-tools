<!-- repo-map:no-verification -->
<!-- GENERATED FILE -- do not edit by hand.
     Regenerate with `repo-tools map`. -->

# @danielsimonjr/repo-tools - Dependency Graph

**Version**: 2.5.0

This document provides a comprehensive dependency graph of all files, components, imports, functions, and variables in the codebase.

---

## Table of Contents

1. [Overview](#overview)
2. [Package Dependencies](#package-dependencies)
3. [Root Dependencies](#root-dependencies)
4. [Check Dependencies](#check-dependencies)
5. [Chunk Dependencies](#chunk-dependencies)
6. [Clones Dependencies](#clones-dependencies)
7. [Compress Dependencies](#compress-dependencies)
8. [Depgraph Dependencies](#depgraph-dependencies)
9. [Docs Dependencies](#docs-dependencies)
10. [Map Dependencies](#map-dependencies)
11. [Query Dependencies](#query-dependencies)
12. [Ste Dependencies](#ste-dependencies)
13. [Dependency Matrix](#dependency-matrix)
14. [Circular Dependency Analysis](#circular-dependency-analysis)
15. [Visual Dependency Graph](#visual-dependency-graph)
16. [Summary Statistics](#summary-statistics)

---

<a id="overview"></a>
## Overview

The codebase is organized into the following modules:

- **root**: 9 files
- **check**: 6 files
- **chunk**: 3 files
- **clones**: 6 files
- **compress**: 3 files
- **depgraph**: 22 files
- **docs**: 20 files
- **map**: 18 files
- **query**: 6 files
- **ste**: 5 files

---

<a id="root-dependencies"></a>

## Root Dependencies

### `src/assets.d.ts` - assets.d module

**Exports:**
- Default: `default`

---

### `src/bin.ts` - bin module

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./cli.ts` | `main` | Import |

---

### `src/cli.ts` - Command-line dispatch for `repo-tools` (design section 3).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./check/index.ts` | `CHECK_HELP, run` | Import |
| `./chunk/index.ts` | `CHUNK_HELP, run` | Import |
| `./clones/index.ts` | `CLONES_HELP, run` | Import |
| `./compress/index.ts` | `HELP, run` | Import |
| `./docs/index.ts` | `DOCS_HELP, run` | Import |
| `./docs/languages.ts` | `languageNames` | Import |
| `./io-types.ts` | `Io` | Import (type-only) |
| `./map/command.ts` | `DEPGRAPH_DEPRECATION, MAP_HELP, runMap` | Import |
| `./query/index.ts` | `QUERY_HELP, run` | Import |
| `./ste/index.ts` | `run, STE_HELP` | Import |
| `./io-types.ts` | `Io` | Re-export (type-only) |

**Exports:**
- Types: `SubcommandName`
- Functions: `main`
- Constants: `SUBCOMMANDS`
- Re-exports: `Io`

---

### `src/config.ts` - The config file `repo-tools.config.json` (design section 5) and the merge of the command-line

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `existsSync, readFileSync` |
| `path` | `posix, resolve, win32` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./depgraph/api-surface.ts` | `DEFAULT_STABILITY_TAGS` | Import |
| `./depgraph/duplicates.ts` | `DEFAULT_DISPATCH_CALLS` | Import |
| `./depgraph/exclude.ts` | `DEFAULT_EXCLUDE, TEST_DIR_NAMES` | Import |
| `./depgraph/paths.ts` | `OUTPUT_SUBDIR` | Import |
| `./depgraph/reporters/banner.ts` | `DEFAULT_REGENERATE_COMMAND, VERIFICATION_MARKER` | Import |

**Exports:**
- Interfaces: `ApiSurfaceConfig`, `DepgraphConfig`, `QuerySettings`, `QueryConfig`, `ClonesSettings`, `ConfigSections`
- Types: `DepgraphSettings`
- Functions:

  ```text
  isAbsolutePath, resolveUnderRoot, checkClonesFlag, parseConfigSections, parseConfig,
  loadConfigSections, loadConfigFile, mergeQueryConfig, mergeMapConfig, mergeDepgraphConfig
  ```

- Constants: `CONFIG_FILE`, `DEFAULT_API_ENTRY`, `ABSOLUTE_PATH_TEXT`, `MAP_REGENERATE_COMMAND`

---

### `src/io-types.ts` - Shared types for command output. Subcommand modules import `Io` from here, so they do not

**Exports:**
- Interfaces: `Io`

---

### `src/io.ts` - Deterministic file output. Every file that repo-tools writes has LF line endings, so two

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `lstatSync, mkdirSync, realpathSync, writeFileSync` |
| `path` | `basename, dirname, join, resolve` |

**Exports:**
- Functions: `writeLf`, `withOneLf`, `writeReport`, `toJson`, `realPath`

---

### `src/mask.ts` - The one comment and string masking module of repo-tools.

**Exports:**
- Functions: `blankCommentsAndStrings`, `stripComments`

---

### `src/py.ts` - The Python string behaviour that the ported Python tools (STE, map) depend on.

**Exports:**
- Functions:

  ```text
  ci, pyStrip, pyLstrip, pySplit, pySplitlines, isAlnum, headCodePoints, codePointLength, pyRepr,
  reEscape, pyDirname, pyJoin, pyNormpath
  ```

- Constants: `SPACE_BODY`, `S`, `NON_SPACE`, `W`, `B`, `D`

---

### `src/sort.ts` - Code-unit ordering (design fix F22).

**Exports:**
- Functions: `compareCodeUnits`, `sortCodeUnits`

---

<a id="check-dependencies"></a>

## Check Dependencies

### `src/check/claims.ts` - The claims of a document (design section 15): the rows of its `## Verification` table.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../depgraph/reporters/banner.ts` | `VERIFICATION_MARKER` | Import |

**Exports:**
- Interfaces: `Claim`, `Scan`
- Functions: `verificationMarkers`, `scanVerification`, `rewriteClaimValues`, `parseClaims`, `hasVerificationSection`
- Constants: `NO_VERIFICATION_MARKER`

---

### `src/check/docs.ts` - The Markdown documents of a docs folder, read for `repo-tools check` and for the Verification

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `readdirSync, readFileSync` |
| `path` | `join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../depgraph/paths.ts` | `isDirectory` | Import |
| `../sort.ts` | `sortCodeUnits` | Import |
| `./verify.ts` | `DocFile` | Import (type-only) |

**Exports:**
- Functions: `readDocs`

---

### `src/check/index.ts` - `repo-tools check` (design section 15): the drift gate. It reads the Verification tables of

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `path` | `resolve` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../config.ts` | `ABSOLUTE_PATH_TEXT, isAbsolutePath, loadConfigFile, mergeMapConfig` | Import |
| `../depgraph/args.ts` | `wantsHelp` | Import |
| `../depgraph/paths.ts` | `maskRoot` | Import |
| `../io-types.ts` | `Io` | Import (type-only) |
| `../map/command.ts` | `isDirectory` | Import |
| `./claims.ts` | `NO_VERIFICATION_MARKER, verificationMarkers` | Import |
| `./docs.ts` | `readDocs` | Import |
| `./metrics.ts` | `collectMetrics` | Import |
| `./verify.ts` | `Verdict, verifyDocs` | Import |

**Exports:**
- Functions: `run`
- Constants: `CHECK_HELP`

---

### `src/check/measure.ts` - The metrics of the four reports of `repo-tools map` that hold them. `repo-tools check` reads the

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `readFileSync` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./verify.ts` | `Measured, MetricValue` | Import (type-only) |

**Exports:**
- Interfaces: `MetricReports`
- Functions: `measureReports`

---

### `src/check/metrics.ts` - The metrics of `repo-tools check` (design section 15): the claim names that a document can

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `mkdtempSync, rmSync` |
| `os` | `tmpdir` |
| `path` | `join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../map/artifacts.ts` | `emitDependencyGraph, emitDuplicateSymbols, emitFileInventory, emitUnusedAnalysis` | Import |
| `../map/command.ts` | `graphOf` | Import |
| `./measure.ts` | `measureReports` | Import |
| `./verify.ts` | `Measured` | Import (type-only) |

**Exports:**
- Interfaces: `MetricsOptions`
- Functions: `collectMetrics`

---

### `src/check/verify.ts` - The verdict of `repo-tools check` (design section 15): each claim of each document against

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./claims.ts` | `NO_VERIFICATION_MARKER, parseClaims, rewriteClaimValues, scanVerification` | Import |

**Exports:**
- Interfaces: `Measured`, `DocFile`, `Verdict`, `ClaimChange`
- Types: `MetricValue`
- Functions: `verifyDocs`, `syncClaims`

---

<a id="chunk-dependencies"></a>

## Chunk Dependencies

### `src/chunk/index.ts` - `repo-tools chunk` (design section 8): split a large file into chunk files, merge

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `copyFileSync, existsSync, lstatSync, readFileSync, realpathSync, statSync, writeFileSync` |
| `path` | `basename, dirname, extname, isAbsolute, join, relative, resolve, sep` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../io.ts` | `realPath, writeLf` | Import |
| `../io-types.ts` | `Io` | Import (type-only) |
| `./manifest.ts` | `ChunkInfo, contentHash, FileType, hashFor, isAbsoluteAnywhere, MANIFEST_NAME, MANIFEST_VERSION, Manifest, readManifest, relativeSource, resolveSource, writeManifest` | Import |
| `./splitters.ts` | `chunkFilename, detectFileType, detectLineEnding, JsonSplit, lineBreakRuns, mergeJson, mergeJsonLayout, normalizeLineEndings, restoreLineBreaks, splitJson, splitMarkdown, splitTypeScript` | Import |

**Exports:**
- Functions: `run`
- Constants: `CHUNK_HELP`

---

### `src/chunk/manifest.ts` - The chunk manifest: its types, its hash and its file I/O (design section 8).

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `crypto` | `createHash` |
| `fs` | `readFileSync` |
| `path` | `posix, relative, resolve, sep, win32` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../io.ts` | `toJson, writeLf` | Import |
| `./splitters.ts` | `JsonLayout, LINE_BREAK_RUNS` | Import |

**Exports:**
- Interfaces: `ChunkInfo`, `Manifest`
- Types: `FileType`
- Functions:

  ```text
  contentHash, legacyHash, hashFor, relativeSource, resolveSource, readManifest, isPlainFileName,
  isAbsoluteAnywhere, validateManifest, writeManifest
  ```

- Constants: `MANIFEST_VERSION`, `MANIFEST_NAME`

---

### `src/chunk/splitters.ts` - Splitters for the `chunk` subcommand (design section 8): Markdown, JSON and TypeScript.

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `path` | `extname` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./manifest.ts` | `FileType` | Import (type-only) |

**Exports:**
- Interfaces: `Section`, `JsonLayout`, `JsonSplit`
- Functions:

  ```text
  normalizeLineEndings, detectLineEnding, lineBreakRuns, restoreLineBreaks, detectFileType,
  chunkExtension, chunkFilename, splitMarkdown, splitJson, mergeJsonLayout, mergeJson, splitTypeScript
  ```

- Constants: `LINE_BREAK_RUNS`

---

<a id="clones-dependencies"></a>

## Clones Dependencies

### `src/clones/detect.ts` - The clone detector (design section 17.6) finds exact groups.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./units.ts` | `Unit` | Import (type-only) |

**Exports:**
- Interfaces: `DetectParams`, `NearPair`, `Detection`
- Functions: `detect`

---

### `src/clones/index.ts` - `repo-tools clones` (design section 17): lists the functions of a repository and finds the

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `path` | `join, resolve` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../config.ts` | `ClonesSettings, checkClonesFlag, loadConfigSections` | Import |
| `../depgraph/paths.ts` | `maskRoot` | Import |
| `../io.ts` | `writeLf` | Import |
| `../io-types.ts` | `Io` | Import (type-only) |
| `../map/command.ts` | `isDirectory` | Import |
| `../map/discovery.ts` | `discover, readSource` | Import |
| `../map/grammars.ts` | `grammarFor, loadGrammar, parserFor` | Import |
| `./detect.ts` | `detect` | Import |
| `./report.ts` | `clonesJson, inventoryJsonl, summaryText` | Import |
| `./settings.ts` | `ClonesConfig, mergeClonesConfig` | Import |
| `./units.ts` | `Unit, unitsOf` | Import |

**Exports:**
- Functions: `run`
- Constants: `CLONES_HELP`

---

### `src/clones/normalise.ts` - The normal form of a function body (design section 17.4) is a pre-order sequence of node labels.

**External Dependencies:**
| Package | Import |
|---------|--------|
| `web-tree-sitter` | `Node` |

**Exports:**
- Interfaces: `Normal`
- Functions: `normalise`

---

### `src/clones/report.ts` - The output of `repo-tools clones` (design section 17.7): the summary text, `inventory.jsonl` and

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./detect.ts` | `Detection` | Import (type-only) |
| `./settings.ts` | `ClonesConfig` | Import (type-only) |
| `./units.ts` | `Unit` | Import (type-only) |

**Exports:**
- Interfaces: `RunStats`
- Functions: `inventoryJsonl`, `clonesJson`, `summaryText`

---

### `src/clones/settings.ts` - The settings of `repo-tools clones` (design section 17.5).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../config.ts` | `ClonesSettings` | Import (type-only) |

**Exports:**
- Interfaces: `ClonesConfig`
- Functions: `mergeClonesConfig`
- Constants: `CLONES_DEFAULTS`

---

### `src/clones/units.ts` - The function units of one parsed file (design section 17.3). A unit is a function with a name

**External Dependencies:**
| Package | Import |
|---------|--------|
| `web-tree-sitter` | `Node` |

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `crypto` | `createHash` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./normalise.ts` | `normalise` | Import |

**Exports:**
- Interfaces: `Unit`
- Types: `UnitKind`
- Functions: `unitsOf`
- Constants: `DOC_LIMIT`

---

<a id="compress-dependencies"></a>

## Compress Dependencies

### `src/compress/formats.ts` - One compressor per file format for `repo-tools compress` (design section 8).

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `path` | `extname` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./legend.ts` | `applySubstringCompression, findRepeatedSubstrings, generateAbbreviation, isRawNumber, parseLossless, renameKeys` | Import |

**Exports:**
- Interfaces: `CompressionStats`, `CompressionResult`
- Types: `FileFormat`, `CompressionLevel`, `Compressor`
- Functions: `estimateTokens`, `calculateStats`, `detectFormat`, `getCompressor`
- Constants: `FORMATS`, `LEVELS`

---

### `src/compress/index.ts` - `repo-tools compress` (design section 8).

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `existsSync, readdirSync, readFileSync, statSync, writeFileSync` |
| `path` | `basename, dirname, extname, join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../io-types.ts` | `Io` | Import (type-only) |
| `../sort.ts` | `compareCodeUnits` | Import |
| `./formats.ts` | `CompressionLevel, CompressionStats, calculateStats, detectFormat, FileFormat, FORMATS, getCompressor, LEVELS` | Import |
| `./legend.ts` | `decompress, JSON_ONLY_MESSAGE` | Import |

**Exports:**
- Interfaces: `CompressDeps`
- Functions: `findFiles`, `run`
- Constants: `HELP`

---

### `src/compress/legend.ts` - Legend build and parse for `repo-tools compress` (design section 8).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./formats.ts` | `FileFormat` | Import (type-only) |

**Exports:**
- Interfaces: `SubstringCandidate`
- Functions: `generateAbbreviation`, `findRepeatedSubstrings`, `applySubstringCompression`, `isRawNumber`, `parseLossless`, `assertNumbersKept`, `renameKeys`, `decompress`
- Constants: `JSON_ONLY_MESSAGE`

---

<a id="depgraph-dependencies"></a>

## Depgraph Dependencies

### `src/depgraph/analysis.ts` - Graph analysis: modules, the dependency matrix, reachability, the public surface, unused files

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `readFileSync` |
| `path` | `join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../mask.ts` | `stripComments` | Import |
| `./cycles.ts` | `filesInCycles` | Import |
| `./duplicates.ts` | `escapeRegExpLiteral` | Import |
| `./paths.ts` | `isSrcIndex` | Import |
| `./resolver.ts` | `targetOf, workspaceTarget` | Import |
| `./roots.ts` | `configReferencedEntries` | Import |
| `./types.ts` | `CyclicComponents, DependencyMatrix, ModuleMap, ParsedFile, PublicSurface, Statistics, UnusedAnalysis, UnusedExport, WorkspacePackage` | Import (type-only) |

**Exports:**
- Interfaces: `DormantSplit`
- Functions: `categorizeFiles`, `buildDependencyMatrix`, `findReachableFiles`, `computePublicSurface`, `detectUnused`, `generateStatistics`, `splitDormant`

---

### `src/depgraph/api-surface.ts` - API-surface extraction for a TypeScript/ESM codebase.

**Exports:**
- Interfaces: `ExportDetail`, `ReExport`, `SurfaceOptions`, `SurfaceSymbol`, `Surface`
- Types: `ExportKind`
- Functions: `maskNonCode`, `extractExportDetails`, `extractReExports`, `resolveSurface`, `createTsResolver`, `buildApiSurfaceReport`
- Constants: `DEFAULT_STABILITY_TAGS`

---

### `src/depgraph/args.ts` - The command line of `repo-tools depgraph` (design section 14.2).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../config.ts` | `ABSOLUTE_PATH_TEXT, DepgraphSettings, isAbsolutePath` | Import |

**Exports:**
- Interfaces: `DepgraphOptions`
- Types: `MapCommand`
- Functions: `scanScopeText`, `parseDepgraphArgs`, `wantsHelp`
- Constants: `SCAN_SCOPE_FLAGS`

---

### `src/depgraph/coverage.ts` - Test coverage by direct import: which source files the test files import, directly or through

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `existsSync, readFileSync` |
| `path` | `join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./paths.ts` | `outputDirOf` | Import |
| `./resolver.ts` | `targetOf` | Import |
| `./types.ts` | `ParsedFile` | Import (type-only) |

**Exports:**
- Interfaces: `CoveragePolicyCategory`, `CoveragePolicy`, `CategoryBreakdown`, `TestCoverageAnalysis`
- Types: `ClassifiedUntested`, `ReExportMap`
- Functions: `loadCoveragePolicy`, `classifyAgainstPolicy`, `buildCategoryBreakdown`, `buildReExportMap`, `traceReExports`, `analyzeTestCoverage`

---

### `src/depgraph/cycles.ts` - Cycles of the relative-import graph, by strongly connected component (fix F26).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../map/cycles.ts` | `stronglyConnectedComponents` | Import |
| `../sort.ts` | `compareCodeUnits` | Import |
| `./resolver.ts` | `targetOf` | Import |
| `./types.ts` | `CyclicComponent, CyclicComponents, ParsedFile` | Import (type-only) |

**Exports:**
- Functions: `shortestCycleThrough`, `detectCyclicComponents`, `filesInCycles`

---

### `src/depgraph/description.ts` - The file description that the subsystem reports show: the first line of a JSDoc block or of a

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `path` | `basename, dirname` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../mask.ts` | `stripComments` | Import |
| `./paths.ts` | `withoutTsExtension` | Import |
| `./types.ts` | `ParsedFile` | Import (type-only) |

**Exports:**
- Functions: `extractDescription`, `cleanExportName`, `generateFallbackDescription`

---

### `src/depgraph/dirlist.ts` - Directory listing for every depgraph walk. All walks read folders through this module, so one

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `Dirent, existsSync, lstatSync, readdirSync` |
| `path` | `join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../sort.ts` | `compareCodeUnits, sortCodeUnits` | Import |

**Exports:**
- Functions: `listNames`, `listEntries`, `isLink`, `isLinkEntry`, `isWalkable`
- Constants: `readdirHook`, `linkLog`

---

### `src/depgraph/duplicates.ts` - Duplicate symbols: names that two or more files define (not only re-export), classed as

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `readFileSync` |
| `path` | `join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../mask.ts` | `stripComments` | Import |
| `../sort.ts` | `compareCodeUnits` | Import |
| `./paths.ts` | `outputDirOf` | Import |
| `./types.ts` | `ParsedFile, PublicSurface` | Import (type-only) |

**Exports:**
- Interfaces: `DuplicateDefiner`, `DuplicateSymbolEntry`, `DuplicateSymbolsReport`, `DuplicateAllowlistEntry`, `DupCategory`, `DuplicateBaseline`, `NewDuplicate`
- Types: `DupExportKey`, `DupDefinerTag`, `DupEntryTag`, `DuplicateNames`, `DuplicateEntries`, `BaselineNames`
- Functions:

  ```text
  describeDispatchCalls, duplicateSymbolsNote, loadDuplicateAllowlist, globMatchSingle,
  findAllowlistMatch, escapeRegExpLiteral, isDispatchVariantBody, collectImportedLocalNames,
  isAliasDelegationBody, classifyDefiner, collectOwnDefiners, finalizeDuplicateEntry,
  buildDuplicateEntries, tallyByTag, detectDuplicateSymbols, buildDuplicateReport, trueDuplicateNames,
  buildDuplicateBaseline, findNewDuplicates, asDuplicateEntries, asBaselineNames
  ```

- Constants: `RUNTIME_DUP_CATEGORIES`, `TYPE_DUP_CATEGORIES`, `DEFAULT_DISPATCH_CALLS`, `DUPLICATE_SYMBOLS_NOTE`, `DUPLICATE_BASELINE_NOTE`

---

### `src/depgraph/exclude.ts` - The skip list of a source walk, as a value the caller passes. Nothing here is module state:

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `statSync` |
| `path` | `join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./dirlist.ts` | `isLink, isWalkable, listNames` | Import |

**Exports:**
- Functions: `sourceTsFilesUnder`
- Constants: `DEFAULT_EXCLUDE`, `TEST_DIR_NAMES`

---

### `src/depgraph/extensions.ts` - Repo-local extensions of depgraph (design section 6).

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `existsSync, statSync` |
| `path` | `isAbsolute, relative, resolve, sep` |
| `url` | `pathToFileURL` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../config.ts` | `DepgraphConfig, isAbsolutePath, resolveUnderRoot` | Import |
| `../io.ts` | `realPath, writeReport` | Import |
| `../mask.ts` | `blankCommentsAndStrings, stripComments` | Import |

**Exports:**
- Interfaces: `ExtensionMask`, `PreflightContext`, `ReportContext`, `DepgraphExtension`
- Functions: `readOnlyCopy`, `loadExtensions`, `runHook`, `preflightContext`, `reportContext`, `outputPath`

---

### `src/depgraph/paths.ts` - Root, source, test and output paths. Every path that leaves this module for a report is POSIX

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `statSync` |
| `path` | `join, relative` |

**Exports:**
- Functions: `withoutTsExtension`, `toPosix`, `isSrcIndex`, `relativePosix`, `maskRoot`, `srcDirOf`, `outputDirOf`, `isDirectory`
- Constants: `OUTPUT_SUBDIR`

---

### `src/depgraph/reporters/banner.ts` - The generated-file banner of every Markdown report (fix F3): the verification marker line,

**Exports:**
- Interfaces: `BannerOptions`
- Functions: `bannerFor`, `withBanner`
- Constants: `VERIFICATION_MARKER`, `DEFAULT_REGENERATE_COMMAND`

---

### `src/depgraph/reporters/coverage.ts` - TEST_COVERAGE.md and test-coverage.json.

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `path` | `basename` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../../sort.ts` | `compareCodeUnits` | Import |
| `../coverage.ts` | `TestCoverageAnalysis` | Import (type-only) |

**Exports:**
- Interfaces: `CoverageBasisOptions`
- Functions: `generateTestCoverageMarkdown`, `generateTestCoverageJson`
- Constants: `NAMESPACE_IMPORT_BASIS`, `NAMESPACE_IMPORT_COVERAGE_CAVEAT`

---

### `src/depgraph/reporters/duplicates.ts` - The duplicate-symbols.md body (without the banner). `dispatchCalls` names the calls that

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../duplicates.ts` | `DEFAULT_DISPATCH_CALLS, DupEntryTag, DuplicateSymbolEntry, DuplicateSymbolsReport, describeDispatchCalls` | Import |

**Exports:**
- Functions: `generateDuplicateSymbolsJson`, `generateDuplicateSymbolsMarkdown`

---

### `src/depgraph/reporters/json.ts` - dependency-graph.json and dependency-summary.compact.json.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../description.ts` | `cleanExportName, generateFallbackDescription` | Import |
| `../paths.ts` | `isSrcIndex` | Import |
| `../resolver.ts` | `targetOf` | Import |
| `../types.ts` | `CyclicComponents, ModuleMap, PackageJson, ParsedFile, Statistics` | Import (type-only) |

**Exports:**
- Functions: `modulesJsonOf`, `layersOf`, `entryPointsOf`, `generateJSON`, `dependencyGraphJsonText`, `generateCompactSummary`

---

### `src/depgraph/reporters/markdown.ts` - DEPENDENCY_GRAPH.md: the module sections, the dependency matrix, the cycles, the Mermaid

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `path` | `basename` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../cycles.ts` | `filesInCycles` | Import |
| `../description.ts` | `generateFallbackDescription` | Import |
| `../paths.ts` | `withoutTsExtension` | Import |
| `../resolver.ts` | `targetOf` | Import |
| `../types.ts` | `CyclicComponent, CyclicComponents, DependencyMatrix, ModuleMap, PackageJson, ParsedFile, Statistics, WorkspacePackage` | Import (type-only) |

**Exports:**
- Interfaces: `SummaryLabels`
- Types: `SummaryRow`
- Functions: `generateMermaidDiagram`, `renderExportList`, `summaryRowsOf`, `generateMarkdown`, `generatePackageDependencySection`, `insertPackageSection`
- Constants: `LONG_EXPORT_LIST_THRESHOLD`, `EXPORT_LIST_WRAP_WIDTH`

---

### `src/depgraph/reporters/surfaces.ts` - package-export-surfaces.json: per package, the union of the public export names of its module

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../../sort.ts` | `compareCodeUnits` | Import |
| `../types.ts` | `ModuleMap, PublicSurface` | Import (type-only) |

**Exports:**
- Types: `SurfaceFilter`
- Functions: `packageKeyOf`, `buildPackageExportSurfaces`, `generateSurfacesJson`

---

### `src/depgraph/reporters/yaml.ts` - dependency-graph.yaml: the dependency-graph.json object as YAML.

**External Dependencies:**
| Package | Import |
|---------|--------|
| `js-yaml` | `dump` |

**Exports:**
- Functions: `probeQuoteStyle`, `generateYaml`

---

### `src/depgraph/resolver.ts` - Specifier resolution: a relative specifier to a root-relative source path, and a package

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `path` | `dirname, join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./paths.ts` | `toPosix` | Import |
| `./types.ts` | `WorkspacePackage` | Import (type-only) |

**Exports:**
- Interfaces: `KnownFiles`
- Functions: `distToSrc`, `resolveCandidates`, `resolvePath`, `targetOf`, `workspaceEntryPath`, `workspaceTarget`, `resolveWorkspaceSource`

---

### `src/depgraph/roots.ts` - Reachability roots: the files that nothing imports but that ship or run. Sources are the

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `existsSync, readFileSync` |
| `path` | `dirname, join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./dirlist.ts` | `listNames` | Import |
| `./exclude.ts` | `DEFAULT_EXCLUDE, sourceTsFilesUnder` | Import |
| `./paths.ts` | `relativePosix, toPosix` | Import |
| `./resolver.ts` | `distToSrc` | Import |
| `./types.ts` | `ParsedFile, WorkspacePackage` | Import (type-only) |

**Exports:**
- Interfaces: `PackageRootFields`
- Types: `Warn`
- Functions:

  ```text
  isJsonObject, tsupConfigEntries, stripJsonc, seedTsconfigEntries, exportsSubpathEntries,
  packageEntryFiles, rootPackageEntries, selfPackage, configReferencedEntries, htmlReferencedEntries,
  runtimeLaunchedEntries, collectEntryPoints
  ```


---

### `src/depgraph/types.ts` - Shared types of the depgraph pipeline: the parsed-file record, the edges, the exports, the

**Exports:**
- Interfaces:

  ```text
  Dependency, ExternalDependency, NodeDependency, FileExports, WorkspaceDependency, ParsedFile,
  DependencyMatrix, Statistics, UnusedExport, UnusedAnalysis, ModuleMap, PackageJson,
  WorkspacePackage, CyclicComponent, CyclicComponents, PublicSurface, RunContext
  ```


---

### `src/depgraph/workspaces.ts` - Workspace detection: npm and Yarn `workspaces`, `pnpm-workspace.yaml`, and the structural

**External Dependencies:**
| Package | Import |
|---------|--------|
| `js-yaml` | `load` |

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `existsSync, readFileSync` |
| `path` | `join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./dirlist.ts` | `isLink, isLinkEntry, listEntries, listNames` | Import |
| `./paths.ts` | `toPosix` | Import |
| `./roots.ts` | `exportsSubpathEntries, isJsonObject, packageEntryFiles, Warn` | Import |
| `./types.ts` | `WorkspacePackage` | Import (type-only) |

**Exports:**
- Functions: `readWorkspacePatterns`, `matchesWorkspaceGlob`, `negatedWorkspaceFolders`, `detectWorkspaces`

---

<a id="docs-dependencies"></a>

## Docs Dependencies

### `src/docs/analyse.ts` - Reads the discovered files and runs the analyser of each language.

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `readFileSync` |
| `path` | `join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./discovery.ts` | `discover, languageOf` | Import |
| `./languages.ts` | `specOf` | Import |
| `./model.ts` | `FileReport, newReport` | Import |

**Exports:**
- Interfaces: `RepoAnalysis`
- Functions: `readSourceText`, `analyseFile`, `analyseRepo`

---

### `src/docs/cfamily.ts` - Analyse C and C++ translation units for documentation coverage.

**External Dependencies:**
| Package | Import |
|---------|--------|
| `web-tree-sitter` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../map/grammars.ts` | `parserFor` | Import |
| `../ste/prose.ts` | `proseOf` | Import |
| `./comments.ts` | `analyseWith, DocText, firstProse, parsesClean, Reader` | Import |
| `./model.ts` | `FileReport, Kind` | Import (type-only) |

**Exports:**
- Functions: `sanitiseGuards`, `analyseCFamily`, `parsesAsCFamily`

---

### `src/docs/comments.ts` - The driver that the tree-sitter analysers share. A grammar keeps a comment as a

**External Dependencies:**
| Package | Import |
|---------|--------|
| `web-tree-sitter` | `Node, Parser` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../map/grammars.ts` | `GrammarName, loadGrammar` | Import |
| `./model.ts` | `DocSymbol, FileReport, Kind, newReport` | Import |
| `./rules.ts` | `applyRules` | Import |

**Exports:**
- Interfaces: `DocText`, `Reader`
- Functions: `parsesClean`, `firstProse`, `analyseWith`

---

### `src/docs/csharp.ts` - The C# analyser of `repo-tools docs`, built on tree-sitter.

**External Dependencies:**
| Package | Import |
|---------|--------|
| `web-tree-sitter` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../map/grammars.ts` | `parserFor` | Import |
| `../ste/prose.ts` | `proseOf` | Import |
| `./comments.ts` | `analyseWith, DocText, firstProse, parsesClean, Reader` | Import |
| `./model.ts` | `FileReport, Kind` | Import (type-only) |

**Exports:**
- Functions: `parsesAsCSharp`, `analyseCSharp`

---

### `src/docs/discovery.ts` - Source discovery for `repo-tools docs`.

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `child_process` | `spawnSync` |
| `fs` | `Dirent, existsSync, readdirSync, readFileSync, statSync` |
| `path` | `join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../map/discovery.ts` | `countLanguages` | Import |
| `../sort.ts` | `sortCodeUnits` | Import |
| `./languages.ts` | `LANGUAGES, languageNames, specForPath` | Import |

**Exports:**
- Classes: `ConfigError`, `UnreadableRepoLanguage`
- Interfaces: `Discovery`
- Functions: `assertReadableLanguage`, `languageOf`, `discover`
- Constants: `SKIP_DIRS`, `CONFIG_NAME`

---

### `src/docs/go.ts` - Go analyser of `repo-tools docs`, built on tree-sitter.

**External Dependencies:**
| Package | Import |
|---------|--------|
| `web-tree-sitter` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../map/grammars.ts` | `parserFor` | Import |
| `../ste/prose.ts` | `proseOf` | Import |
| `./comments.ts` | `analyseWith, DocText, firstProse, parsesClean, Reader` | Import |
| `./model.ts` | `FileReport, Kind` | Import (type-only) |

**Exports:**
- Functions: `parsesAsGo`, `analyseGo`

---

### `src/docs/index.ts` - `repo-tools docs` (design section 16): measure, stub and gate the documentation comments of the

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `lstatSync, readFileSync, realpathSync, writeFileSync` |
| `path` | `basename, isAbsolute, join, relative, resolve, sep` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../depgraph/args.ts` | `wantsHelp` | Import |
| `../depgraph/paths.ts` | `maskRoot, toPosix` | Import |
| `../io-types.ts` | `Io` | Import (type-only) |
| `../map/command.ts` | `isDirectory` | Import |
| `./analyse.ts` | `analyseRepo` | Import |
| `./discovery.ts` | `assertReadableLanguage, CONFIG_NAME, languageOf, UnreadableRepoLanguage` | Import |
| `./languages.ts` | `LANGUAGES, LanguageSpec, languageNames, specOf` | Import |
| `./model.ts` | `FileReport, isParsed` | Import |
| `./report.ts` | `pctText, summarise, writeOutputs` | Import |
| `./stub.ts` | `applyInsertions, Insertion, planPython, planTypeScript, splitLines, startsItsLine` | Import |
| `./styles.ts` | `isStyle, STYLES` | Import |

**Exports:**
- Functions: `unquoteGitPath`, `run`
- Constants: `DOCS_HELP`

---

### `src/docs/java.ts` - The Java analyser of `repo-tools docs`, built on tree-sitter.

**External Dependencies:**
| Package | Import |
|---------|--------|
| `web-tree-sitter` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../map/grammars.ts` | `parserFor` | Import |
| `../ste/prose.ts` | `proseOf` | Import |
| `./comments.ts` | `analyseWith, DocText, firstProse, parsesClean, Reader` | Import |
| `./model.ts` | `FileReport, Kind` | Import (type-only) |

**Exports:**
- Functions: `analyseJava`, `parsesAsJava`
- Constants: `JAVA`

---

### `src/docs/kotlin.ts` - The Kotlin analyser of `repo-tools docs` builds on tree-sitter.

**External Dependencies:**
| Package | Import |
|---------|--------|
| `web-tree-sitter` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../map/grammars.ts` | `parserFor` | Import |
| `../ste/prose.ts` | `proseOf` | Import |
| `./comments.ts` | `analyseWith, DocText, firstProse, parsesClean, Reader` | Import |
| `./model.ts` | `FileReport, Kind` | Import (type-only) |

**Exports:**
- Constants: `KOTLIN`, `analyseKotlin`, `parsesAsKotlin`

---

### `src/docs/languages.ts` - The language registry of `repo-tools docs`: one entry for each language that the command reads.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../map/discovery.ts` | `CSHARP_SKIP_DIRS, suffixOf` | Import |
| `./cfamily.ts` | `analyseCFamily, parsesAsCFamily` | Import |
| `./csharp.ts` | `analyseCSharp, parsesAsCSharp` | Import |
| `./go.ts` | `analyseGo, parsesAsGo` | Import |
| `./java.ts` | `analyseJava, parsesAsJava` | Import |
| `./kotlin.ts` | `analyseKotlin, parsesAsKotlin` | Import |
| `./model.ts` | `FileReport` | Import (type-only) |
| `./php.ts` | `analysePhp, parsesAsPhp` | Import |
| `./python.ts` | `analysePython, parsesAsPython` | Import |
| `./ruby.ts` | `analyseRuby, parsesAsRuby` | Import |
| `./rust.ts` | `analyseRust, parsesAsRust` | Import |
| `./typescript.ts` | `analyseTypeScript, parsesAsTypeScript` | Import |

**Exports:**
- Interfaces: `LanguageSpec`
- Functions: `specOf`, `specForPath`, `languageNames`
- Constants: `LANGUAGES`

---

### `src/docs/model.ts` - The data model of `repo-tools docs`. One `DocSymbol` per documentable declaration. Every language

**Exports:**
- Interfaces: `Issue`, `DocSymbol`, `FileReport`, `Stats`
- Types: `Kind`, `Tier`
- Functions: `isParsed`, `newReport`
- Constants: `STUB_MARKER`

---

### `src/docs/php.ts` - Analyse PHP sources for the `repo-tools docs` command.

**External Dependencies:**
| Package | Import |
|---------|--------|
| `web-tree-sitter` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../map/grammars.ts` | `parserFor` | Import |
| `../ste/prose.ts` | `proseOf` | Import |
| `./comments.ts` | `analyseWith, DocText, firstProse, parsesClean, Reader` | Import |
| `./model.ts` | `FileReport, Kind` | Import (type-only) |

**Exports:**
- Functions: `analysePhp`, `parsesAsPhp`

---

### `src/docs/python.ts` - The Python analyser of `repo-tools docs`, built on the tree-sitter Python grammar.

**External Dependencies:**
| Package | Import |
|---------|--------|
| `web-tree-sitter` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../map/grammars.ts` | `loadGrammar, parserFor` | Import |
| `../py.ts` | `pySplitlines, pyStrip, S, W` | Import |
| `../ste/prose.ts` | `proseOf` | Import |
| `./model.ts` | `DocSymbol, FileReport, newReport` | Import |
| `./rules.ts` | `applyRules` | Import |

**Exports:**
- Functions: `detectDialect`, `documentedParams`, `cleandoc`, `parsesAsPython`, `analysePython`

---

### `src/docs/report.ts` - The aggregate counts and the coverage report.

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `path` | `join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../io.ts` | `toJson, writeReport` | Import |
| `./model.ts` | `DocSymbol, FileReport, isParsed, Stats` | Import |

**Exports:**
- Functions: `percent`, `summarise`, `renderMarkdown`, `writeOutputs`
- Constants: `pctText`

---

### `src/docs/ruby.ts` - ruby module

**External Dependencies:**
| Package | Import |
|---------|--------|
| `web-tree-sitter` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../map/grammars.ts` | `parserFor` | Import |
| `../ste/prose.ts` | `proseOf` | Import |
| `./comments.ts` | `analyseWith, DocText, firstProse, parsesClean, Reader` | Import |
| `./model.ts` | `FileReport, Kind` | Import (type-only) |

**Exports:**
- Functions: `analyseRuby`, `parsesAsRuby`

---

### `src/docs/rules.ts` - The rules of the docstring spec that both language analysers apply, in one place.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../ste/prose.ts` | `checkProse` | Import |
| `./model.ts` | `DocSymbol, STUB_MARKER` | Import |

**Exports:**
- Interfaces: `RuleOptions`
- Functions: `isTestFile`, `applyRules`

---

### `src/docs/rust.ts` - The Rust analyser of `repo-tools docs`, built on tree-sitter.

**External Dependencies:**
| Package | Import |
|---------|--------|
| `web-tree-sitter` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../map/grammars.ts` | `parserFor` | Import |
| `../ste/prose.ts` | `proseOf` | Import |
| `./comments.ts` | `analyseWith, DocText, firstProse, parsesClean, Reader` | Import |
| `./model.ts` | `FileReport, Kind` | Import (type-only) |

**Exports:**
- Functions: `parsesAsRust`, `analyseRust`

---

### `src/docs/stub.ts` - The stub writer: the only part of `repo-tools docs` that changes source files.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../py.ts` | `pyLstrip` | Import |
| `./model.ts` | `DocSymbol` | Import (type-only) |
| `./styles.ts` | `isStyle, STYLES, Style` | Import |

**Exports:**
- Interfaces: `Insertion`, `Applied`
- Functions: `splitLines`, `planPython`, `startsItsLine`, `planTypeScript`, `applyInsertions`

---

### `src/docs/styles.ts` - The docstring styles of `docs stub --style=`. Each style writes the marker on every line that

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./model.ts` | `DocSymbol, STUB_MARKER` | Import |

**Exports:**
- Interfaces: `Style`
- Functions: `isStyle`
- Constants: `STYLES`

---

### `src/docs/typescript.ts` - The TypeScript and JavaScript analyser of `repo-tools docs`, built on tree-sitter.

**External Dependencies:**
| Package | Import |
|---------|--------|
| `web-tree-sitter` | `Node, Parser, Tree` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../map/grammars.ts` | `grammarFor, loadGrammar, parserFor` | Import |
| `../py.ts` | `B, NON_SPACE, pySplitlines, pyStrip, S` | Import |
| `../ste/prose.ts` | `proseOf` | Import |
| `./model.ts` | `DocSymbol, FileReport, Kind, newReport` | Import |
| `./rules.ts` | `applyRules` | Import |

**Exports:**
- Functions: `sanitise`, `parsesAsTypeScript`, `analyseTypeScript`

---

<a id="map-dependencies"></a>

## Map Dependencies

### `src/map/adapter.ts` - The map engine's graph as depgraph's parsed-file records, so that depgraph's analyzers (layers,

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `readFileSync` |
| `path` | `join, posix` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../depgraph/description.ts` | `extractDescription` | Import |
| `../depgraph/types.ts` | `Dependency, ParsedFile, WorkspacePackage` | Import (type-only) |
| `../depgraph/workspaces.ts` | `detectWorkspaces` | Import |
| `./schema.ts` | `FileNode, RepoGraph` | Import (type-only) |

**Exports:**
- Functions: `toParsedFiles`

---

### `src/map/artifacts.ts` - The four core artifacts of the map engine: dependency-graph.json, file-inventory.json,

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `mkdirSync, readFileSync, statSync, writeFileSync` |
| `path` | `basename, dirname, join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../depgraph/analysis.ts` | `computePublicSurface` | Import |
| `../depgraph/dirlist.ts` | `readdirHook` | Import |
| `../depgraph/duplicates.ts` | `buildDuplicateReport, detectDuplicateSymbols` | Import |
| `../depgraph/roots.ts` | `rootPackageEntries` | Import |
| `../depgraph/workspaces.ts` | `detectWorkspaces` | Import |
| `../mask.ts` | `stripComments` | Import |
| `../py.ts` | `B, reEscape, S, SPACE_BODY, W` | Import |
| `../sort.ts` | `compareCodeUnits` | Import |
| `./adapter.ts` | `toParsedFiles` | Import |
| `./cycles.ts` | `stronglyConnectedComponents` | Import |
| `./discovery.ts` | `readSource, rglobParts` | Import |
| `./graph.ts` | `CycleLimits, findCycles` | Import |
| `./resolvers.ts` | `getResolver` | Import |
| `./schema.ts` | `FileNode, RepoGraph, toJson` | Import |

**Exports:**
- Interfaces: `DependencyGraphOptions`, `DuplicateSymbolsOptions`
- Functions: `pyJsonDumps`, `writeJson`, `emitDependencyGraph`, `emitFileInventory`, `importsNameSymbols`, `emitDuplicateSymbols`, `emitUnusedAnalysis`
- Constants: `artifactName`

---

### `src/map/command.ts` - `repo-tools map` (design decision D8): the command of the 2.0.0 engine. It builds the graph of

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `existsSync, mkdirSync, readFileSync, writeFileSync` |
| `path` | `join, resolve` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../check/claims.ts` | `verificationMarkers` | Import |
| `../check/docs.ts` | `readDocs` | Import |
| `../check/measure.ts` | `MetricReports, measureReports` | Import |
| `../check/verify.ts` | `DocFile, syncClaims` | Import |
| `../config.ts` | `DepgraphConfig, loadConfigFile, mergeMapConfig, resolveUnderRoot` | Import |
| `../depgraph/args.ts` | `DepgraphOptions, MapCommand, parseDepgraphArgs, scanScopeText, wantsHelp` | Import |
| `../depgraph/duplicates.ts` | `asBaselineNames, asDuplicateEntries, buildDuplicateBaseline, DuplicateEntries, findNewDuplicates, trueDuplicateNames` | Import |
| `../depgraph/extensions.ts` | `loadExtensions, preflightContext, reportContext, runHook` | Import |
| `../depgraph/paths.ts` | `isDirectory, maskRoot, OUTPUT_SUBDIR, relativePosix` | Import |
| `../io.ts` | `writeReport` | Import |
| `../io-types.ts` | `Io` | Import (type-only) |
| `../sort.ts` | `sortCodeUnits` | Import |
| `./artifacts.ts` | `emitDependencyGraph, emitDuplicateSymbols, emitFileInventory, emitUnusedAnalysis` | Import |
| `./coverage.ts` | `emitTestCoverage` | Import |
| `./discovery.ts` | `discover, Language, UnsupportedRepoLanguage, walkedSourceFiles` | Import |
| `./graph.ts` | `buildGraph` | Import |
| `./layers.ts` | `emitDependencyLayers, subsystemView` | Import |
| `./markdown.ts` | `emitMarkdownReports` | Import |
| `./reports.ts` | `emitSubsystemReports` | Import |
| `./schema.ts` | `RepoGraph` | Import (type-only) |
| `./surfaces.ts` | `emitApiSurface, emitExportSurfaces, NO_SURFACE_REASON` | Import |

**Exports:**
- Functions: `runMap`, `graphOf`
- Constants: `MAP_HELP`, `DEPGRAPH_DEPRECATION`

---

### `src/map/coverage.ts` - Test coverage on the map engine's graph (design decision D5), for every language:

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `path` | `join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../depgraph/coverage.ts` | `analyzeTestCoverage` | Import |
| `../depgraph/reporters/banner.ts` | `BannerOptions, withBanner` | Import |
| `../depgraph/reporters/coverage.ts` | `generateTestCoverageJson, generateTestCoverageMarkdown` | Import |
| `../io.ts` | `writeReport` | Import |
| `./adapter.ts` | `toParsedFiles` | Import |
| `./artifacts.ts` | `importsNameSymbols` | Import |
| `./reports.ts` | `MAP_REGENERATE_COMMAND` | Import |
| `./schema.ts` | `RepoGraph` | Import (type-only) |

**Exports:**
- Interfaces: `TestCoverageOptions`
- Functions: `isTestFile`, `emitTestCoverage`

---

### `src/map/cycles.ts` - Simple-cycle enumeration over a plain edge map, shared by the graph (`findCycles`) and the

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../sort.ts` | `compareCodeUnits` | Import |

**Exports:**
- Interfaces: `CycleLimits`, `CycleResult`
- Functions: `sccContaining`, `simpleCycles`, `stronglyConnectedComponents`

---

### `src/map/discovery.ts` - Discovery for the map engine: which language a repository is, which files it holds, and the

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `child_process` | `spawnSync` |
| `fs` | `Dirent, lstatSync, readFileSync, statSync` |
| `path` | `join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../depgraph/dirlist.ts` | `readdirHook` | Import |
| `../py.ts` | `pySplitlines` | Import |
| `../sort.ts` | `compareCodeUnits` | Import |

**Exports:**
- Classes: `UnsupportedRepoLanguage`
- Interfaces: `DiscoveredFile`, `ReachFlags`
- Types: `Language`
- Functions:

  ```text
  classifyArea, dispositionForArea, suffixOf, isReparsePoint, rglobParts, countLanguages, gitTracked,
  gitTrackedLinks, candidateFiles, walkedSourceFiles, detectLanguage, readSource,
  skippedSourceFolders, discover
  ```

- Constants: `SOURCE_SUFFIXES`, `PYTHON_SUFFIXES`, `CSHARP_SUFFIXES`, `RUST_SUFFIXES`, `SKIP_DIRS`, `CSHARP_SKIP_DIRS`, `LANGUAGE_SCANS`

---

### `src/map/grammars.ts` - The tree-sitter grammars of the map engine: loaded lazily, once each, from the `.wasm` files

**External Dependencies:**
| Package | Import |
|---------|--------|
| `@tree-sitter-grammars/tree-sitter-kotlin/tree-sitter-kotlin.wasm` | `default` |
| `tree-sitter-c/tree-sitter-c.wasm` | `default` |
| `tree-sitter-c-sharp/tree-sitter-c_sharp.wasm` | `default` |
| `tree-sitter-cpp/tree-sitter-cpp.wasm` | `default` |
| `tree-sitter-go/tree-sitter-go.wasm` | `default` |
| `tree-sitter-java/tree-sitter-java.wasm` | `default` |
| `tree-sitter-php/tree-sitter-php.wasm` | `default` |
| `tree-sitter-python/tree-sitter-python.wasm` | `default` |
| `tree-sitter-ruby/tree-sitter-ruby.wasm` | `default` |
| `tree-sitter-rust/tree-sitter-rust.wasm` | `default` |
| `tree-sitter-typescript/tree-sitter-tsx.wasm` | `default` |
| `tree-sitter-typescript/tree-sitter-typescript.wasm` | `default` |
| `web-tree-sitter` | `Language, Parser` |
| `web-tree-sitter/web-tree-sitter.wasm` | `default` |

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `readFileSync` |
| `path` | `isAbsolute` |
| `url` | `fileURLToPath` |

**Exports:**
- Types: `GrammarName`
- Functions: `loadGrammar`, `grammarFor`, `parserFor`
- Constants: `GRAMMAR_NAMES`

---

### `src/map/graph.ts` - Graph assembly for the map engine: discovery, reading and resolution joined into a `RepoGraph`,

**External Dependencies:**
| Package | Import |
|---------|--------|
| `smol-toml` | `parse` |

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `readFileSync, statSync` |
| `path` | `basename, join, resolve` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../depgraph/resolver.ts` | `resolveWorkspaceSource, workspaceTarget` | Import |
| `../depgraph/roots.ts` | `configReferencedEntries, htmlReferencedEntries, rootPackageEntries, runtimeLaunchedEntries, selfPackage` | Import |
| `../depgraph/types.ts` | `ParsedFile, WorkspacePackage` | Import (type-only) |
| `../depgraph/workspaces.ts` | `detectWorkspaces` | Import |
| `../py.ts` | `B, pyRepr, S, SPACE_BODY, W` | Import |
| `../sort.ts` | `compareCodeUnits` | Import |
| `./cycles.ts` | `CycleLimits, CycleResult, simpleCycles` | Import |
| `./discovery.ts` | `detectLanguage, discover, dispositionForArea, Language, readSource, rglobParts, skippedSourceFolders` | Import |
| `./grammars.ts` | `grammarFor, loadGrammar` | Import |
| `./package-field.ts` | `packageField` | Import |
| `./parsing.ts` | `ParsedModule, parseCs, parsePy, parseRs, parseTs` | Import |
| `./resolvers.ts` | `getResolver` | Import |
| `./schema.ts` | `Dependency, FileNode, newRepoGraph, RepoGraph` | Import |
| `./cycles.ts` | `CycleLimits, CycleResult` | Re-export (type-only) |

**Exports:**
- Functions: `mapDistToSrc`, `buildGraph`, `reachableFrom`, `findCycles`
- Re-exports: `CycleLimits`, `CycleResult`

---

### `src/map/layers.ts` - dependency-layers.json (design decision D3): depgraph's subsystem view, built on the map engine's

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `path` | `join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../depgraph/analysis.ts` | `categorizeFiles` | Import |
| `../depgraph/cycles.ts` | `detectCyclicComponents` | Import |
| `../depgraph/reporters/json.ts` | `entryPointsOf, layersOf, modulesJsonOf` | Import |
| `../depgraph/types.ts` | `CyclicComponents, ModuleMap, ParsedFile` | Import (type-only) |
| `../depgraph/workspaces.ts` | `detectWorkspaces` | Import |
| `./adapter.ts` | `toParsedFiles` | Import |
| `./artifacts.ts` | `writeJson` | Import |
| `./package-field.ts` | `packageField` | Import |
| `./schema.ts` | `RepoGraph, SCHEMA_VERSION` | Import |

**Exports:**
- Interfaces: `ProjectIdentity`, `SubsystemView`
- Functions: `projectIdentity`, `subsystemView`, `emitDependencyLayers`

---

### `src/map/markdown.ts` - The Markdown reports of the map engine (design decisions D4 and D5), for every language:

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `readFileSync` |
| `path` | `join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../depgraph/duplicates.ts` | `DEFAULT_DISPATCH_CALLS, DuplicateSymbolsReport` | Import |
| `../depgraph/reporters/banner.ts` | `BannerOptions, withBanner` | Import |
| `../depgraph/reporters/duplicates.ts` | `generateDuplicateSymbolsMarkdown` | Import |
| `../io.ts` | `writeReport` | Import |
| `../sort.ts` | `sortCodeUnits` | Import |
| `./reports.ts` | `MAP_REGENERATE_COMMAND` | Import |

**Exports:**
- Functions: `inventoryMarkdown`, `duplicatesMarkdown`, `unusedMarkdown`, `emitMarkdownReports`

---

### `src/map/package-field.ts` - A string field of the package.json in `root`, or null. A missing, malformed or non-object

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `readFileSync` |
| `path` | `join` |

**Exports:**
- Functions: `packageField`

---

### `src/map/parsing.ts` - The source readers of the map engine: one per language, each giving the same language-neutral

**External Dependencies:**
| Package | Import |
|---------|--------|
| `web-tree-sitter` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../py.ts` | `S, W` | Import |
| `./grammars.ts` | `grammarFor, parserFor` | Import |

**Exports:**
- Interfaces: `RawImport`, `ParsedModule`
- Functions: `emptyModule`, `parseTs`, `parseCs`, `pubUseNames`, `expandUsePath`, `parseRs`, `parsePy`

---

### `src/map/python-stdlib.ts` - The top-level module names of the Python standard library: `sys.stdlib_module_names` of

**Exports:**
- Constants: `PYTHON_STDLIB_MODULES`

---

### `src/map/query.ts` - Read-only queries over a written `dependency-graph.json`. The module reads the graph JSON and

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `readFileSync` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../sort.ts` | `compareCodeUnits` | Import |
| `./cycles.ts` | `CycleLimits, CycleResult, simpleCycles` | Import |
| `./schema.ts` | `SCHEMA_VERSION` | Import |

**Exports:**
- Interfaces: `GraphDocument`, `LoadedGraph`, `QueryCycleResult`
- Functions: `loadGraph`, `dependents`, `symbolUsers`, `cycles`

---

### `src/map/reports.ts` - The subsystem reports of the map engine (design decisions D3 and D5), for every language:

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `readFileSync` |
| `path` | `join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../config.ts` | `MAP_REGENERATE_COMMAND` | Import |
| `../depgraph/analysis.ts` | `buildDependencyMatrix` | Import |
| `../depgraph/reporters/banner.ts` | `BannerOptions, withBanner` | Import |
| `../depgraph/reporters/json.ts` | `generateCompactSummary` | Import |
| `../depgraph/reporters/markdown.ts` | `generateMarkdown, SummaryLabels, summaryRowsOf` | Import |
| `../depgraph/reporters/yaml.ts` | `generateYaml` | Import |
| `../depgraph/types.ts` | `Statistics` | Import (type-only) |
| `../io.ts` | `writeReport` | Import |
| `./layers.ts` | `projectIdentity, SubsystemView, subsystemView` | Import |
| `./schema.ts` | `RepoGraph` | Import (type-only) |

**Exports:**
- Interfaces: `SubsystemReportOptions`
- Functions: `emitSubsystemReports`

---

### `src/map/resolvers.ts` - The resolvers of the map engine: one per language, each mapping an import specifier to a file of

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../py.ts` | `pyDirname, pyJoin, pyNormpath` | Import |
| `../sort.ts` | `compareCodeUnits` | Import |
| `./parsing.ts` | `ParsedModule` | Import (type-only) |
| `./python-stdlib.ts` | `PYTHON_STDLIB_MODULES` | Import |

**Exports:**
- Classes: `TypeScriptResolver`, `PythonResolver`, `CSharpResolver`, `RustResolver`
- Interfaces: `Resolver`
- Functions: `getResolver`
- Constants: `NODE_BUILTINS`

---

### `src/map/schema.ts` - The graph schema of the map engine: the contract that every reader feeds and every report reads.

**Exports:**
- Interfaces: `Dependency`, `FileNode`, `RepoGraph`, `ModuleEntry`, `GraphJson`
- Functions: `newRepoGraph`, `toJson`
- Constants: `SCHEMA_VERSION`

---

### `src/map/surfaces.ts` - package-export-surfaces.json on the map engine's graph (design decision D5): per package, the

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `readFileSync` |
| `path` | `join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../depgraph/analysis.ts` | `categorizeFiles, computePublicSurface` | Import |
| `../depgraph/api-surface.ts` | `buildApiSurfaceReport, createTsResolver, extractExportDetails, resolveSurface` | Import |
| `../depgraph/reporters/surfaces.ts` | `generateSurfacesJson` | Import |
| `../depgraph/roots.ts` | `rootPackageEntries` | Import |
| `../depgraph/workspaces.ts` | `detectWorkspaces` | Import |
| `../io.ts` | `writeReport` | Import |
| `../sort.ts` | `sortCodeUnits` | Import |
| `./adapter.ts` | `toParsedFiles` | Import |
| `./schema.ts` | `RepoGraph` | Import (type-only) |

**Exports:**
- Functions: `emitApiSurface`, `emitExportSurfaces`
- Constants: `NO_SURFACE_REASON`

---

<a id="query-dependencies"></a>

## Query Dependencies

### `src/query/args.ts` - The command line of `repo-tools query` (design section 7).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../config.ts` | `ABSOLUTE_PATH_TEXT, isAbsolutePath` | Import |

**Exports:**
- Interfaces: `QueryOptions`
- Types: `QueryCommand`
- Functions: `parseQueryArgs`

---

### `src/query/commands.ts` - The commands of `repo-tools query` on the core graph (design decision D8). Each command writes

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../config.ts` | `isAbsolutePath, resolveUnderRoot` | Import |
| `../depgraph/cycles.ts` | `detectCyclicComponents` | Import |
| `../depgraph/types.ts` | `CyclicComponent, ParsedFile` | Import (type-only) |
| `../io.ts` | `writeReport` | Import |
| `../io-types.ts` | `Io` | Import (type-only) |
| `../map/query.ts` | `dependents, GraphDocument, cycles, symbolUsers` | Import |
| `../sort.ts` | `sortCodeUnits` | Import |
| `./graph.ts` | `buildForward, fileEntriesOf, invert` | Import |
| `./load.ts` | `loadSurfaces, QueryInput` | Import |
| `./safety.ts` | `browserSafePackages, computeTaint, findLeaks, packagesOf` | Import |

**Exports:**
- Functions: `dependents`, `symbolUsersCommand`, `isPublic`, `cycles`, `nodeSafety`, `emit`, `checkBrowserSafety`

---

### `src/query/graph.ts` - The edge model of `repo-tools query` on the core graph: the forward and the reverse file edges.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../sort.ts` | `sortCodeUnits` | Import |
| `./load.ts` | `GraphFileEntry, QueryGraph` | Import (type-only) |

**Exports:**
- Types: `FilePair`
- Functions: `fileEntriesOf`, `buildForward`, `invert`

---

### `src/query/index.ts` - `repo-tools query`: answers structural questions from the core graph that `repo-tools map`

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `existsSync, statSync` |
| `path` | `resolve` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../config.ts` | `loadConfigSections, mergeQueryConfig` | Import |
| `../depgraph/paths.ts` | `maskRoot, OUTPUT_SUBDIR` | Import |
| `../io-types.ts` | `Io` | Import (type-only) |
| `./args.ts` | `parseQueryArgs` | Import |
| `./commands.ts` | `checkBrowserSafety, cycles, dependents, emit, isPublic, nodeSafety, symbolUsersCommand` | Import |
| `./load.ts` | `loadQueryInput` | Import |

**Exports:**
- Functions: `run`
- Constants: `QUERY_HELP`

---

### `src/query/load.ts` - The input of `repo-tools query` (design decision D8): the core `dependency-graph.json` of

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `existsSync, readFileSync` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../config.ts` | `resolveUnderRoot` | Import |
| `../map/query.ts` | `GraphDocument, loadGraph` | Import |

**Exports:**
- Interfaces: `GraphEdge`, `GraphFileEntry`, `QueryGraph`, `QueryInput`
- Functions: `loadQueryInput`, `loadSurfaces`

---

### `src/query/safety.ts` - The browser-safety model of `repo-tools query` (design section 7).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../sort.ts` | `sortCodeUnits` | Import |
| `./graph.ts` | `FilePair` | Import (type-only) |

**Exports:**
- Functions: `entryOf`, `packagesOf`, `browserSafePackages`, `computeTaint`, `reachableFrom`, `findLeaks`
- Constants: `ROOT_PACKAGE`

---

<a id="ste-dependencies"></a>

## Ste Dependencies

### `src/ste/index.ts` - `repo-tools ste`: check Markdown documents, or docstring prose, against the mechanically

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `Dirent, existsSync, lstatSync, readdirSync, readFileSync, statSync` |
| `path` | `basename, join, resolve` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../io-types.ts` | `Io` | Import (type-only) |
| `../sort.ts` | `compareCodeUnits` | Import |
| `./markdown.ts` | `checkMarkdownFindings` | Import |
| `./prose.ts` | `checkProse, proseOf` | Import |
| `./since.ts` | `addedLinesSince, SinceError, touchesAdded` | Import |

**Exports:**
- Functions: `run`
- Constants: `STE_HELP`, `HISTORICAL_MARKER`

---

### `src/ste/markdown.ts` - The Markdown harness of the STE checker: a Markdown document in, gate findings out.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../py.ts` | `B, D, headCodePoints, isAlnum, pyLstrip, pyRepr, pySplit, pySplitlines, pyStrip, reEscape, S` | Import |
| `./rules.ts` | `AMBIGUOUS_SOURCE, IDENTIFIER_SOURCE, MAX_WORDS_DESCRIPTIVE, MAX_WORDS_PROCEDURAL, PASSIVE_SOURCE, rule, WORDY` | Import |

**Exports:**
- Interfaces: `Finding`
- Functions: `checkMarkdownFindings`, `checkMarkdown`

---

### `src/ste/prose.ts` - The docstring harness of the STE checker: a string of prose in, advisory findings out.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../py.ts` | `B, ci, codePointLength, headCodePoints, pySplit, pySplitlines, pyStrip, reEscape, S` | Import |
| `./rules.ts` | `AMBIGUOUS_SOURCE, MAX_WORDS_PROCEDURAL, PASSIVE_SOURCE, rule, stripIdentifiers, WORDY` | Import |

**Exports:**
- Types: `ProseFinding`
- Functions: `checkProse`, `proseOf`

---

### `src/ste/rules.ts` - The ASD-STE100 rule core: the one set of rules that both STE harnesses use.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../py.ts` | `B, ci, S, W` | Import |

**Exports:**
- Functions: `rule`, `stripIdentifiers`
- Constants: `IRREGULAR_PARTICIPLES`, `DETERMINERS`, `PASSIVE_SOURCE`, `AMBIGUOUS_SOURCE`, `WORDY`, `IDENTIFIER_SOURCE`, `MAX_WORDS_PROCEDURAL`, `MAX_WORDS_DESCRIPTIVE`

---

### `src/ste/since.ts` - `repo-tools ste --since=<rev>`: the lines of a file that the working tree adds or changes since

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `child_process` | `spawnSync` |
| `path` | `basename, dirname, resolve` |

**Exports:**
- Classes: `SinceError`
- Types: `AddedLines`
- Functions: `addedLinesSince`, `touchesAdded`

---

<a id="dependency-matrix"></a>
## Dependency Matrix

### File Import/Export Matrix

| File | Imports From | Exports To |
|------|--------------|------------|
| `src/map/command` | 21 files | 5 files |
| `src/sort` | 0 files | 21 files |
| `src/docs/model` | 0 files | 18 files |
| `src/map/artifacts` | 14 files | 4 files |
| `src/config` | 5 files | 11 files |
| `src/depgraph/paths` | 0 files | 16 files |
| `src/depgraph/types` | 0 files | 16 files |
| `src/docs/languages` | 12 files | 4 files |
| `src/map/graph` | 13 files | 2 files |
| `src/map/grammars` | 0 files | 14 files |
| `src/ste/prose` | 2 files | 12 files |
| `src/map/reports` | 10 files | 3 files |
| `src/clones/index` | 11 files | 1 file |
| `src/docs/index` | 11 files | 1 file |
| `src/cli` | 10 files | 1 file |
| `src/depgraph/analysis` | 7 files | 4 files |
| `src/docs/comments` | 3 files | 8 files |
| `src/io` | 0 files | 11 files |
| `src/map/layers` | 9 files | 2 files |
| `src/py` | 0 files | 11 files |
| `src/query/commands` | 10 files | 1 file |
| `src/check/index` | 9 files | 1 file |
| `src/depgraph/duplicates` | 4 files | 6 files |
| `src/depgraph/roots` | 5 files | 5 files |
| `src/io-types` | 0 files | 10 files |
| `src/map/surfaces` | 9 files | 1 file |
| `src/depgraph/resolver` | 2 files | 7 files |
| `src/depgraph/workspaces` | 4 files | 5 files |
| `src/map/coverage` | 8 files | 1 file |
| `src/map/discovery` | 3 files | 6 files |
| `src/map/schema` | 0 files | 9 files |
| `src/depgraph/cycles` | 4 files | 4 files |
| `src/map/adapter` | 4 files | 4 files |
| `src/map/markdown` | 6 files | 1 file |
| `src/query/index` | 6 files | 1 file |
| `src/check/verify` | 1 file | 5 files |
| `src/depgraph/description` | 3 files | 3 files |
| `src/depgraph/dirlist` | 1 file | 5 files |
| `src/depgraph/reporters/json` | 4 files | 2 files |
| `src/depgraph/reporters/markdown` | 5 files | 1 file |

---

<a id="circular-dependency-analysis"></a>
## Circular Dependency Analysis

**5 cyclic components detected** (strongly connected components of the import graph):

- **Runtime components**: 1 (2 files; require attention)
- **Type-only components**: 4 (8 files; a type-only import closes each cycle)

### Runtime Cyclic Components

Each component holds a cycle of runtime imports, and the cycle can cause issues. Each line shows the shortest cycle through the first member:

- tests/fixtures/depgraph/mini-repo/src/ping.ts -> tests/fixtures/depgraph/mini-repo/src/pong.ts -> tests/fixtures/depgraph/mini-repo/src/ping.ts
  - Members (2): `tests/fixtures/depgraph/mini-repo/src/ping.ts`, `tests/fixtures/depgraph/mini-repo/src/pong.ts`

### Type-Only Cyclic Components

Each component needs a type-only import to close its cycle. Type imports are erased at runtime. Each line shows the shortest cycle through the first member:

- scripts/fix-ledger-audit.ts -> scripts/fix-ledger-mutations.ts -> scripts/fix-ledger-audit.ts
  - Members (2): `scripts/fix-ledger-audit.ts`, `scripts/fix-ledger-mutations.ts`
- src/chunk/manifest.ts -> src/chunk/splitters.ts -> src/chunk/manifest.ts
  - Members (2): `src/chunk/manifest.ts`, `src/chunk/splitters.ts`
- src/compress/formats.ts -> src/compress/legend.ts -> src/compress/formats.ts
  - Members (2): `src/compress/formats.ts`, `src/compress/legend.ts`
- tests/fixtures/depgraph/mini-repo/src/Z/loop.ts -> tests/fixtures/depgraph/mini-repo/src/Z/zed.ts -> tests/fixtures/depgraph/mini-repo/src/Z/loop.ts
  - Members (2): `tests/fixtures/depgraph/mini-repo/src/Z/loop.ts`, `tests/fixtures/depgraph/mini-repo/src/Z/zed.ts`

---

<a id="visual-dependency-graph"></a>
## Visual Dependency Graph

```mermaid
graph TD
    subgraph Root
        N0[assets.d]
        N1[bin]
        N2[cli]
        N3[config]
        N4[io-types]
        N5[io]
        N6[mask]
        N7[py]
        N8[sort]
    end

    subgraph Check
        N9[claims]
        N10[docs]
        N11[index]
        N12[measure]
        N13[metrics]
        N14[verify]
    end

    subgraph Chunk
        N15[index]
        N16[manifest]
        N17[splitters]
    end

    subgraph Clones
        N18[detect]
        N19[index]
        N20[normalise]
        N21[report]
        N22[settings]
        N23[units]
    end

    subgraph Compress
        N24[formats]
        N25[index]
        N26[legend]
    end

    subgraph Depgraph
        N27[analysis]
        N28[api-surface]
        N29[args]
        N30[coverage]
        N31[cycles]
        N32[description]
        N33[dirlist]
        N34[duplicates]
        N35[exclude]
        N36[extensions]
        N37[...12 more]
    end

    subgraph Docs
        N38[analyse]
        N39[cfamily]
        N40[comments]
        N41[csharp]
        N42[discovery]
        N43[go]
        N44[index]
        N45[java]
        N46[kotlin]
        N47[languages]
        N48[...10 more]
    end

    subgraph Map
        N49[adapter]
        N50[artifacts]
        N51[command]
        N52[coverage]
        N53[cycles]
        N54[discovery]
        N55[grammars]
        N56[graph]
        N57[layers]
        N58[markdown]
        N59[...8 more]
    end

    subgraph Query
        N60[args]
        N61[commands]
        N62[graph]
        N63[index]
        N64[load]
        N65[safety]
    end

    subgraph Ste
        N66[index]
        N67[markdown]
        N68[prose]
        N69[rules]
        N70[since]
    end

    N1 --> N2
    N10 --> N8
    N10 --> N14
    N11 --> N3
    N11 --> N29
    N11 --> N4
    N11 --> N51
    N11 --> N9
    N11 --> N10
    N11 --> N13
    N11 --> N14
    N12 --> N14
    N13 --> N50
    N13 --> N51
    N13 --> N12
    N13 --> N14
    N14 --> N9
    N15 --> N5
    N15 --> N4
    N15 --> N16
    N15 --> N17
    N16 --> N5
    N16 --> N17
    N17 --> N16
    N2 --> N11
    N2 --> N15
    N2 --> N19
    N2 --> N25
    N2 --> N44
    N2 --> N47
    N2 --> N4
    N2 --> N51
    N2 --> N63
    N2 --> N66
    N18 --> N23
    N19 --> N3
    N19 --> N5
    N19 --> N4
    N19 --> N51
    N19 --> N54
    N19 --> N55
    N19 --> N18
    N19 --> N21
    N19 --> N22
    N19 --> N23
    N21 --> N18
    N21 --> N22
    N21 --> N23
    N22 --> N3
    N23 --> N20
    N24 --> N26
    N25 --> N4
    N25 --> N8
    N25 --> N24
    N25 --> N26
    N26 --> N24
    N3 --> N28
    N3 --> N34
    N3 --> N35
    N27 --> N6
    N27 --> N31
    N27 --> N34
    N29 --> N3
    N31 --> N53
    N31 --> N8
    N32 --> N6
    N33 --> N8
    N34 --> N6
    N34 --> N8
    N35 --> N33
    N36 --> N3
    N36 --> N5
    N36 --> N6
    N38 --> N42
    N38 --> N47
```

---

<a id="summary-statistics"></a>
## Summary Statistics

| Category | Count |
|----------|-------|
| Total Source Files | 324 |
| Subsystems | 10 |
| Total Lines of Code | 52047 |
| Total Exports | 802 |
| Total Re-exports | 12 |
| Total Classes | 15 |
| Total Interfaces | 154 |
| Total Functions | 466 |
| Total Type Guards | 21 |
| Total Enums | 4 |
| Type-only Imports | 82 |
| Runtime Cyclic Components | 1 |
| Type-only Cyclic Components | 4 |
| Files in Runtime Cycles | 2 |
| Files in Type-only Cycles | 8 |

---

*Version*: 2.5.0
