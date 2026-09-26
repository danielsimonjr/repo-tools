/**
 * Graph assembly for the map engine: discovery, reading and resolution joined into a `RepoGraph`,
 * then refined with barrel `export *` expansion and reachability-driven dispositions. Ported from
 * `repo_map/graph.py` of the architecture-docs skill.
 *
 * Differences from the Python tool, each deliberate: the language is detected once (the Python
 * tool walks the tree three times for the same answer); no warning holds an absolute path (output
 * rule R4); `.csproj` files are found in code-unit order; a TOML parse-error message has the words
 * of the TOML parser in use.
 */
import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { resolveWorkspaceSource, workspaceTarget } from "../depgraph/resolver.ts";
import { selfPackage } from "../depgraph/roots.ts";
import type { WorkspacePackage } from "../depgraph/types.ts";
import { detectWorkspaces } from "../depgraph/workspaces.ts";
import { B, pyRepr, S, SPACE_BODY, W } from "../py.ts";
import { compareCodeUnits } from "../sort.ts";
import { type CycleLimits, type CycleResult, simpleCycles } from "./cycles.ts";
import {
  detectLanguage,
  discover,
  dispositionForArea,
  isReparsePoint,
  type Language,
  readSource,
} from "./discovery.ts";
import { loadGrammar } from "./grammars.ts";
import { type ParsedModule, parseCs, parsePy, parseRs, parseTs } from "./parsing.ts";
import { getResolver } from "./resolvers.ts";
import { type Dependency, type FileNode, newRepoGraph, type RepoGraph } from "./schema.ts";

const SOURCE_SUFFIXES = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
/** Longest first, so "index.d.ts" strips as one unit. */
const BUILD_OUTPUT_EXTS = [".d.cts", ".d.ts", ".cjs", ".mjs", ".jsx", ".tsx", ".js", ".ts"];
const BUILD_DIRS = ["dist", "build", "lib"];
const FALLBACK_ROOTS = ["src/index.ts", "src/index.tsx", "src/index.js", "index.ts", "index.js"];

const BARE_STAR = new RegExp(`export${S}*\\*${S}*from${S}*['"]([^'"]+)['"]`, "gu");

/** The specifiers that a file re-exports with a bare `export * from` (a text-level check). */
function bareStarSpecifiers(source: string): Set<string> {
  return new Set([...source.matchAll(BARE_STAR)].map((m) => m[1] as string));
}

/** Python's `sorted` of strings: code-point order. */
const pySorted = (items: Iterable<string>): string[] => [...items].sort(compareCodeUnits);

/**
 * The source file behind a build-output path (`dist/core/index.js` -> `src/core/index.ts`), or
 * null. Both rootDir conventions are tried: `dist/x.js` and `dist/src/x.js`.
 */
export function mapDistToSrc(path: string, known: ReadonlySet<string>): string | null {
  let posix = path.replaceAll("\\", "/");
  if (posix.startsWith("./")) posix = posix.slice(2);
  const slash = posix.indexOf("/");
  const first = slash === -1 ? posix : posix.slice(0, slash);
  const rest = slash !== -1 && BUILD_DIRS.includes(first) ? posix.slice(slash + 1) : posix;
  let stem = rest;
  for (const ext of BUILD_OUTPUT_EXTS) {
    if (stem.endsWith(ext)) {
      stem = stem.slice(0, -ext.length);
      break;
    }
  }
  const stems = [stem];
  if (stem.startsWith("src/")) stems.push(stem.slice("src/".length));
  for (const s of stems) {
    for (const suffix of SOURCE_SUFFIXES)
      if (known.has(`src/${s}${suffix}`)) return `src/${s}${suffix}`;
  }
  for (const s of stems) {
    for (const suffix of SOURCE_SUFFIXES) {
      if (known.has(`src/${s}/index${suffix}`)) return `src/${s}/index${suffix}`;
    }
  }
  return null;
}

const LAUNCHER_MAX_BYTES = 8192;
const STRING_LITERAL = /['"]([^'"\n]*)['"]/g;
const PATH_SEGMENT = new RegExp(`^(?:${W}|[.-])+$`, "u");

