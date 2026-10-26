# repo-tools Components

This document describes each module of `src/`. Each section gives the purpose of the module, the
real declarations of its main exports, and the facts that a reader needs to change it. The
declarations come from the source. A long declaration is cut after its parameter list.

[OVERVIEW.md](OVERVIEW.md) gives the counts. [DATAFLOW.md](DATAFLOW.md) shows how the modules work
together in one run. [API.md](API.md) lists the command line, the config file and the report
formats.

## Contents

1. [Entry](#1-entry)
2. [Shared core](#2-shared-core)
3. [Map engine](#3-map-engine-srcmap)
4. [Analyzers and reporters](#4-analyzers-and-reporters-srcdepgraph)
5. [Check](#5-check-srccheck)
6. [Query](#6-query-srcquery)
7. [Clones](#7-clones-srcclones)
8. [Docs](#8-docs-srcdocs)
9. [Ste](#9-ste-srcste)
10. [Chunk](#10-chunk-srcchunk)
11. [Compress](#11-compress-srccompress)

---

## 1. Entry

### `src/bin.ts`

The process entry. The file calls `main` with the arguments after the program name. The file binds
`stdout` and `stderr` to the process streams. The file sets `process.exitCode` to the result. No source file
imports it. The build script names it as the entry file.

### `src/cli.ts`

The dispatcher. It keeps a `REGISTRY` object with nine entries: `map`, `depgraph`, `check`, `docs`,
`chunk`, `compress`, `query`, `ste` and `clones`. Each entry has a `summary`, a `help` text and a
`run` function. The registry uses `satisfies Record<string, Subcommand>`, so a missing field is a
compile error.

```ts
export type SubcommandName = keyof typeof REGISTRY;
export const SUBCOMMANDS = Object.keys(REGISTRY) as readonly SubcommandName[];
export async function main(argv: readonly string[], io: Io): Promise<number>
```

`main` follows these rules in order.

| Input | Result |
|---|---|
| No argument, `--help` or `-h` | Prints the usage list. Exit code 0. |
| `--version` | Prints the version from `package.json`. Exit code 0. |
| A first argument that is not a subcommand | Prints a message and the usage list to `stderr`. Exit code 1. |
| `--help` or `-h` anywhere after the subcommand | Prints the help of that subcommand. Exit code 0. |
| A subcommand with no `run` function | Prints "not implemented in this build". Exit code 1. |
| Any other input | Calls `run(rest, io)` and returns its exit code. |

The `Io` type lives in `src/io-types.ts`.

```ts
export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}
```

---

## 2. Shared core

### `src/config.ts`

The config file `repo-tools.config.json`. The file has three sections: `map` (the old name `depgraph` is
also accepted), `query` and `clones`. The file also accepts a `$schema` key. The loader refuses a
file that has both `map` and `depgraph`. The loader also refuses an unknown key, a value of the wrong kind and
an absolute path. Each key has a kind (`path`, `paths`, `names`, `calls`, `boolean`, `string`,
`count`, `fraction` and others), and `checkValue` enforces it.

```ts
export const CONFIG_FILE = "repo-tools.config.json";
export const DEFAULT_API_ENTRY = "src/index.ts";
export const ABSOLUTE_PATH_TEXT = "holds an absolute path; pass a path relative to the root";

export function isAbsolutePath(path: string): boolean
export function resolveUnderRoot(root: string, path: string): string
export function checkClonesFlag(label: string, key: keyof ClonesSettings, value: unknown): unknown
export function parseConfigSections(parsed: unknown, label: string): ConfigSections
export function parseConfig(parsed: unknown, label: string): DepgraphSettings
export function loadConfigSections(root: string, configPath?: string): ConfigSections
export function loadConfigFile(root: string, configPath?: string): DepgraphSettings
export function mergeQueryConfig(cli: QuerySettings, file: ConfigSections): QueryConfig
export function mergeMapConfig(cli: DepgraphSettings, file: DepgraphSettings): DepgraphConfig
export function mergeDepgraphConfig(cli: DepgraphSettings, file: DepgraphSettings): DepgraphConfig
```

`DepgraphConfig` holds `src`, `tests`, `out`, `exclude`, `alsoExclude`, `strictOrphans`,
`dispatchCalls`, `duplicateAllowlist`, `duplicateBaseline`, `coveragePolicy`, `regenerateCommand`,
`verificationMarker`, `apiSurface` and `extensions`. The precedence is: a command-line flag, then
the config file, then the default. A missing default file is not an error. A missing file that
`--config` names is an error. An error text shows the root as `<root>`.

### `src/io.ts`

Deterministic file output. Every writer ends the text with one LF and writes no CR.

```ts
export function writeLf(path: string, text: string): void
export function withOneLf(text: string): string
export function writeReport(path: string, text: string): void
export function toJson(value: unknown): string
export function realPath(path: string): string | undefined
```

`realPath` returns the real path of the nearest existing folder with the missing names added. When
a link on the way does not resolve, `realPath` returns `undefined`.

### `src/mask.ts`

The comment and string masker. It exists once, and the extensions receive it through their context.

```ts
export function blankCommentsAndStrings(src: string): string
export function stripComments(src: string): string
```

`blankCommentsAndStrings` replaces the content of comments and strings with spaces and keeps the
line structure. `stripComments` removes comments only.

### `src/py.ts`

Helpers that give the same result as the matching Python functions, and regular-expression parts
that match the Python meaning of "space" and "word". The `docs` and `ste` subcommands and the map
parsers use them.

```ts
export const SPACE_BODY: string;  export const S: string;  export const NON_SPACE: string;
export const W = "[\\p{L}\\p{N}_]";  export const D = "\\p{Nd}";
export function ci(pattern: string): string
export function pyStrip(text: string): string
export function pyLstrip(text: string): string
export function pySplit(text: string): string[]
export function pySplitlines(text: string): string[]
export function isAlnum(ch: string): boolean
export function headCodePoints(text: string, n: number): string
export function codePointLength(text: string): number
export function pyRepr(text: string): string
export function reEscape(text: string): string
export function pyDirname(path: string): string
export function pyJoin(first: string, ...rest: string[]): string
export function pyNormpath(path: string): string
```

### `src/sort.ts`

The only string order in the program. It compares UTF-16 code units.

```ts
export function compareCodeUnits(a: string, b: string): number
export function sortCodeUnits(values: readonly string[]): string[]
```

---

## 3. Map engine (`src/map/`)

The engine reads a repository and builds a `RepoGraph`. The `map` command and the `check`, `clones`
and `docs` commands use it. The files are in four groups: discovery, parsing, graph, and output.

### Discovery: `discovery.ts`, `package-field.ts`

```ts
export type Language = "typescript" | "python" | "csharp" | "rust";
export class UnsupportedRepoLanguage extends Error
export function classifyArea(relPath: string): string
export function dispositionForArea(area: string, flags: ReachFlags = {}): string
export function countLanguages(root: string): Record<string, number>
export function detectLanguage(root: string): Language
export function gitTracked(root: string): Set<string> | null
export function gitTrackedLinks(root: string): Set<string>
export function isReparsePoint(path: string): boolean
export function rglobParts(root: string, suffix: string): string[][]
export function candidateFiles(root: string, suffixes: Set<string>, extraSkip?: Set<string>, skippedLinks?: Set<string>): string[][]
export function walkedSourceFiles(root: string, language: Language): string[]
export function skippedSourceFolders(root: string, language: Language): string[]
export function readSource(path: string): string
export function discover(root: string, language: Language = detectLanguage(root), skippedLinks?: Set<string>): DiscoveredFile[]
```

The suffix sets are `SOURCE_SUFFIXES` (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`),
`PYTHON_SUFFIXES`, `CSHARP_SUFFIXES` and `RUST_SUFFIXES`. `SKIP_DIRS` names the folders that a walk
skips. `CSHARP_SKIP_DIRS` adds `obj` and `bin`. `LANGUAGE_SCANS` maps each language to its suffix
set and its skip set. `detectLanguage` picks the language with the most files. A repository with
no readable language throws `UnsupportedRepoLanguage`.

`classifyArea` gives each path one area: `tools`, `config`, `tests`, `benchmarks`, `examples`, `docs`
or `src`. A test-file name wins over `tools/` and `scripts/`. `dispositionForArea` turns an area and
the reachability flags into a disposition. A `src` file is `build-entry`, `reachable`, `test-only`
or `orphan`. The other areas give `test`, `tool`, `config`, `bench` or `example`.

`packageField(root, key)` reads one string field of the root `package.json`, or returns `null`.

### Parsing: `grammars.ts`, `parsing.ts`, `python-stdlib.ts`

```ts
export type GrammarName = "typescript" | "tsx" | "python";
export function loadGrammar(name: GrammarName): Promise<Parser>
export function grammarFor(path: string): GrammarName
export function parserFor(name: GrammarName): Parser

export function emptyModule(): ParsedModule
export function parseTs(source: string, path = ""): ParsedModule
export function parsePy(source: string): ParsedModule
export function parseCs(source: string): ParsedModule
export function parseRs(source: string): ParsedModule
export function pubUseNames(raw: string): string[]
export function expandUsePath(raw: string): string[]
```

`loadGrammar` loads a grammar once and `parserFor` returns the cached parser. A call to
`parserFor` before the matching `loadGrammar` is an error. The four `.wasm` files load through the
Bun file loader, and `src/assets.d.ts` types the import.

`ParsedModule` holds the imports (`RawImport`), the named exports and the default export. It also
holds the namespaces or child modules that the file declares, the kind of each export and the
re-export clauses. `parseTs` and `parsePy` use tree-sitter. `parseCs` and `parseRs` use text rules.
`python-stdlib.ts` exports `PYTHON_STDLIB_MODULES`, a set of module names. The resolver uses it to
tell a standard-library import from a package import.

### Resolution: `resolvers.ts`

```ts
export interface Resolver { /* one resolver for each language */ }
export const NODE_BUILTINS: ReadonlySet<string>
export class TypeScriptResolver implements Resolver
export class PythonResolver implements Resolver
export class CSharpResolver implements Resolver
export class RustResolver implements Resolver
export function getResolver(language: string): Resolver
```

A resolver turns an import specifier into a file of the census, or into a classification:
standard library, alias, relative path or package.

### Graph: `graph.ts`, `schema.ts`, `cycles.ts`

```ts
export async function buildGraph(root: string): Promise<RepoGraph>
export function reachableFrom(graph: RepoGraph, roots: readonly string[]): Set<string>
export function findCycles(graph: RepoGraph, limits: CycleLimits = {}): CycleResult
export function mapDistToSrc(path: string, known: ReadonlySet<string>): string | null

export const SCHEMA_VERSION = "2.0.0";
export interface Dependency {}  export interface FileNode {}  export interface RepoGraph {}
export function newRepoGraph(init: { /* name, language, root and the file list */ }): RepoGraph
export function toJson(graph: RepoGraph): GraphJson

export function simpleCycles(edges: ReadonlyMap<string, string[]>, limits: CycleLimits = {}): CycleResult
export function stronglyConnectedComponents(graph: ReadonlyMap<string, readonly string[]>): string[][]
export function sccContaining(start: string, eligible: ReadonlySet<string>, edges: ReadonlyMap<string, string[]>, reverseEdges: ReadonlyMap<string, string[]>): Set<string>
```

`buildGraph` runs these steps in order.

1. Detect the language.
2. Discover the files.
3. Detect workspaces (TypeScript only).
4. Load the grammars.
5. Parse each file and resolve its imports.
6. Expand barrel files that re-export with `export *`, until no edge changes.
7. Find the entry roots.
8. Collect the warnings.
9. Create the graph.
10. Refine the dispositions from reachability.

`simpleCycles` enumerates simple cycles up to a cap and reports a truncation, so a cycle count
is a lower bound when the cap applies.

### Output: `artifacts.ts`, `layers.ts`, `reports.ts`, `markdown.ts`, `coverage.ts`, `surfaces.ts`, `adapter.ts`

```ts
export function emitDependencyGraph(graph: RepoGraph, outDir: string, options?: DependencyGraphOptions): string
export function emitFileInventory(graph: RepoGraph, outDir: string): string
export function emitDuplicateSymbols(graph: RepoGraph, outDir: string, options?: DuplicateSymbolsOptions): string
export function emitUnusedAnalysis(graph: RepoGraph, outDir: string): string
export function pyJsonDumps(data: unknown): string
export function writeJson(path: string, data: unknown): string

export function projectIdentity(root: string, graph: RepoGraph): ProjectIdentity
export function subsystemView(graph: RepoGraph, root: string, warn?: (message: string) => void): SubsystemView
export function emitDependencyLayers(graph: RepoGraph, root: string, outDir: string, view?: SubsystemView): string

export function emitSubsystemReports(graph: RepoGraph, root: string, outDir: string, corePath: string, options?: SubsystemReportOptions): string[]
export function emitMarkdownReports(outDir: string, banner?: BannerOptions, dispatchCalls?: readonly string[]): string[]
export function emitTestCoverage(graph: RepoGraph, root: string, outDir: string, options?: TestCoverageOptions): [string, string]
export function emitExportSurfaces(graph: RepoGraph, root: string, outDir: string): string | null
export function emitApiSurface(graph: RepoGraph, root: string, outPath: string, entry: string, stabilityTags: readonly string[]): number

export function toParsedFiles(graph: RepoGraph, root: string, options?: { allAreas?: boolean; loadEdges?: boolean }): ParsedFile[]
```

Each `emit*` function writes one or two files and returns the path or the paths. `emitMarkdownReports`
renders the Markdown form of the JSON reports that earlier steps wrote. Call it after them.
`toParsedFiles` adapts a `RepoGraph` to the `ParsedFile` type of the analyzers.
`NO_SURFACE_REASON` in `surfaces.ts` maps a language to the reason that it has no export surface.

### Command: `command.ts`, `query.ts`

```ts
export const MAP_HELP: string;  export const DEPGRAPH_DEPRECATION: string;
export function isDirectory(path: string): boolean
export async function runMap(argv: string[], io: Io, command: MapCommand = "map"): Promise<number>
export async function graphOf(root: string): Promise<RepoGraph>

export function loadGraph(graphPath: string): LoadedGraph
export function dependents(data: GraphDocument, file: string): string[]
export function symbolUsers(data: GraphDocument, symbol: string): string[]
export function cycles(data: GraphDocument, limits: CycleLimits = {}): QueryCycleResult
```

`runMap` handles the flags, the config merge, the three special modes (`--write-duplicate-baseline`,
`--check-census`, `--check-duplicates`) and the report pipeline. `graphOf` is the shared entry
that `check` and `clones` call to build a graph. `src/map/query.ts` holds the functions that
read a written `dependency-graph.json`; `src/query/` calls them.

---

## 4. Analyzers and reporters (`src/depgraph/`)

This folder holds the analyzers, the reporters, the argument parser and the extension loader. The
map engine adapts its graph to the types in `types.ts` and calls these modules.

| File | Purpose | Main exports |
|---|---|---|
| `args.ts` | Parses the flags of `map`. Rejects the removed 1.x scan-scope flags. | `parseDepgraphArgs(argv, cwd, command?)`, `wantsHelp`, `SCAN_SCOPE_FLAGS`, `scanScopeText`, `MapCommand` |
| `analysis.ts` | Groups files into modules. Builds the dependency matrix. Finds reachable and unused code and the statistics. | `categorizeFiles`, `buildDependencyMatrix`, `findReachableFiles`, `computePublicSurface`, `detectUnused`, `generateStatistics`, `splitDormant` |
| `api-surface.ts` | Reads the exported names of a file, follows re-exports and builds the per-export facts report. | `extractExportDetails`, `extractReExports`, `resolveSurface`, `createTsResolver`, `buildApiSurfaceReport`, `maskNonCode`, `DEFAULT_STABILITY_TAGS` |
| `coverage.ts` | Tells which source files a test imports, with an optional policy file. | `analyzeTestCoverage`, `loadCoveragePolicy`, `classifyAgainstPolicy`, `buildCategoryBreakdown`, `buildReExportMap`, `traceReExports` |
| `cycles.ts` | Finds the runtime and type-only cyclic components. | `detectCyclicComponents`, `shortestCycleThrough`, `filesInCycles` |
| `description.ts` | Takes a one-line description of a file from its leading comment. | `extractDescription`, `cleanExportName`, `generateFallbackDescription` |
| `dirlist.ts` | Lists a folder in code-unit order and skips links. | `listNames`, `listEntries`, `isLink`, `isLinkEntry`, `isWalkable`, `readdirHook`, `linkLog` |
| `duplicates.ts` | Finds names that more than one file defines. Tags each one with a reason. Keeps the baseline of accepted duplicates. | `detectDuplicateSymbols`, `buildDuplicateReport`, `buildDuplicateBaseline`, `findNewDuplicates`, `loadDuplicateAllowlist`, `classifyDefiner`, `DEFAULT_DISPATCH_CALLS` |
| `exclude.ts` | The default list of folders that a walk skips. | `DEFAULT_EXCLUDE`, `TEST_DIR_NAMES`, `sourceTsFilesUnder` |
| `extensions.ts` | Loads and runs the repository extensions. | `loadExtensions`, `runHook`, `preflightContext`, `reportContext`, `readOnlyCopy`, `outputPath` |
| `paths.ts` | Path helpers that all use `/`. | `OUTPUT_SUBDIR`, `toPosix`, `relativePosix`, `maskRoot`, `srcDirOf`, `outputDirOf`, `withoutTsExtension`, `isSrcIndex` |
| `resolver.ts` | Resolves a relative specifier in the TypeScript style. | `resolvePath`, `resolveCandidates`, `targetOf`, `distToSrc`, `workspaceTarget`, `workspaceEntryPath`, `resolveWorkspaceSource` |
| `roots.ts` | Finds the entry roots from `package.json`, build configs, HTML files and launched scripts. | `collectEntryPoints`, `rootPackageEntries`, `packageEntryFiles`, `exportsSubpathEntries`, `configReferencedEntries`, `htmlReferencedEntries`, `runtimeLaunchedEntries`, `selfPackage` |
| `types.ts` | The shared types: `ParsedFile`, `Statistics`, `ModuleMap`, `UnusedAnalysis`, `CyclicComponents`, `PublicSurface`, `WorkspacePackage`. | Interfaces only |
| `workspaces.ts` | Reads npm workspace patterns and finds the packages. | `detectWorkspaces`, `readWorkspacePatterns`, `matchesWorkspaceGlob`, `negatedWorkspaceFolders` |

The reporters in `src/depgraph/reporters/` render the analysis results.

| File | Output |
|---|---|
| `banner.ts` | The first lines of each generated Markdown report. Exports `VERIFICATION_MARKER` (`<!-- repo-map:no-verification -->`), `bannerFor` and `withBanner`. |
| `json.ts` | The dependency graph JSON text and a compact summary. |
| `markdown.ts` | The Markdown dependency report, the Mermaid diagram and the summary table. Exports `summaryRowsOf(stats, labels)`. |
| `yaml.ts` | The YAML form of the JSON report. |
| `duplicates.ts` | The duplicate-symbols JSON and Markdown. |
| `coverage.ts` | The test-coverage JSON and Markdown. |
| `surfaces.ts` | The package export surfaces. |

Key declarations:

```ts
export function parseDepgraphArgs(argv: readonly string[], cwd: string, command?: MapCommand): DepgraphOptions
export function detectCyclicComponents(files: readonly ParsedFile[]): CyclicComponents
export async function loadExtensions(root: string, paths: readonly string[]): Promise<DepgraphExtension[]>
export async function runHook<H extends HookName>(extensions: readonly DepgraphExtension[], hook: H, ctx: H extends "report" ? ReportContext : PreflightContext): Promise<void>
export function collectEntryPoints(root: string, workspaces: Map<string, WorkspacePackage>, parsedFiles: ParsedFile[], rootEntries?: readonly string[]): string[]
export function detectDuplicateSymbols(files: ParsedFile[], publicSurface: PublicSurface, root: string, allowlistPath?: string, dispatchCalls?: readonly string[]): { runtime: /* … */, types: /* … */ }
export function generateYaml(json: object, dumpFn?: typeof dump): string
```

The extension contract has two optional hooks.

```ts
export interface DepgraphExtension {
  name: string;
  preflight?: (ctx: PreflightContext) => void | Promise<void>;
  report?: (ctx: ReportContext) => void | Promise<void>;
}
```

`PreflightContext` holds the absolute `root`, a frozen `config` and the `mask` functions.
`ReportContext` adds the frozen `graph` and a `write(relPath, text)` function. `write` refuses an
empty path, an absolute path and a path that leaves the output folder. A hook that throws, or
rejects, fails the run with exit code 1, and the error names the extension.

---

## 5. Check (`src/check/`)

The drift gate. It compares the Verification tables of Markdown documents with a fresh graph.

| File | Purpose |
|---|---|
| `index.ts` | The `check` subcommand: flags, folder read, output, exit code. |
| `claims.ts` | Finds the `## Verification` section and parses the claim rows. |
| `metrics.ts` | Builds a fresh graph and returns the measured values. |
| `verify.ts` | Compares the claims with the measured values. |

```ts
export const CHECK_HELP: string;
export async function run(argv: string[], io: Io): Promise<number>

export const NO_VERIFICATION_MARKER = VERIFICATION_MARKER;
export interface Claim {}  export interface Scan {}
export function scanVerification(markdown: string): Scan
export function parseClaims(markdown: string): Claim[]
export function hasVerificationSection(markdown: string): boolean

export async function collectMetrics(root: string, options: MetricsOptions = {}): Promise<Measured>

export type MetricValue = string | number | boolean;
export function verifyDocs(docs: readonly DocFile[], measured: Measured, markers: readonly string[] = [NO_VERIFICATION_MARKER]): Verdict
```

`collectMetrics` builds the graph with `graphOf`. It writes the four core reports into a scratch
folder. It reads these values:

- the scalar values of `metadata` and `statistics` from the dependency graph,
- `totalFiles` from the inventory,
- the `summary` values of the duplicate and unused reports.

A `finally` block removes the scratch folder. `verifyDocs` reports a problem in each of these cases:

- A document has no Verification section.
- A table has no row.
- A claim name is not a measured metric.
- A build warning made a metric unreliable.
- A value differs from the measured value.

A line that holds exactly the marker, with nothing else, skips the document.

---

## 6. Query (`src/query/`)

Questions about a written graph. The subcommand parses no source file. It reads
`dependency-graph.json` and `package-export-surfaces.json` from the report folder, and it refuses
a graph of schema 1.x.

| File | Purpose |
|---|---|
| `index.ts` | The `query` subcommand and its help. |
| `args.ts` | Parses the command, the options and the config merge. |
| `load.ts` | Reads the graph and the surfaces into `QueryInput`. |
| `graph.ts` | Builds the forward edges and the reverse edges. |
| `safety.ts` | Finds the files that use `node:` builtins and the browser-safe packages. |
| `commands.ts` | One function for each command. |

```ts
export async function run(argv: string[], io: Io): Promise<number>
export function parseQueryArgs(argv: readonly string[], cwd: string): QueryOptions
export function loadQueryInput(root: string, out: string): QueryInput
export function loadSurfaces(input: QueryInput): Record<string, string[]>
export function buildForward(fileEntries: readonly FilePair[], allFiles: ReadonlySet<string>): Map<string, Set<string>>
export function invert(forward: ReadonlyMap<string, ReadonlySet<string>>): Record<string, string[]>
export function computeTaint(forward: ReadonlyMap<string, ReadonlySet<string>>, fileEntries: readonly FilePair[]): { taint: Map<string, boolean>; direct: Map<string, boolean> }
export function browserSafePackages(files: Iterable<string>, nodeRuntimes: readonly string[]): string[]
export function findLeaks(pkg: string, forward: ReadonlyMap<string, ReadonlySet<string>>, direct: ReadonlyMap<string, boolean>): string[]

export function dependents(input: QueryInput, file: string, io: Io): number
export function symbolUsersCommand(input: QueryInput, symbol: string, io: Io): number
export function isPublic(input: QueryInput, pkg: string, symbol: string, io: Io): number
export function cycles(input: QueryInput, components: boolean, io: Io): number
export function nodeSafety(input: QueryInput, pkg: string | undefined, nodeRuntimes: readonly string[], io: Io): number
export function emit(input: QueryInput, nodeRuntimes: readonly string[], io: Io): number
export function checkBrowserSafety(input: QueryInput, nodeRuntimes: readonly string[], io: Io): number
```

A package is the folder above its `src/index.ts`. The package of the root `src/index.ts` is `.`.
`ROOT_PACKAGE` names it. A package that is not listed in `nodeRuntimes` is browser-safe.

---

## 7. Clones (`src/clones/`)

The copied-function finder. It reads a TypeScript or JavaScript repository and changes nothing.

| File | Purpose |
|---|---|
| `index.ts` | The `clones` subcommand and its help. |
| `settings.ts` | The defaults and the merge of flags, file and defaults. |
| `units.ts` | Finds the function units in a syntax tree. |
| `normalise.ts` | Turns a function body into a sequence of labels. |
| `detect.ts` | Finds exact groups and near pairs. |
| `report.ts` | Writes the inventory, the clones JSON and the summary text. |

```ts
export async function run(argv: string[], io: Io): Promise<number>
export type UnitKind = "function" | "local" | "method" | "ctor" | "get" | "set" | "field" | "prop";
export const DOC_LIMIT = 160;
export function unitsOf(root: Node, source: string, file: string, minNodes: number): Unit[]
export function normalise(body: Node): Normal
export function detect(units: readonly Unit[], params: DetectParams): Detection
export function inventoryJsonl(units: readonly Unit[]): string
export function clonesJson(config: ClonesConfig, detection: Detection): string
export function summaryText(config: ClonesConfig, stats: RunStats, units: readonly Unit[], detection: Detection): string
export function mergeClonesConfig(cli: ClonesSettings, file: ClonesSettings): ClonesConfig
export const CLONES_DEFAULTS: Readonly<ClonesConfig>
```

A unit is a named function with at least `minNodes` labels. A label is one node of the body with
names, literals, types and comments erased. Units with the same label sequence form an exact group.
Two units whose shingles overlap by enough, by the Jaccard score or by containment, form a near
pair. The command writes `inventory.jsonl` and `clones.json` only when `--out` or the config key
`clones.out` names a folder.

---

## 8. Docs (`src/docs/`)

The doc-comment tool. It measures coverage (`scan`), plans skeleton comments (`stub`) and gates
(`check`) for TypeScript, JavaScript and Python files.

| File | Purpose |
|---|---|
| `index.ts` | The `docs` subcommand: actions, flags, git path decoding. |
| `discovery.ts` | Finds the files. Reads `.code-docs.json`. Refuses a repository of another language. |
| `analyse.ts` | Runs the analyser that matches the file. |
| `typescript.ts` | Reads doc comments of TypeScript and JavaScript through tree-sitter. |
| `python.ts` | Reads docstrings of Python and detects the dialect. |
| `rules.ts` | Applies the MUST and SHOULD rules to one symbol. |
| `model.ts` | The types: `Kind`, `Tier`, `Issue`, `DocSymbol`, `FileReport`, `Stats`. |
| `stub.ts` | Plans and applies the skeleton comments. |
| `report.ts` | Writes `COVERAGE.md` and `coverage.json`. |

```ts
export async function run(argv: string[], io: Io): Promise<number>
export function unquoteGitPath(line: string): string
export const CONFIG_NAME = ".code-docs.json";
export class ConfigError extends Error
export class UnreadableRepoLanguage extends Error
export function discover(root: string): Discovery
export async function analyseFile(root: string, rel: string): Promise<FileReport>
export async function analyseRepo(root: string): Promise<RepoAnalysis>
export async function analyseTypeScript(path: string, source: string): Promise<FileReport>
export async function analysePython(path: string, source: string): Promise<FileReport>
export function applyRules(sym: DocSymbol, doc: string, path: string, options: RuleOptions): void
export const STUB_MARKER = "TODO:";
export function planPython(sym: DocSymbol, lines: string[]): Insertion | null
export function planTypeScript(sym: DocSymbol, lines: string[]): Insertion | null
export function applyInsertions(original: string, insertions: Insertion[], verify: (text: string) => boolean): Applied
export function summarise(reports: FileReport[]): Stats
export function writeOutputs(outDir: string, reports: FileReport[], stats: Stats, provenance: string, rootName: string): { markdown: string; json: string }
```

The MUST rules M1 to M5 decide the exit code of `check`. The SHOULD rules S2, S5 and S6 are
reported only. `applyInsertions` calls `verify` on the changed text. A file that would not parse
after the change is not written. The `docs` module imports `src/ste/prose.ts` for rule S6.

---

## 9. Ste (`src/ste/`)

The checker for the part of ASD-STE100 that a program can decide.

| File | Purpose |
|---|---|
| `index.ts` | The `ste` subcommand: Markdown mode and `--prose` mode. |
| `rules.ts` | The rule data: word limits, passive, ambiguous and wordy forms. |
| `markdown.ts` | Finds the checkable text in Markdown and applies the rules. |
| `prose.ts` | Applies the rules to docstring text. |
| `since.ts` | Limits findings to the lines that a git revision adds. |

```ts
export const HISTORICAL_MARKER = "<!-- ste:historical-record -->";
export async function run(argv: string[], io: Io): Promise<number>
export const MAX_WORDS_PROCEDURAL = 20;
export const MAX_WORDS_DESCRIPTIVE = 25;
export function rule(source: string, flags = ""): RegExp
export function stripIdentifiers(text: string): string
export function checkMarkdownFindings(name: string, text: string): Finding[]
export function checkMarkdown(name: string, text: string): string[]
export type ProseFinding = [rule: string, detail: string];
export function checkProse(text: string): ProseFinding[]
export function proseOf(doc: string): string
export class SinceError extends Error
export function addedLinesSince(file: string, rev: string): AddedLines
export function touchesAdded(added: AddedLines, first: number, last: number): boolean
```

A descriptive sentence has at most 25 words. A numbered step or a check box has at most 20. The
checker skips code fences, tables, headings, quotes, comments, front matter, inline code and
identifiers. A file with the historical marker in its first five lines is skipped and counted.

---

## 10. Chunk (`src/chunk/`)

Split a large file into chunks, and merge the chunks back.

| File | Purpose |
|---|---|
| `index.ts` | The `chunk` subcommand with `split`, `merge` and `status`. |
| `splitters.ts` | The splitters for Markdown, JSON and TypeScript, and the line-ending helpers. |
| `manifest.ts` | The manifest: hashes, source path checks and validation. |

```ts
export async function run(argv: string[], io: Io): Promise<number>
export type FileType = "markdown" | "json" | "typescript";
export const MANIFEST_VERSION = "2.0.0";
export const MANIFEST_NAME = "manifest.json";
export function contentHash(content: string): string
export function readManifest(path: string): Manifest
export function validateManifest(value: unknown): Manifest
export function writeManifest(path: string, manifest: Manifest): void
export function resolveSource(manifestDir: string, sourceFile: string): string
export function detectFileType(filePath: string): FileType
export function splitMarkdown(content: string, splitLevel: number): Section[]
export function splitJson(content: string): JsonSplit
export function mergeJson(chunks: string[], warn: (message: string) => void): string
export function splitTypeScript(content: string): Section[]
export function detectLineEnding(content: string): "lf" | "crlf" | "mixed"
export function lineBreakRuns(content: string): string
export function restoreLineBreaks(text: string, runs: string): { text: string; exact: boolean }
```

A merge of unchanged chunks gives the source file again, byte for byte. The manifest keeps the
line-break runs for that reason. `--yes` allows a source file outside the parent folder of the chunk
folder. `--allow-shrink` allows a result that is smaller than the file it replaces.

---

## 11. Compress (`src/compress/`)

A compact copy of a file for a model context.

| File | Purpose |
|---|---|
| `index.ts` | The `compress` subcommand: single and batch mode, restore. |
| `formats.ts` | The compressors, the format and level lists, the statistics. |
| `legend.ts` | The repeated-substring legend, the lossless number handling and the restore. |

```ts
export async function run(argv: string[], io: Io, deps: CompressDeps = defaultDeps): Promise<number>
export function findFiles(dir: string, pattern: string, recursive: boolean, deps?: CompressDeps): string[]
export const FORMATS: readonly string[];
export const LEVELS = ["light", "medium", "aggressive"] as const;
export type Compressor = (content: string, level: CompressionLevel) => CompressionResult;
export function detectFormat(filePath: string): FileFormat
export function getCompressor(format: FileFormat): Compressor
export function estimateTokens(text: string): number
export function calculateStats(original: string, compressed: string): CompressionStats
export function findRepeatedSubstrings(text: string, minLength: number, minOccurrences: number, maxSubstrings = 50): SubstringCandidate[]
export function applySubstringCompression(text: string, substrings: readonly SubstringCandidate[]): { compressed: string; legend: Record<string, string> }
export function parseLossless(text: string): unknown
export function assertNumbersKept(text: string): void
export function renameKeys(value: unknown, keyMap: ReadonlyMap<string, string>): unknown
export function decompress(content: string, format: FileFormat): string
export const JSON_ONLY_MESSAGE = "decompress supports JSON only in this version";
```

`CompressDeps` lets a test replace the file operations. The restore (`-d`) supports JSON only. The
JSON path keeps the text of each number, also a number that a JavaScript number cannot hold. The
two files `formats.ts` and `legend.ts` form the one runtime import cycle of the repository.

## Verification

Generated by `repo-tools map`.
Regenerate: `repo-tools map . --out=docs/architecture` · Check: `repo-tools check . --docs=docs/architecture`

| Claim | Value | Source |
|---|---|---|
| totalSourceFiles | 289 | dependency-graph.json |
| totalFunctions | 410 | dependency-graph.json |
| totalInterfaces | 140 | dependency-graph.json |
| totalClasses | 13 | dependency-graph.json |
| totalExports | 716 | dependency-graph.json |
| runtimeCircularDeps | 1 | dependency-graph.json |
