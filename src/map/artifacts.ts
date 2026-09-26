/**
 * The four core artifacts of the map engine: dependency-graph.json, file-inventory.json,
 * duplicate-symbols.json and unused-analysis.json. Ported from `repo_map/artifacts.py` of the
 * architecture-docs skill.
 *
 * Differences from the Python tool, each deliberate (the output rules of design note D1): no
 * `generated` date (R3); files end with one LF on every operating system (R1; the Python tool
 * writes CRLF on Windows); no warning holds an absolute path (R4); files, projects and workspace
 * folders are listed in code-unit order. The JSON text otherwise matches `json.dumps(indent=2)`:
 * every character above U+007F is written as a `\uXXXX` escape (`ensure_ascii`).
 */
import {
  type Dirent,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { B, reEscape, S, SPACE_BODY, W } from "../py.ts";
import { compareCodeUnits } from "../sort.ts";
import { stronglyConnectedComponents } from "./cycles.ts";
import { isReparsePoint, readSource } from "./discovery.ts";
import { type CycleLimits, findCycles } from "./graph.ts";
import { getResolver } from "./resolvers.ts";
import { type FileNode, type RepoGraph, toJson } from "./schema.ts";

/** The nine dispositions, pre-seeded at zero in `byDisposition`. */
const DISPOSITIONS = [
  "reachable",
  "build-entry",
  "test-only",
  "orphan",
  "test",
  "tool",
  "config",
  "bench",
  "example",
];
const SRC_REACHABLE = new Set(["reachable", "build-entry"]);
const SRC_DORMANT = new Set(["orphan", "test-only"]);

/** Python's `sorted` of strings. */
const pySorted = (items: Iterable<string>): string[] => [...items].sort(compareCodeUnits);

/** `json.dumps(data, indent=2)` with `ensure_ascii`: each UTF-16 unit above 0x7F is escaped. */
export function pyJsonDumps(data: unknown): string {
  const text = JSON.stringify(data, null, 2);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out += code > 0x7f ? `\\u${code.toString(16).padStart(4, "0")}` : (text[i] as string);
  }
  return out;
}