/** Python `str.lstrip("./")`. */
const lstripDotSlash = (text: string): string => text.replace(/^[./]+/, "");

/**
 * The source entry behind a thin launcher: a small declared entry that loads the build output
 * through a path built at run time (`join(here, '..', 'dist', 'cli', 'main.js')`). Only files of
 * at most 8 KiB are read, and null is the answer when nothing matches.
 */
function launcherEntry(root: string, spec: string, known: ReadonlySet<string>): string | null {
  const path = join(root, lstripDotSlash(spec.replaceAll("\\", "/")));
  let text: string;
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > LAUNCHER_MAX_BYTES) return null;
    text = readSource(path);
  } catch {
    return null;
  }
  const literals = [...text.matchAll(STRING_LITERAL)].map((m) => m[1] as string);
  for (const lit of literals) {
    const trimmed = lstripDotSlash(lit.replaceAll("\\", "/"));
    if (BUILD_DIRS.some((d) => trimmed.startsWith(`${d}/`))) {
      const mapped = mapDistToSrc(trimmed, known);
      if (mapped !== null) return mapped;
    }
  }
  for (let i = 0; i < literals.length; i++) {
    const lit = literals[i] as string;
    if (!BUILD_DIRS.includes(lit)) continue;
    const segments = [lit];
    for (const next of literals.slice(i + 1)) {
      if (!PATH_SEGMENT.test(next) || next === "." || next === "..") break;
      segments.push(next);
      if (BUILD_OUTPUT_EXTS.some((ext) => next.endsWith(ext))) break;
    }
    const mapped = mapDistToSrc(segments.join("/"), known);
    if (mapped !== null) return mapped;
  }
  return null;
}

/** A plain JSON object. */
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The entry points that package.json declares, mapped to source files, with a warning per miss. */
function packageJsonRoots(root: string, known: ReadonlySet<string>): [string[], string[]] {
  let pkg: unknown;
  try {
    pkg = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(join(root, "package.json"))),
    );
  } catch {
    return [[], []];
  }
  if (!isObject(pkg)) return [[], []];
  const raw: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string") raw.push(value);
    else if (isObject(value)) for (const v of Object.values(value)) collect(v);
  };
  for (const key of ["main", "module", "bin"]) collect(pkg[key]);
  collect(pkg.exports);
  const roots: string[] = [];
  const warnings: string[] = [];
  for (const spec of raw) {
    if (spec.endsWith(".json")) continue;
    const mapped = mapDistToSrc(spec, known) ?? launcherEntry(root, spec, known);
    if (mapped === null) {
      warnings.push(
        `package.json entry ${pyRepr(spec)} did not resolve to a known source file under src/ -- ` +
          "ignored; if no other declared entry resolves either, the entry-point root falls back to " +
          "a conventional src/index.* file instead",
      );
      continue;
    }
    if (!roots.includes(mapped)) roots.push(mapped);
  }
  return [roots, warnings];
}

/** Rust: every crate root (lib.rs, main.rs, and each src/bin/*.rs). */
function rustRoots(known: ReadonlySet<string>): [string[], string[]] {
  const roots = pySorted(
    [...known].filter(
      (p) =>
        p.endsWith("/lib.rs") ||
        p.endsWith("/main.rs") ||
        p === "src/lib.rs" ||
        p === "src/main.rs" ||
        (p.includes("/bin/") && p.endsWith(".rs")),
    ),
  );
  return [roots, []];
}

const PYTHON_FALLBACK_ROOTS = [
  "server.py",
  "main.py",
  "app.py",
  "__main__.py",
  "src/main.py",
  "src/server.py",
  "src/__main__.py",
];

