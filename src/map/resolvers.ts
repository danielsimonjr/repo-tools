/**
 * The resolvers of the map engine: one per language, each mapping an import specifier to a file of
 * the repository. Ported from `repo_map/resolvers/` of the architecture-docs skill.
 *
 * The contract is narrow: a resolver reads no file and parses nothing; it gets the specifier, the
 * importing file and the set of known paths. Three optional capabilities exist for languages whose
 * imports are not paths: `resolvesAbsoluteInternal` (an "external" specifier can still be a file of
 * the repository), `resolveAll` (one specifier, several files) with `indexNamespaces` (C#), and
 * `resolveMod` (Rust `mod`, the file edge).
 */
import { pyDirname, pyJoin, pyNormpath } from "../py.ts";
import { compareCodeUnits } from "../sort.ts";
import type { ParsedModule } from "./parsing.ts";
import { PYTHON_STDLIB_MODULES } from "./python-stdlib.ts";

/** The resolver of one language. */
export interface Resolver {
  readonly language: string;
  /** "relative", "node", "stdlib", "alias" or "external". */
  classifySpecifier(spec: string): string;
  /** The file that `specifier` names from `fromFile`, or null. */
  resolve(specifier: string, fromFile: string, knownFiles: ReadonlySet<string>): string | null;
  readonly resolvesAbsoluteInternal?: boolean;
  resolveAll?(specifier: string, fromFile: string, knownFiles: ReadonlySet<string>): string[];
  indexNamespaces?(parsed: ReadonlyMap<string, ParsedModule>): void;
  resolveMod?(name: string, fromFile: string, knownFiles: ReadonlySet<string>): string | null;
}

/** Node built-in module names (a hand list, as in the Python tool; see its limits there). */
export const NODE_BUILTINS: ReadonlySet<string> = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
  "sea",
  "test",
  "sqlite",
  "dns/promises",
  "fs/promises",
  "readline/promises",
  "stream/promises",
  "stream/consumers",
  "stream/web",
  "timers/promises",
  "util/types",
  "path/posix",
  "path/win32",
  "assert/strict",
]);

const ALIAS_PREFIXES = ["@/", "~/"];
/** The candidate suffixes, in priority order (`.ts` before a literal `.js`). */
const CANDIDATE_SUFFIXES = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
/** A specifier extension that resolves to the source that produces it (`./b.js` -> `b.ts`). */
const SUBSTITUTABLE_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs"];

/** TypeScript and JavaScript: relative paths with extension substitution and index files. */
export class TypeScriptResolver implements Resolver {
  readonly language = "typescript";

  classifySpecifier(spec: string): string {
    if (spec.startsWith(".")) return "relative";
    if (spec.startsWith("node:") || NODE_BUILTINS.has(spec.split("/")[0] as string)) return "node";
    if (ALIAS_PREFIXES.some((p) => spec.startsWith(p))) return "alias";
    return "external";
  }

  resolve(specifier: string, fromFile: string, knownFiles: ReadonlySet<string>): string | null {
    if (this.classifySpecifier(specifier) !== "relative") return null;
    const base = pyNormpath(pyJoin(pyDirname(fromFile), specifier));
    let stem = base;
    for (const ext of SUBSTITUTABLE_EXTENSIONS) {
      if (base.endsWith(ext)) {
        stem = base.slice(0, -ext.length);
        break;
      }
    }
    for (const suffix of CANDIDATE_SUFFIXES) {
      if (knownFiles.has(stem + suffix)) return stem + suffix;
    }
    if (stem === base && knownFiles.has(base)) return base;
    for (const suffix of CANDIDATE_SUFFIXES) {
      const cand = pyJoin(stem, `index${suffix}`);
      if (knownFiles.has(cand)) return cand;
    }
    return null;
  }
}

/** Python: level-counted relative imports, first-party absolute imports, packages. */
export class PythonResolver implements Resolver {
  readonly language = "python";
  readonly resolvesAbsoluteInternal = true;

  classifySpecifier(spec: string): string {
    if (spec.startsWith(".")) return "relative";
    if (PYTHON_STDLIB_MODULES.has(spec.split(".")[0] as string)) return "stdlib";
    return "external";
  }

  resolve(specifier: string, fromFile: string, knownFiles: ReadonlySet<string>): string | null {
    if (specifier.startsWith(".")) return this.resolveRelative(specifier, fromFile, knownFiles);
    // A stdlib name never resolves to a repository file (`import os` in a repo with os.py).
    if (this.classifySpecifier(specifier) === "stdlib") return null;
    return candidates(specifier.split("."), knownFiles);
  }

  private resolveRelative(
    specifier: string,
    fromFile: string,
    knownFiles: ReadonlySet<string>,
  ): string | null {
    const level = specifier.length - specifier.replace(/^\.+/, "").length;
    const tail = specifier.slice(level);
    let pkgDir = pyDirname(fromFile);
    for (let i = 0; i < level - 1; i++) {
      // More dots than packages: climbing past the root gives no file, never a `..` path.
      if (pkgDir === "") return null;
      pkgDir = pyDirname(pkgDir);
    }
    const parts = pkgDir.split("/").filter((p) => p !== "");
    if (tail === "") {
      const init = [...parts, "__init__.py"].join("/");
      return knownFiles.has(init) ? init : null;
    }
    return candidates([...parts, ...tail.split(".")], knownFiles);
  }
}

/** A module (`a/b.py`) before a package (`a/b/__init__.py`), as CPython prefers. */
function candidates(parts: string[], knownFiles: ReadonlySet<string>): string | null {
  if (parts.length === 0) return null;
  const module = `${parts.join("/")}.py`;
  if (knownFiles.has(module)) return module;
  const pkg = [...parts, "__init__.py"].join("/");
  return knownFiles.has(pkg) ? pkg : null;
}