/** Writes `data` as JSON with one trailing LF, and returns the path. */
function writeJson(path: string, data: unknown): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${pyJsonDumps(data)}\n`);
  return path;
}

/** The identity of a cycle for the runtime vs type-only comparison. */
const cycleSignature = (cycle: string[]): string => pySorted(new Set(cycle)).join("->");

/**
 * The cyclic components (design decision D2, depgraph's fix F26): the strongly connected
 * components of the runtime edges, and the components of all edges that are not identical to a
 * runtime one, each with its number of distinct files. Never truncated.
 */
function cyclicComponentStats(graph: RepoGraph): Record<string, number> {
  const runtime = new Map<string, string[]>();
  const all = new Map<string, string[]>();
  for (const path of pySorted(graph.files.keys())) {
    const internal = (graph.files.get(path) as FileNode).internal.filter((d) =>
      graph.files.has(d.file),
    );
    all.set(path, pySorted(new Set(internal.map((d) => d.file))));
    runtime.set(path, pySorted(new Set(internal.filter((d) => !d.typeOnly).map((d) => d.file))));
  }
  const runtimeSccs = stronglyConnectedComponents(runtime);
  const key = (c: string[]): string => c.join("\n");
  const runtimeKeys = new Set(runtimeSccs.map(key));
  const typeOnlySccs = stronglyConnectedComponents(all).filter((c) => !runtimeKeys.has(key(c)));
  const files = (sccs: string[][]): number => new Set(sccs.flat()).size;
  return {
    runtimeCyclicComponents: runtimeSccs.length,
    typeOnlyCyclicComponents: typeOnlySccs.length,
    runtimeFilesInCycles: files(runtimeSccs),
    typeOnlyFilesInCycles: files(typeOnlySccs),
  };
}

/**
 * depgraph's per-kind export counts (design decision D2), for a TypeScript repo only. The kinds
 * come from the core reader. A type guard is an exported function whose name starts with `is`,
 * as depgraph counts it. A default export is in no kind, as in depgraph.
 */
function exportKindStats(graph: RepoGraph): Record<string, number> {
  const count = { class: 0, interface: 0, function: 0, typeGuard: 0, enum: 0, const: 0 };
  let reExports = 0;
  for (const node of graph.files.values()) {
    for (const [name, kind] of Object.entries(node.exportKinds ?? {})) {
      if (name === "default") continue;
      if (kind === "function" && name.startsWith("is")) count.typeGuard += 1;
      if (kind in count) count[kind as keyof typeof count] += 1;
    }
    reExports += new Set(node.reExports ?? []).size;
  }
  return {
    totalClasses: count.class,
    totalInterfaces: count.interface,
    totalFunctions: count.function,
    totalTypeGuards: count.typeGuard,
    totalEnums: count.enum,
    totalConstants: count.const,
    totalReExports: reExports,
  };
}

/** The options of `emitDependencyGraph`. */
export interface DependencyGraphOptions {
  cycleLimits?: CycleLimits;
}

/** Writes dependency-graph.json: the graph, reachability, cycle counts and the unused counts. */
export function emitDependencyGraph(
  graph: RepoGraph,
  outDir: string,
  options: DependencyGraphOptions = {},
): string {
  const data = toJson(graph);
  const nodes = [...graph.files.values()];
  const orphaned = pySorted(nodes.filter((n) => n.disposition === "orphan").map((n) => n.path));
  const testOnly = pySorted(nodes.filter((n) => n.disposition === "test-only").map((n) => n.path));
  const reachableCount = nodes.filter((n) => SRC_REACHABLE.has(n.disposition)).length;
  const dormantCount = nodes.filter((n) => SRC_DORMANT.has(n.disposition)).length;
  data.reachability = { roots: [...graph.roots], reachableCount, dormantCount, orphaned, testOnly };

  const all = findCycles(graph, options.cycleLimits);
  const runtimeFiles = new Map<string, FileNode>();
  for (const [p, n] of graph.files)
    runtimeFiles.set(p, { ...n, internal: n.internal.filter((d) => !d.typeOnly) });
  // The runtime subgraph shares the warnings list, as the Python dataclass `replace` does.
  const runtime = findCycles({ ...graph, files: runtimeFiles }, options.cycleLimits);
  const runtimeSigs = new Set(runtime.cycles.map(cycleSignature));
  const typeOnlyCount = all.cycles.filter((c) => !runtimeSigs.has(cycleSignature(c))).length;
  const totalTypeOnlyImports = nodes.reduce(
    (sum, n) => sum + n.internal.filter((d) => d.typeOnly).length,
    0,
  );

  Object.assign(data.statistics, {
    entryRoots: graph.roots.length,
    reachableFiles: reachableCount,
    dormantFiles: dormantCount,
    orphanedFiles: orphaned.length,
    testOnlyFiles: testOnly.length,
    runtimeCircularDeps: runtime.cycles.length,
    typeOnlyCircularDeps: typeOnlyCount,
    totalTypeOnlyImports,
    noImporterFileCount: noImporterFiles(graph).length,
    unusedExportsCount: unusedExportTotal(graph),
    circularDepsTruncated: all.truncated || runtime.truncated,
    ...cyclicComponentStats(graph),
    ...(graph.language === "typescript" ? exportKindStats(graph) : {}),
  });
  data.warnings = [...graph.warnings];
  return writeJson(join(outDir, "dependency-graph.json"), data);
}

/** A JSON file, or null when it cannot be read or parsed. */
function readJson(path: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)));
  } catch {
    return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** One `- 'dir/*'` item: Python's MULTILINE `^` and `$` as a line-start and a line-end lookaround. */
const PNPM_ITEM = new RegExp(
  `(?<=^|\\n)${S}*-${S}*['"]?([^'"${SPACE_BODY}#]+)['"]?${S}*(?=\\n|(?![\\s\\S]))`,
  "gu",
);

/** The package-folder globs of pnpm-workspace.yaml's `packages:` list (a narrow regex read). */
function pnpmWorkspacePatterns(root: string): string[] {
  let text: string;
  try {
    text = readSource(join(root, "pnpm-workspace.yaml")).replace(/\r\n?/g, "\n");
  } catch {
    return [];
  }
  return [...text.matchAll(PNPM_ITEM)].map((m) => m[1] as string);
}

/** package.json `workspaces` as a pattern list (array or Yarn object form), or null. */
function normalizeWorkspacePatterns(raw: unknown): [string[] | null, string[]] {
  if (raw === undefined || raw === null) return [null, []];
  if (Array.isArray(raw)) return [raw as string[], []];
  if (isObject(raw)) {
    if (Array.isArray(raw.packages)) return [raw.packages as string[], []];
    return [
      null,
      [
        "emit_file_inventory: package.json 'workspaces' at the root is an object without a " +
          "'packages' list (Yarn's {packages: [...], nohoist: [...]} form expected) -- ignored, " +
          "falling back to pnpm-workspace.yaml / single-package mode",
      ],
    ];
  }
  const typeName =
    typeof raw === "string"
      ? "str"
      : typeof raw === "number"
        ? Number.isInteger(raw)
          ? "int"
          : "float"
        : typeof raw === "boolean"
          ? "bool"
          : typeof raw;
  return [
    null,
    [
      `emit_file_inventory: package.json 'workspaces' at the root is neither a list nor an object (got ${typeName}) -- ignored, falling back to pnpm-workspace.yaml / single-package mode`,
    ],
  ];
}

/** Every `.csproj` below `root` as path parts, in code-unit order; linked folders are not followed. */
function csprojParts(root: string): string[][] {
  const found: string[][] = [];
  const go = (dir: string, parts: string[]): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory() && !isReparsePoint(full)) go(full, [...parts, e.name]);
      else if (e.name.endsWith(".csproj")) found.push([...parts, e.name]);
    }
  };
  go(root, []);
  return found.sort((a, b) => compareCodeUnits(a.join("/"), b.join("/")));
}

/** C#: project name -> project folder. */
function csprojMap(root: string): [Map<string, string>, string[]] {
  const projects = new Map<string, string>();
  for (const parts of csprojParts(root)) {
    if (parts.some((p) => p === "obj" || p === "bin")) continue;
    const name = parts.at(-1) as string;
    projects.set(name.slice(0, name.length - ".csproj".length), parts.slice(0, -1).join("/"));
  }
  if (projects.size === 0) {
    return [
      new Map(),
      [
        "emit_file_inventory: no .csproj found under the root -- project derivation skipped, every file reports '(root)'",
      ],
    ];
  }
  return [projects, []];
}

/** The sub-folders of `dir`, in code-unit order. */
function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (e) => e.isDirectory() || (e.isSymbolicLink() && statSync(join(dir, e.name)).isDirectory()),
      )
      .map((e) => e.name)
      .sort(compareCodeUnits);
  } catch {
    return [];
  }
}

/** Node: package name -> package folder ('' for the single root package). */
function workspaceMap(root: string): [Map<string, string>, string[]] {
  const pkg = readJson(join(root, "package.json"));
  if (!isObject(pkg)) {
    return [
      new Map(),
      [
        "emit_file_inventory: no readable package.json at the root -- package derivation skipped, every file reports '(root)'",
      ],
    ];
  }
  let [patterns, warnings] = normalizeWorkspacePatterns(pkg.workspaces);
  if (patterns === null) patterns = pnpmWorkspacePatterns(root);
  if (patterns.length === 0) {
    const name = pkg.name;
    if (typeof name === "string" && name !== "") return [new Map([[name, ""]]), warnings];
    return [
      new Map(),
      [
        ...warnings,
        "emit_file_inventory: package.json at the root has no 'name' and no usable 'workspaces' -- package derivation skipped, every file reports '(root)'",
      ],
    ];
  }
  const workspaces = new Map<string, string>();
  warnings = [...warnings];
  for (const pattern of patterns) {
    if (typeof pattern !== "string") continue;
    let candidates: string[];
    if (pattern.endsWith("/*")) {
      const parent = pattern.slice(0, -2);
      let isDir = false;
      try {
        isDir = statSync(join(root, parent)).isDirectory();
      } catch {
        isDir = false;
      }
      if (!isDir) continue;
      candidates = subdirs(join(root, parent)).map((d) => (parent ? `${parent}/${d}` : d));
    } else {
      candidates = [pattern];
    }
    for (const relCand of candidates) {
      const sub = readJson(join(root, relCand, "package.json"));
      if (!isObject(sub)) {
        warnings.push(
          `emit_file_inventory: workspace candidate '${relCand}' (matched by '${pattern}') has no readable package.json -- skipped, its files will report package '(root)'`,
        );
        continue;
      }
      const name = sub.name;
      if (typeof name !== "string" || name === "") {
        warnings.push(
          `emit_file_inventory: workspace candidate '${relCand}' (matched by '${pattern}') has a package.json with no 'name' -- skipped, its files will report package '(root)'`,
        );
        continue;
      }
      workspaces.set(name, relCand);
    }
  }
  return [workspaces, warnings];
}

/** The package of a file: the longest workspace folder that holds it; '(root)' otherwise. */
function packageOf(rel: string, map: ReadonlyMap<string, string>): string {
  let bestName = "(root)";
  let bestLen = -1;
  for (const [name, directory] of map) {
    let length: number;
    if (directory && rel.startsWith(`${directory}/`)) length = directory.length;
    else if (!directory && rel.startsWith("src/")) length = 0;
    else continue;
    if (length > bestLen) {
      bestName = name;
      bestLen = length;
    }
  }
  return bestName;
}

/** Python's `dict(Counter(values))`: counts in order of first appearance. */
function counter(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

/** Writes file-inventory.json: each file with its package, area, disposition and lines. */
export function emitFileInventory(graph: RepoGraph, outDir: string): string {
  let map: Map<string, string>;
  let warnings: string[];
  if (graph.rootPath !== null) {
    [map, warnings] =
      graph.language === "csharp" ? csprojMap(graph.rootPath) : workspaceMap(graph.rootPath);
  } else {
    map = new Map();
    warnings = [
      "emit_file_inventory: RepoGraph.root_path is None (hand-built graph, or build_graph wasn't used to construct it) -- package derivation skipped, every file reports '(root)'",
    ];
  }
  graph.warnings.push(...warnings);
  const files = [...graph.files.values()]
    .sort((a, b) => compareCodeUnits(a.path, b.path))
    .map((n) => ({
      file: n.path,
      package: packageOf(n.path, map),
      area: n.area,
      disposition: n.disposition,
      loc: n.loc,
    }));
  const byDisposition: Record<string, number> = Object.fromEntries(DISPOSITIONS.map((d) => [d, 0]));
  Object.assign(byDisposition, counter(files.map((f) => f.disposition)));
  return writeJson(join(outDir, "file-inventory.json"), {
    totalFiles: files.length,
    byDisposition,
    byArea: counter(files.map((f) => f.area)),
    files,
    warnings: [...graph.warnings],
  });
}

const UNUSED_CAVEATS = [
  "Dynamic `import(...)` expressions and runtime module loads (e.g. `new Worker(path)`) are invisible to this analysis -- the parser only walks static `import ... from ...` statements, so a file or export reached ONLY through one of those is reported as no-importer/unreferenced even though it is genuinely live. Confirmed on the real memoryjs corpus: src/cli/commands/check.ts, .../inspect.ts, and src/cli/interactive.ts itself are all consumed exclusively via `await import(...)` inside interactive.ts.",
  "`noImporterFiles` is NOT a deletion-candidate list. A file with zero in-repo importers is expected, not suspicious, for: a standalone script invoked directly (e.g. a smoketest run via `node script.mjs`, never `import`ed by anything), or a build/lint config file loaded by its own tool rather than by source code (e.g. `eslint.config.mjs`, read by eslint itself). Cross-check against package.json scripts / tool configs before treating any entry here as dead.",
  "Only NAMED exports are analysed (`FileNode.exports` carries named exports only) -- `export default` usage is not checked here.",
  "The `referencedInModule` vs `unreferencedAnywhere` split for exports is a TEXT-LEVEL heuristic (whole-identifier occurrence count within the defining file's own source, minus the declaration site itself), not an AST reference count -- it can over-count a name that also appears in a string literal or comment. When the source text can't be read at all (no `RepoGraph.root_path`, or the file is missing) the export lands in `unclassifiedExports` instead of being guessed into either bucket.",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the caveat quotes a template literal; the text is an exact copy.
  "`unreferencedAnywhereNotes`'s dynamic-import check (`_dynamic_import_referrers`) only sees `import(...)` calls with a LITERAL string specifier. A dynamic import built from a variable or template literal (e.g. `import(`./cmds/${name}.js`)`, a command-dispatcher pattern) is invisible to it -- 'found none' in a note means no LITERAL match was found, NOT that nothing imports the file.",
];

/** Whether an import in each language names the symbols it brings in (C# `using` does not). */
const IMPORTS_NAME_SYMBOLS: Readonly<Record<string, boolean>> = {
  typescript: true,
  python: true,
  csharp: false,
  rust: true,
};
/** Languages whose public surface is consumed outside the repository. */
const PUBLIC_API_LANGUAGES = new Set(["rust"]);

const PUBLIC_API_CAVEAT =
  "A `pub` item with no user inside this crate is normally PUBLIC API, not dead code. `unused-analysis` can only see this repository, and a library crate's public surface exists for DOWNSTREAM consumers that are not in the graph -- so 'no importer here' is the expected state for most public items, not a finding. Measured on one real crate: 2,635 of 2,739 exports (96%) had no in-crate user, and essentially all of them were live API. Treat this list as 'candidates to check against the crate's intended surface', never as a deletion list.";

const NAMESPACE_IMPORT_CAVEAT =
  "This language's imports name a namespace, not the symbols they bring in (C#'s `using App.Hosting;`), so per-symbol usage cannot be read off the import edges at all. Usage here is a whole-identifier text search across every scanned file instead -- the same class of TEXT-LEVEL heuristic as the `referencedInModule` split above, and subject to the same limit: a name appearing in another file's comment or string literal counts as a use. That makes this direction conservative -- it UNDER-reports dead code rather than inventing it -- which is the safe direction for a list whose entries read as deletion candidates. A type reached only by reflection (`Activator.CreateInstance`, DI-by-convention) or named solely in a .csproj/XAML file is invisible either way.";

const IDENTIFIER = new RegExp(`${B}[A-Za-z_]${W}*`, "gu");

/** The source of a file of the graph, or null when there is no root or the file cannot be read. */
function readSourceText(rootPath: string | null, rel: string): string | null {
  if (rootPath === null) return null;
  try {
    return readSource(join(rootPath, rel)).replace(/\r\n?/g, "\n");
  } catch {
    return null;
  }
}

/** identifier -> every path whose source names it as a whole word (for namespace imports). */
function identifierUsers(graph: RepoGraph): Map<string, Set<string>> {
  const users = new Map<string, Set<string>>();
  for (const path of pySorted(graph.files.keys())) {
    const text = readSourceText(graph.rootPath, path);
    if (text === null) continue;
    for (const m of new Set([...text.matchAll(IDENTIFIER)].map((x) => x[0]))) {
      const set = users.get(m) ?? new Set<string>();
      set.add(path);
      users.set(m, set);
    }
  }
  return users;
}

/** The caveats that apply to this graph's language. */
function caveatsFor(graph: RepoGraph): string[] {
  const caveats = [...UNUSED_CAVEATS];
  if (!(IMPORTS_NAME_SYMBOLS[graph.language] ?? true)) caveats.push(NAMESPACE_IMPORT_CAVEAT);
  if (PUBLIC_API_LANGUAGES.has(graph.language)) caveats.push(PUBLIC_API_CAVEAT);
  return caveats;
}

/** The names a file declares itself: its exports without pass-through named re-exports. */
function ownExports(node: FileNode): Set<string> {
  const reexported = new Set(node.internal.flatMap((d) => d.imports));
  return new Set(node.exports.filter((s) => !reexported.has(s)));
}

/** path -> the names that other files' edges into it carry. */
function importedNamesByFile(graph: RepoGraph): Map<string, Set<string>> {
  const imported = new Map<string, Set<string>>();
  for (const node of graph.files.values()) {
    for (const d of node.internal) {
      const set = imported.get(d.file) ?? new Set<string>();
      for (const name of d.imports) set.add(name);
      imported.set(d.file, set);
    }
  }
  return imported;
}

/** The `src` files with no in-repo importer, except the roots (in-degree, not BFS). */
function noImporterFiles(graph: RepoGraph): string[] {
  const targets = new Set([...graph.files.values()].flatMap((n) => n.internal.map((d) => d.file)));
  const roots = new Set(graph.roots);
  return pySorted(
    [...graph.files]
      .filter(([p, n]) => n.area === "src" && !targets.has(p) && !roots.has(p))
      .map(([p]) => p),
  );
}

/** Whole-identifier occurrences of `name` in `text`, minus the declaration itself. */
function inModuleReferenceCount(text: string, name: string): number {
  const total = [...text.matchAll(new RegExp(`${B}${reEscape(name)}${B}`, "gu"))].length;
  return Math.max(total - 1, 0);
}

type Buckets = [Record<string, string[]>, Record<string, string[]>, Record<string, string[]>];

/** The unused own exports of each `src` file: unreferenced anywhere, referenced in module, unclassified. */
function classifyUnusedExports(graph: RepoGraph): Buckets {
  const imported = importedNamesByFile(graph);
  const unreferenced: Record<string, string[]> = {};
  const referencedInModule: Record<string, string[]> = {};
  const unclassified: Record<string, string[]> = {};
  const namesSymbols = IMPORTS_NAME_SYMBOLS[graph.language] ?? true;
  const users = namesSymbols ? new Map<string, Set<string>>() : identifierUsers(graph);
  const push = (bucket: Record<string, string[]>, path: string, name: string) => {
    const list = bucket[path] ?? [];
    list.push(name);
    bucket[path] = list;
  };
  for (const node of [...graph.files.values()].sort((a, b) => compareCodeUnits(a.path, b.path))) {
    if (node.area !== "src") continue;
    const own = ownExports(node);
    const missing = pySorted(
      [...own].filter((s) => {
        if (namesSymbols) return !(imported.get(node.path)?.has(s) ?? false);
        const others = new Set(users.get(s) ?? []);
        others.delete(node.path);
        return others.size === 0;
      }),
    );
    if (missing.length === 0) continue;
    const text = readSourceText(graph.rootPath, node.path);
    for (const name of missing) {
      if (text === null) push(unclassified, node.path, name);
      else if (inModuleReferenceCount(text, name) > 0) push(referencedInModule, node.path, name);
      else push(unreferenced, node.path, name);
    }
  }
  return [unreferenced, referencedInModule, unclassified];
}

const countAll = (bucket: Record<string, string[]>) =>
  Object.values(bucket).reduce((s, v) => s + v.length, 0);

/** The flagged exports across all three buckets (shared by two artifacts, so they agree). */
function unusedExportTotal(graph: RepoGraph): number {
  return classifyUnusedExports(graph).reduce((s, b) => s + countAll(b), 0);
}

const DYNAMIC_IMPORT = new RegExp(`${B}import${S}*\\(${S}*(['"\`])((?:(?!\\1)[^\\n])+)\\1`, "gu");

/** target path -> the first file (in path order) with a literal dynamic import() that resolves to it. */
function dynamicImportReferrers(graph: RepoGraph): Map<string, string> {
  const referrers = new Map<string, string>();
  if (graph.rootPath === null) return referrers;
  const resolver = getResolver("typescript");
  const known = new Set(graph.files.keys());
  for (const path of pySorted(graph.files.keys())) {
    const text = readSourceText(graph.rootPath, path);
    if (text === null) continue;
    for (const m of text.matchAll(DYNAMIC_IMPORT)) {
      const spec = m[2] as string;
      if (resolver.classifySpecifier(spec) !== "relative") continue;
      const target = resolver.resolve(spec, path, known);
      if (target !== null && !referrers.has(target)) referrers.set(target, path);
    }
  }
  return referrers;
}

/** path -> symbol -> why this deletion candidate might still be a false positive. */
function unreferencedAnywhereNotes(
  graph: RepoGraph,
  unreferenced: Record<string, string[]>,
): Record<string, Record<string, string>> {
  const referrers = dynamicImportReferrers(graph);
  const notes: Record<string, Record<string, string>> = {};
  for (const path of pySorted(Object.keys(unreferenced))) {
    const referrer = referrers.get(path);
    for (const name of unreferenced[path] ?? []) {
      const note =
        referrer !== undefined
          ? `Verified: '${referrer}' contains a dynamic import() call that resolves to '${path}' -- this stage's static parser cannot see dynamic import(), so '${name}' may genuinely be consumed there even though nothing else references it. Check '${referrer}' before deleting.`
          : `Checked for a dynamic import() call with a LITERAL string specifier resolving to '${path}' across the whole repo and found none. This scan can only see import() calls with a literal string specifier -- a dynamic import built from a variable or template literal (e.g. import(\`./cmds/\${name}.js\`)) is invisible to it, so 'found none' means no LITERAL match was found, NOT that nothing imports this. '${name}' may still be consumed via such a call. Also verify against consumption this scan cannot see at all (docs examples, published API surface, a runtime-built path/\`new Worker(...)\`) before deleting.`;
      const byName = notes[path] ?? {};
      byName[name] = note;
      notes[path] = byName;
    }
  }
  return notes;
}

/** Writes duplicate-symbols.json: names that two or more `src` files declare themselves. */
export function emitDuplicateSymbols(graph: RepoGraph, outDir: string): string {
  const owners = new Map<string, string[]>();
  for (const node of [...graph.files.values()].sort((a, b) => compareCodeUnits(a.path, b.path))) {
    if (node.area !== "src") continue;
    for (const sym of ownExports(node)) {
      const list = owners.get(sym) ?? [];
      list.push(node.path);
      owners.set(sym, list);
    }
  }
  const duplicates: Record<string, string[]> = {};
  for (const sym of pySorted(owners.keys())) {
    const paths = owners.get(sym) as string[];
    if (paths.length > 1) duplicates[sym] = paths;
  }
  return writeJson(join(outDir, "duplicate-symbols.json"), {
    note: "Groups names OWN-exported by >=2 'src' files, by name only. Unlike CDG's create-dependency-graph.ts, this does NOT classify entries (TRUE_DUPLICATE / ALIAS_DELEGATION / ALLOWLISTED) or attach a category/public flag -- that needs AST body comparison this stage's flat export-name list does not carry. Every name below is a candidate for human triage, not a pre-sorted verdict.",
    summary: { duplicateCount: Object.keys(duplicates).length, totalSymbols: owners.size },
    duplicates,
  });
}

/** Writes unused-analysis.json: the three export buckets, the notes, and the no-importer files. */
export function emitUnusedAnalysis(graph: RepoGraph, outDir: string): string {
  const [unreferenced, referencedInModule, unclassified] = classifyUnusedExports(graph);
  const notes = unreferencedAnywhereNotes(graph, unreferenced);
  const noImporter = noImporterFiles(graph);
  return writeJson(join(outDir, "unused-analysis.json"), {
    caveats: caveatsFor(graph),
    summary: {
      unusedExportCount:
        countAll(unreferenced) + countAll(referencedInModule) + countAll(unclassified),
      unreferencedAnywhereCount: countAll(unreferenced),
      referencedInModuleCount: countAll(referencedInModule),
      unclassifiedExportCount: countAll(unclassified),
      noImporterFileCount: noImporter.length,
    },
    unreferencedAnywhere: unreferenced,
    unreferencedAnywhereNotes: notes,
    referencedInModule,
    unclassifiedExports: unclassified,
    noImporterFiles: noImporter,
  });
}

/** The name of a written artifact (for messages). */
export const artifactName = (path: string): string => basename(path);