/** Python: `[project.scripts]` / `[project.gui-scripts]` of pyproject.toml, then conventional names. */
function pythonRoots(root: string, known: ReadonlySet<string>): [string[], string[]] {
  const warnings: string[] = [];
  const pyproject = join(root, "pyproject.toml");
  let isFile = false;
  try {
    isFile = statSync(pyproject).isFile();
  } catch {
    isFile = false;
  }
  if (isFile) {
    let data: Record<string, unknown> = {};
    try {
      data = parseToml(readSource(pyproject).replace(/\r\n?/g, "\n")) as Record<string, unknown>;
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
      warnings.push(
        `could not parse pyproject.toml (${message}); falling back to conventional entry points`,
      );
      data = {};
    }
    const project = isObject(data.project) ? data.project : {};
    const scripts = new Map<string, unknown>();
    for (const table of ["scripts", "gui-scripts"]) {
      const entry = project[table];
      if (isObject(entry)) for (const [k, v] of Object.entries(entry)) scripts.set(k, v);
    }
    const resolved: string[] = [];
    for (const target of scripts.values()) {
      if (typeof target !== "string") continue;
      const parts = (target.split(":")[0] as string).split(".");
      for (const candidate of [`${parts.join("/")}.py`, [...parts, "__init__.py"].join("/")]) {
        if (known.has(candidate) && !resolved.includes(candidate)) {
          resolved.push(candidate);
          break;
        }
      }
    }
    if (resolved.length > 0) return [resolved, warnings];
    if (scripts.size > 0) {
      warnings.push(
        "pyproject.toml declares [project.scripts] but none resolved to a known source file; " +
          "falling back to conventional entry points",
      );
    }
  }
  for (const cand of PYTHON_FALLBACK_ROOTS) if (known.has(cand)) return [[cand], warnings];
  return [[], warnings];
}

const CSHARP_MAIN = new RegExp(
  `${B}static${S}+(?:async${S}+)?[^${SPACE_BODY}(){};]+${S}+Main${S}*\\(`,
  "u",
);
const CSPROJ_EXE = new RegExp(`<OutputType>${S}*(Exe|WinExe)${S}*</OutputType>`, "iu");

/** Every file whose name ends in `suffix` below `root`, as path parts; linked folders are not followed. */
function rglobParts(root: string, suffix: string): string[][] {
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
      else if (e.name.endsWith(suffix)) found.push([...parts, e.name]);
    }
  };
  go(root, []);
  return found.sort((a, b) => compareCodeUnits(a.join("/"), b.join("/")));
}

/** C#: the Main files of each project with an Exe OutputType; loose Main files without one. */
function csharpRoots(root: string, known: ReadonlySet<string>): [string[], string[]] {
  const warnings: string[] = [];
  const declaresMain = (rel: string): boolean => {
    try {
      return CSHARP_MAIN.test(readSource(join(root, rel)));
    } catch {
      return false;
    }
  };
  const exeDirs: string[] = [];
  for (const parts of rglobParts(root, ".csproj")) {
    if (parts.some((p) => p === "obj" || p === "bin")) continue;
    let text: string;
    try {
      text = readSource(join(root, ...parts));
    } catch (error) {
      warnings.push(
        `could not read ${parts.join("/")} (${error instanceof Error ? error.message : String(error)})`,
      );
      continue;
    }
    if (CSPROJ_EXE.test(text)) exeDirs.push(parts.slice(0, -1).join("/"));
  }
  if (exeDirs.length > 0) {
    const roots: string[] = [];
    for (const projDir of exeDirs) {
      const prefix = projDir ? `${projDir}/` : "";
      const inProject = pySorted([...known].filter((p) => p.startsWith(prefix)));
      const mains = inProject.filter(declaresMain);
      if (mains.length > 0) {
        roots.push(...mains);
        continue;
      }
      const program = inProject.filter((p) => p.split("/").at(-1) === "Program.cs");
      if (program.length > 0) roots.push(program[0] as string);
      else {
        warnings.push(
          `${projDir || basename(resolve(root))} declares OutputType Exe but no file in it declares ` +
            "Main and none is named Program.cs; it contributes no root",
        );
      }
    }
    if (roots.length > 0) return [pySorted(new Set(roots)), warnings];
  }
  const loose = pySorted([...known].filter(declaresMain));
  return [loose, warnings];
}