/** C#: a `using` names a namespace, which many files can declare. */
export class CSharpResolver implements Resolver {
  readonly language = "csharp";
  readonly resolvesAbsoluteInternal = true;
  private byNamespace = new Map<string, string[]>();

  /** Builds the namespace -> files index once per graph build, in path order. */
  indexNamespaces(parsed: ReadonlyMap<string, ParsedModule>): void {
    const index = new Map<string, string[]>();
    for (const path of [...parsed.keys()].sort(compareCodeUnits)) {
      for (const ns of parsed.get(path)?.provides ?? []) {
        const list = index.get(ns);
        if (list) list.push(path);
        else index.set(ns, [path]);
      }
    }
    this.byNamespace = index;
  }

  classifySpecifier(spec: string): string {
    // The first SEGMENT, never a prefix: "SystemsCheck.Core" is first-party.
    return spec.split(".")[0] === "System" ? "stdlib" : "external";
  }

  /** Every file that declares `specifier`, except `fromFile` (no self-edge, no false cycle). */
  resolveAll(specifier: string, fromFile: string, _knownFiles: ReadonlySet<string>): string[] {
    return (this.byNamespace.get(specifier) ?? []).filter((p) => p !== fromFile);
  }

  resolve(specifier: string, fromFile: string, knownFiles: ReadonlySet<string>): string | null {
    return this.resolveAll(specifier, fromFile, knownFiles)[0] ?? null;
  }
}

/** A POSIX path as its parts; `[]` is the path ".". Models Python's `PurePosixPath`. */
type PosixPath = readonly string[];
const posixOf = (path: string): PosixPath => path.split("/").filter((p) => p !== "" && p !== ".");
const posixStr = (p: PosixPath): string => (p.length === 0 ? "." : p.join("/"));
const parentOf = (p: PosixPath): PosixPath => p.slice(0, -1);

/** Rust: `mod` is the file edge; `use` paths resolve through the crate tree. */
export class RustResolver implements Resolver {
  readonly language = "rust";
  readonly resolvesAbsoluteInternal = true;
  static readonly CRATE_ROOTS = ["src/lib.rs", "src/main.rs"];
  static readonly STDLIB_ROOTS: ReadonlySet<string> = new Set([
    "std",
    "core",
    "alloc",
    "proc_macro",
    "test",
  ]);

  classifySpecifier(spec: string): string {
    return RustResolver.STDLIB_ROOTS.has(spec.split("::")[0] as string) ? "stdlib" : "external";
  }

  private crateRoot(knownFiles: ReadonlySet<string>): string | null {
    for (const root of RustResolver.CRATE_ROOTS) if (knownFiles.has(root)) return root;
    for (const cand of [...knownFiles].sort(compareCodeUnits)) {
      if (cand.endsWith("/lib.rs") || cand.endsWith("/main.rs")) return cand;
    }
    return null;
  }

  /** The folder of a module's children: its own folder for mod.rs/lib.rs/main.rs, else a sibling. */
  private moduleDir(fromFile: string): PosixPath {
    const p = posixOf(fromFile);
    const name = p.at(-1) ?? "";
    if (name === "mod.rs" || name === "lib.rs" || name === "main.rs") return parentOf(p);
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    return [...parentOf(p), stem];
  }

  /** `name` under `base`, as `name.rs` or `name/mod.rs`. */
  private moduleFile(
    base: PosixPath,
    name: string,
    knownFiles: ReadonlySet<string>,
  ): string | null {
    for (const cand of [posixStr([...base, `${name}.rs`]), posixStr([...base, name, "mod.rs"])]) {
      if (knownFiles.has(cand)) return cand;
    }
    return null;
  }

  resolveMod(name: string, fromFile: string, knownFiles: ReadonlySet<string>): string | null {
    return this.moduleFile(this.moduleDir(fromFile), name, knownFiles);
  }

  /** The deepest module file on a `use` path; null for an external crate or the standard library. */
  resolve(specifier: string, fromFile: string, knownFiles: ReadonlySet<string>): string | null {
    const segments = specifier.split("::").filter((s) => s !== "");
    if (segments.length === 0) return null;
    const head = segments[0] as string;
    if (RustResolver.STDLIB_ROOTS.has(head)) return null;
    let base: PosixPath;
    let rest: string[];
    if (head === "crate") {
      const root = this.crateRoot(knownFiles);
      if (root === null) return null;
      base = this.moduleDir(root);
      rest = segments.slice(1);
    } else if (head === "self") {
      base = this.moduleDir(fromFile);
      rest = segments.slice(1);
    } else if (head === "super") {
      base = this.moduleDir(fromFile);
      rest = [...segments];
      while (rest.length > 0 && rest[0] === "super") {
        base = parentOf(base);
        rest = rest.slice(1);
      }
    } else {
      return null;
    }
    let found: string | null = null;
    for (const seg of rest) {
      const hit = this.moduleFile(base, seg, knownFiles);
      if (hit === null) break;
      found = hit;
      base = this.moduleDir(hit);
    }
    if (found === null && rest.length === 0) return this.crateRoot(knownFiles);
    return found;
  }
}

const TYPESCRIPT = new TypeScriptResolver();
const PYTHON = new PythonResolver();
const RUST = new RustResolver();

/** The resolver of `language`. C# gets a new instance per build: it holds a per-repo index. */
export function getResolver(language: string): Resolver {
  switch (language) {
    case "typescript":
    case "javascript":
      return TYPESCRIPT;
    case "python":
      return PYTHON;
    case "csharp":
      return new CSharpResolver();
    case "rust":
      return RUST;
    default:
      throw new Error(`no resolver registered for '${language}'`);
  }
}