/** The entry-point roots of a repository in `language`, with the warnings of the search. */
function findRoots(
  root: string,
  known: ReadonlySet<string>,
  language: Language,
): [string[], string[]] {
  if (language === "python") return pythonRoots(root, known);
  if (language === "csharp") return csharpRoots(root, known);
  if (language === "rust") return rustRoots(known);
  const [rootRoots, rootWarnings] = packageJsonRoots(root, known);
  const [wsRoots, wsWarnings] = workspaceRoots(root, known);
  const roots = [...new Set([...rootRoots, ...wsRoots])];
  const warnings = [...rootWarnings, ...wsWarnings];
  if (roots.length > 0) return [roots, warnings];
  for (const cand of FALLBACK_ROOTS) if (known.has(cand)) return [[cand], warnings];
  return [[], warnings];
}

/**
 * The entry roots of each workspace package (a deliberate difference from repo_map, which reads
 * the root package.json only, so each file of a workspace monorepo showed as an orphan). Per
 * package: its package.json entries (as for the root package), then depgraph's extra entries
 * (`exports` subpaths, `bin`, scripts, tsup config), else a conventional `src/index.*` file.
 */
function workspaceRoots(root: string, known: ReadonlySet<string>): [string[], string[]] {
  const roots: string[] = [];
  const warnings: string[] = [];
  for (const ws of detectWorkspaces(root).values()) {
    if (ws.directory === "") continue;
    const prefix = `${ws.directory}/`;
    const local = new Set(
      [...known].filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length)),
    );
    const [found, pkgWarnings] = packageJsonRoots(join(root, ws.directory), local);
    const pkgRoots = found.map((p) => prefix + p);
    for (const entry of ws.extraEntries) if (known.has(entry)) pkgRoots.push(entry);
    if (pkgRoots.length === 0) {
      const fallback = FALLBACK_ROOTS.map((c) => prefix + c).find((c) => known.has(c));
      if (fallback) pkgRoots.push(fallback);
    }
    roots.push(...pkgRoots);
    for (const w of pkgWarnings) warnings.push(`${prefix}${w}`);
  }
  return [roots, warnings];
}

const READERS: Readonly<Record<Language, (source: string) => ParsedModule>> = {
  typescript: parseTs,
  python: parsePy,
  csharp: parseCs,
  rust: parseRs,
};

const SCANNED: Readonly<Record<Language, string>> = {
  typescript: "TypeScript/JavaScript",
  python: "Python",
  rust: "Rust",
  csharp: "C#",
};

/** Builds the graph of the repository at `root`. */
export async function buildGraph(root: string): Promise<RepoGraph> {
  const language = detectLanguage(root);
  const skippedLinks = new Set<string>();
  const found = discover(root, language, skippedLinks);
  const known = new Set(found.map((f) => f.path));
  // The workspace packages that a package-name import can reach (TypeScript only).
  const workspaces: Map<string, WorkspacePackage> = new Map();
  if (language === "typescript") {
    const members = detectWorkspaces(root);
    const self = members.size === 0 ? selfPackage(root) : undefined;
    for (const [name, ws] of self ? [[self.name, self] as const] : members)
      workspaces.set(name, ws);
  }
  if (language === "typescript" || language === "python") await loadGrammar(language);
  const resolver = getResolver(language);
  const read = READERS[language];

  const parsed = new Map<string, ParsedModule>();
  const sources = new Map<string, string>();
  for (const f of found) {
    // Universal newlines, as Python's read_text.
    const text = readSource(join(root, f.path)).replace(/\r\n?/g, "\n");
    sources.set(f.path, text);
    parsed.set(f.path, read(text));
  }
  resolver.indexNamespaces?.(parsed);

  const files = new Map<string, FileNode>();
  const starTargets = new Map<string, string[]>();
  for (const f of found) {
    const mod = parsed.get(f.path) as ParsedModule;
    const starSpecs = bareStarSpecifiers(sources.get(f.path) as string);
    const internal: Dependency[] = [];
    const external: string[] = [];
    const nodeBuiltins: string[] = [];
    const broken: string[] = [];
    const aliases: string[] = [];
    const packageImports: NonNullable<FileNode["packageImports"]> = [];
    for (const imp of mod.imports) {
      // Classify before resolve: a broken relative import must not look like a package.
      const kind = resolver.classifySpecifier(imp.specifier);
      if (kind === "node" || kind === "stdlib") {
        nodeBuiltins.push(imp.specifier);
        packageImports.push({ specifier: imp.specifier, names: [...imp.names], builtin: true });
      } else if (kind === "alias") aliases.push(imp.specifier);
      else if (kind === "relative") {
        const target = resolver.resolve(imp.specifier, f.path, known);
        if (target === null) {
          broken.push(imp.specifier);
          continue;
        }
        internal.push({
          file: target,
          imports: [...imp.names],
          typeOnly: imp.typeOnly,
          ...(imp.reExport ? { reExport: true } : {}),
          ...(imp.sideEffect ? { sideEffect: true } : {}),
          ...(imp.reExport && imp.names.length === 0 ? { star: true } : {}),
          specifier: imp.specifier,
        });
        if (imp.names.length === 0 && starSpecs.has(imp.specifier)) {
          const list = starTargets.get(f.path) ?? [];
          list.push(target);
          starTargets.set(f.path, list);
        }
      } else {
        if (resolver.resolvesAbsoluteInternal) {
          const targets = resolver.resolveAll
            ? resolver.resolveAll(imp.specifier, f.path, known)
            : [resolver.resolve(imp.specifier, f.path, known)].filter(
                (t): t is string => t !== null,
              );
          if (targets.length > 0) {
            for (const t of targets)
              internal.push({
                file: t,
                imports: [...imp.names],
                typeOnly: imp.typeOnly,
                specifier: imp.specifier,
              });
            continue;
          }
        }
        // A deliberate difference from repo_map: an import of a workspace package by name (or of
        // a single package's own name, 1.x fix F43) is an edge to its entry file, when the
        // census holds that file. Otherwise the import stays external.
        const hit =
          workspaces.size > 0 ? resolveWorkspaceSource(workspaces, imp.specifier) : undefined;
        const wsFile = hit && workspaceTarget(workspaces, hit.ws.name, hit.subpath, known);
        if (hit && wsFile && known.has(wsFile)) {
          internal.push({
            file: wsFile,
            imports: [...imp.names],
            typeOnly: imp.typeOnly,
            ...(imp.reExport ? { reExport: true } : {}),
            ...(imp.sideEffect ? { sideEffect: true } : {}),
            ...(imp.reExport && imp.names.length === 0 ? { star: true } : {}),
            specifier: imp.specifier,
            workspace: hit.ws.name,
          });
          continue;
        }
        external.push(imp.specifier);
        packageImports.push({ specifier: imp.specifier, names: [...imp.names], builtin: false });
      }
    }
    if (resolver.resolveMod) {
      const already = new Set(internal.map((d) => d.file));
      for (const child of mod.provides) {
        const target = resolver.resolveMod(child, f.path, known);
        if (target && !already.has(target)) {
          internal.push({ file: target, imports: [], typeOnly: false });
          already.add(target);
        }
      }
    }
    files.set(f.path, {
      path: f.path,
      area: f.area,
      disposition: f.disposition,
      loc: f.loc,
      exports: [...mod.exports],
      internal,
      external: pySorted(new Set(external)),
      nodeBuiltins: pySorted(new Set(nodeBuiltins)),
      broken,
      aliases,
      exportKinds: { ...mod.exportKinds },
      reExports: [...mod.reExports],
      defaultExportLocal: mod.defaultExportLocal,
      packageImports,
      dynamicImports: [...mod.dynamicImports],
      publicUses: [...mod.publicUses],
    });
  }

  expandBarrelStarReexports(files, parsed, starTargets);

  const [roots, rootWarnings] = findRoots(root, known, language);
  const warnings = [...rootWarnings];
  if (found.length === 0) {
    warnings.push(
      `no ${SCANNED[language]} source files found under the root -- this graph is empty because ` +
        "nothing was scanned, not because the repo has no dependencies",
    );
  } else if (roots.length === 0) {
    warnings.push(
      "could not determine any entry-point roots: no package.json main/module/bin/exports resolved " +
        "to a known source file, and no src/index.* fallback was found -- every 'src' file will show " +
        "as orphan or test-only rather than build-entry",
    );
  }
  const graph = newRepoGraph({
    name: basename(resolve(root)),
    files,
    roots,
    warnings,
    rootPath: root,
    language,
  });
  graph.skippedLinks = [...skippedLinks].sort(compareCodeUnits);
  refineSrcDispositions(graph);
  return graph;
}

/**
 * Expands each bare `export * from "./x"` edge to x's effective exports: its own named exports
 * and, recursively, its own star re-exports. A fixed point, so any cycle shape converges.
 */
function expandBarrelStarReexports(
  files: Map<string, FileNode>,
  parsed: Map<string, ParsedModule>,
  starTargets: Map<string, string[]>,
): void {
  const effective = new Map<string, Set<string>>();
  for (const [p, m] of parsed) effective.set(p, new Set(m.exports));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [path, targets] of starTargets) {
      const mine = effective.get(path) as Set<string>;
      for (const target of targets) {
        for (const name of effective.get(target) ?? []) {
          if (!mine.has(name)) {
            mine.add(name);
            changed = true;
          }
        }
      }
    }
  }
  for (const [path, targets] of starTargets) {
    const targetSet = new Set(targets);
    for (const dep of files.get(path)?.internal ?? []) {
      if (targetSet.has(dep.file) && dep.imports.length === 0) {
        dep.imports = pySorted(effective.get(dep.file) ?? []);
      }
    }
  }
}

/** Recomputes the disposition of each `src` file from real reachability. */
function refineSrcDispositions(graph: RepoGraph): void {
  const reachable = reachableFrom(graph, graph.roots);
  const testRoots = [...graph.files].filter(([, n]) => n.area === "tests").map(([p]) => p);
  const testReachable = reachableFrom(graph, testRoots);
  const rootSet = new Set(graph.roots);
  for (const [path, node] of graph.files) {
    if (node.area !== "src") continue;
    node.disposition = dispositionForArea("src", {
      isRoot: rootSet.has(path),
      reachable: reachable.has(path),
      testReachable: testReachable.has(path),
    });
  }
}

/** The files reachable from `roots` along internal edges. */
export function reachableFrom(graph: RepoGraph, roots: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    if (seen.has(cur) || !graph.files.has(cur)) continue;
    seen.add(cur);
    for (const dep of graph.files.get(cur)?.internal ?? []) stack.push(dep.file);
  }
  return seen;
}

export type { CycleLimits, CycleResult } from "./cycles.ts";

/**
 * Every simple cycle of the internal graph, independent of the file order: canonical-rotation
 * backtracking restricted to the strongly connected component of each start node, in sorted node
 * order. Capped; a capped result is a floor, and a warning says so.
 */
export function findCycles(graph: RepoGraph, limits: CycleLimits = {}): CycleResult {
  const edges = new Map<string, string[]>();
  for (const [p, n] of graph.files) {
    edges.set(p, [...new Set(n.internal.map((d) => d.file).filter((f) => graph.files.has(f)))]);
  }
  const { cycles, steps, truncated } = simpleCycles(edges, limits);
  if (truncated) {
    graph.warnings.push(
      `find_cycles: simple-cycle enumeration hit its safety cap (found ${cycles.length} cycles / ` +
        `${steps} backtracking steps) and stopped early -- the returned cycle count is a FLOOR (at ` +
        "least this many simple cycles exist), not an exact total. This repo's internal-dependency " +
        "graph has a strongly-connected component dense enough that exhaustive simple-cycle " +
        "enumeration became impractical.",
    );
  }
  return { cycles, steps, truncated };
}
