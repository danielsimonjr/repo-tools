/**
 * Reachability roots: the files that nothing imports but that ship or run. Sources are the
 * `package.json` `exports` subpaths, `bin` targets and scripts, secondary tsconfig files, the
 * tsup config, root-level build configs and `new URL(..., import.meta.url)` launches.
 *
 * Fix F14: `tsupConfigEntries` reads every `entry: [...]` array of each `tsup.config.*` file,
 * whenever the file exists. Fix F37: it also reads the object form, `entry: { a: 'src/a.ts' }`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { listNames } from "./dirlist.ts";
import { relativePosix, toPosix } from "./paths.ts";
import { distToSrc } from "./resolver.ts";
import { getAllSourceTsFiles } from "./scanner.ts";
import type { ParsedFile, WorkspacePackage } from "./types.ts";

/** The `package.json` fields that name build roots. The values are not checked yet. */
export interface PackageRootFields {
  exports?: unknown;
  bin?: unknown;
  scripts?: unknown;
}

/** Receives one warning line (without the trailing line feed). */
export type Warn = (message: string) => void;

/** True for a JSON object: not null, not an array. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A tsup config file name: `tsup.config.ts`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs` or `.json`. */
const TSUP_CONFIG = /^tsup\.config\.(?:[mc]?[jt]s|json)$/;

/**
 * The `.ts` entries of every `entry` option in each tsup config of `<pkgDir>`, as root-relative
 * POSIX paths in file order: each string of an `entry: [...]` array (fix F14), and each string
 * value of an `entry: { name: '...' }` object (fix F37). Returns an empty list when no config
 * exists or none is readable.
 */
export function tsupConfigEntries(root: string, pkgDir: string): string[] {
  let names: string[];
  try {
    names = listNames(join(root, pkgDir)).filter((n) => TSUP_CONFIG.test(n));
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    let code: string;
    try {
      code = readFileSync(join(root, pkgDir, name), "utf-8");
    } catch {
      continue;
    }
    for (const opt of code.matchAll(/["']?\bentry["']?\s*:\s*(?:\[([^\]]*)\]|\{([^}]*)\})/g)) {
      // An array lists the entries; an object maps each output name to an entry after a `:`.
      const values =
        opt[1] !== undefined
          ? (opt[1] ?? "").matchAll(/['"`]([^'"`]+\.ts)['"`]/g)
          : (opt[2] ?? "").matchAll(/:\s*['"`]([^'"`]+\.ts)['"`]/g);
      for (const m of values) {
        const entry = toPosix(join(pkgDir, m[1] ?? ""));
        if (!out.includes(entry)) out.push(entry);
      }
    }
  }
  return out;
}

/**
 * Adds the entry files of a secondary tsconfig (`tsc -p <cfg>`) with `add`: its `files`, each
 * non-glob `include` path that ends in `.ts`, and every source file under the base directory of
 * a glob `include`.
 */
export function seedTsconfigEntries(
  root: string,
  pkgDir: string,
  cfgRel: string,
  add: (srcPath: string) => void,
): void {
  const cfgPath = join(root, pkgDir, cfgRel);
  if (!existsSync(cfgPath)) return;
  let cfg: { files?: string[]; include?: string[] };
  try {
    cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
  } catch {
    return;
  }
  const cfgDir = dirname(join(pkgDir, cfgRel));
  const seedPath = (p: string): void => {
    if (p.includes("*")) {
      const base = join(root, cfgDir, p.replace(/\/?\*.*$/, ""));
      if (existsSync(base)) {
        for (const f of getAllSourceTsFiles(base)) add(relativePosix(root, f));
      }
    } else if (p.endsWith(".ts")) {
      add(join(cfgDir, p));
    }
  };
  for (const f of cfg.files ?? []) seedPath(f);
  for (const inc of cfg.include ?? []) seedPath(inc);
}

/**
 * The extra build roots of one package, as root-relative POSIX paths that exist on disk:
 * `exports` subpaths other than ".", `bin` targets (`dist/x.js` and `dist/src/x.js` both map to
 * `src/x.ts`), `src/*.ts` arguments and `node dist/...` runs in scripts, `tsc -p` tsconfig
 * entries, and the entries of each tsup config.
 */
export function exportsSubpathEntries(
  root: string,
  pkgDir: string,
  pkg: PackageRootFields,
  warn: Warn = () => {},
): string[] {
  const entries: string[] = [];
  const addIfExists = (srcPath: string): void => {
    const norm = toPosix(srcPath);
    if (existsSync(join(root, srcPath)) && !entries.includes(norm)) entries.push(norm);
  };
  if (isJsonObject(pkg.exports)) {
    for (const key of Object.keys(pkg.exports)) {
      if (key === "." || !key.startsWith("./")) continue;
      // Fix M1: a subpath can name a folder. `./util` is `src/util.ts`, else `src/util/index.ts`.
      const file = join(pkgDir, "src", `${key.slice(2)}.ts`);
      addIfExists(
        existsSync(join(root, file)) ? file : join(pkgDir, "src", key.slice(2), "index.ts"),
      );
    }
  }
  const binValues =
    typeof pkg.bin === "string" ? [pkg.bin] : isJsonObject(pkg.bin) ? Object.values(pkg.bin) : [];
  for (const bin of binValues) {
    if (typeof bin !== "string") continue;
    const m = /(?:\.\/)?dist\/(.+)\.[cm]?js$/.exec(bin);
    if (!m) continue;
    const rel = (m[1] ?? "").replace(/^src\//, "");
    addIfExists(join(pkgDir, "src", `${rel}.ts`));
  }
  // Fix F35: a script that is not a string is ignored with a warning, never a TypeError that
  // drops the package.
  const pkgJson = toPosix(join(pkgDir, "package.json"));
  let scripts: Record<string, unknown> = {};
  if (isJsonObject(pkg.scripts)) scripts = pkg.scripts;
  else if (pkg.scripts !== undefined) warn(`${pkgJson}: scripts is not an object; it is ignored`);
  for (const [name, script] of Object.entries(scripts)) {
    if (typeof script !== "string") {
      warn(`${pkgJson}: scripts.${name} is not a string; it is ignored`);
      continue;
    }
    if (!script) continue;
    for (const m of script.matchAll(/(?:^|\s)(src\/[\w./-]+\.ts)\b/g)) {
      addIfExists(join(pkgDir, m[1] ?? ""));
    }
    // Fix F33: `node [--flag ...] ./dist/x.js` seeds `src/x.ts`. The pre-port pattern held a
    // backspace byte (0x08) where a word boundary was meant, so it never matched.
    for (const m of script.matchAll(
      /node\s+(?:--[\w-]+(?:=\S+)?\s+)*(?:\.\/)?dist\/(\S+?)\.[cm]?js\b/g,
    )) {
      addIfExists(join(pkgDir, "src", `${(m[1] ?? "").replace(/^src\//, "")}.ts`));
    }
    for (const m of script.matchAll(/tsc\s+-p\s+([\w./-]+\.json)/g)) {
      seedTsconfigEntries(root, pkgDir, m[1] ?? "", addIfExists);
    }
  }
  // Fix F14: a tsup config names build roots whenever it exists. The pre-port generator read it
  // only when a `build` or `dev` script called a bare `tsup`.
  for (const entry of tsupConfigEntries(root, pkgDir)) addIfExists(entry);
  return entries;
}

/**
 * The first file target of one `exports` value: the string itself, else the first target of
 * its conditions in their order. A `types` condition names a declaration file, so it is skipped.
 */
function exportTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isJsonObject(value)) return undefined;
  for (const [condition, inner] of Object.entries(value)) {
    if (condition === "types") continue;
    const target = exportTarget(inner);
    if (target !== undefined) return target;
  }
  return undefined;
}

/**
 * The source files of the entries of the root package (fix F43), keyed by subpath: "." and each
 * `./x` key of `exports` (a `*` pattern key is skipped). Each value is a root-relative path that
 * exists on disk. A target maps to its source: `dist/` to `src/` (as `distToSrc` does) and
 * `.js`, `.mjs` or `.cjs` to `.ts`. When the source of a target does not exist, "." gives
 * `src/index.ts`, and `./x` gives `src/x.ts`, else `src/x/index.ts` (the rule of
 * `exportsSubpathEntries`). Without a "." export, `main` names the "." entry.
 */
export function packageEntryFiles(
  root: string,
  pkg: PackageRootFields & { main?: unknown },
): Record<string, string> {
  const out: Record<string, string> = {};
  const exists = (rel: string): boolean => existsSync(join(root, rel));
  const sourceOf = (target: string | undefined): string | undefined => {
    if (target === undefined || target.endsWith(".d.ts")) return undefined;
    const rel = distToSrc(toPosix(join(".", target))).replace(/\.[cm]?js$/, ".ts");
    return rel.endsWith(".ts") && exists(rel) ? rel : undefined;
  };
  const targets: Record<string, string | undefined> = {};
  const exp = pkg.exports;
  if (typeof exp === "string") targets["."] = exp;
  else if (isJsonObject(exp)) {
    const keys = Object.keys(exp);
    if (keys.length > 0 && keys.every((k) => !k.startsWith("."))) targets["."] = exportTarget(exp);
    else for (const key of keys) targets[key] = exportTarget(exp[key]);
  }
  if (!("." in targets) && typeof pkg.main === "string") targets["."] = pkg.main;
  const index = "src/index.ts";
  const rootSource = sourceOf(targets["."]) ?? (exists(index) ? index : undefined);
  if (rootSource) out["."] = rootSource;
  for (const [key, target] of Object.entries(targets)) {
    if (key === "." || !key.startsWith("./") || key.includes("*")) continue;
    const file = `src/${key.slice(2)}.ts`;
    const folder = `src/${key.slice(2)}/index.ts`;
    const source = sourceOf(target) ?? (exists(file) ? file : exists(folder) ? folder : undefined);
    if (source) out[key] = source;
  }
  return out;
}

/**
 * The extra build roots of the root package in single-package mode (fix M1): the
 * `exportsSubpathEntries` of the root `package.json`. Returns an empty list when the file is
 * missing, is not valid JSON, or is not a JSON object.
 */
export function rootPackageEntries(root: string, warn: Warn = () => {}): string[] {
  let pkg: unknown;
  try {
    pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
  } catch {
    return [];
  }
  return isJsonObject(pkg) ? exportsSubpathEntries(root, "", pkg, warn) : [];
}

/**
 * The root package of single-package mode as a package that an import can name (fix F43), so a
 * self-import (`'my-pkg'`, `'my-pkg/sub'`) resolves to its own source through `entryFiles`.
 * Returns undefined when `package.json` is missing, is not a JSON object, or has no name.
 */
export function selfPackage(root: string): WorkspacePackage | undefined {
  let pkg: unknown;
  try {
    pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
  } catch {
    return undefined;
  }
  if (!isJsonObject(pkg) || typeof pkg.name !== "string" || !pkg.name) return undefined;
  return {
    name: pkg.name,
    directory: "",
    srcDir: "src",
    extraEntries: [],
    entryFiles: packageEntryFiles(root, pkg),
  };
}

/**
 * Source files that a root-level build or test config names in `new URL('<...src/x.ts>', ...)`
 * (a bundler alias or entry target). Returns root-relative paths without a leading `./`.
 */
export function configReferencedEntries(root: string): string[] {
  const out = new Set<string>();
  let names: string[];
  try {
    names = listNames(root);
  } catch {
    return [];
  }
  const isConfig = (n: string): boolean =>
    /\.config(\.[\w-]+)?\.(m?[jt]s)$/.test(n) || /^(vite|vitest|rollup|webpack|tsup)\./.test(n);
  for (const name of names) {
    if (!isConfig(name)) continue;
    let code: string;
    try {
      code = readFileSync(join(root, name), "utf-8");
    } catch {
      continue;
    }
    for (const m of code.matchAll(/new\s+URL\(\s*['"`]([^'"`]*?src\/[\w./-]+\.ts)['"`]/g)) {
      out.add((m[1] ?? "").replace(/^\.\//, ""));
    }
  }
  return [...out];
}

/**
 * Sibling scripts that a parsed source file launches with
 * `new URL('./x.js', import.meta.url)`: the `./x.ts` beside the file, when it is in `parsed`.
 */
export function runtimeLaunchedEntries(root: string, parsed: ParsedFile[]): string[] {
  const known = new Set(parsed.map((f) => f.path));
  const out = new Set<string>();
  for (const file of parsed) {
    let code: string;
    try {
      code = readFileSync(join(root, file.path), "utf-8");
    } catch {
      continue;
    }
    for (const m of code.matchAll(
      /new\s+URL\(\s*['"`](\.[^'"`]*?\.m?js)['"`]\s*,\s*import\.meta\.url/g,
    )) {
      const sibling = toPosix(join(dirname(file.path), m[1] ?? ""));
      const tsPath = sibling.replace(/\.m?js$/, ".ts");
      if (known.has(tsPath)) out.add(tsPath);
    }
  }
  return [...out];
}

/**
 * The entry points: each package `src/index.ts` and extra entry that was parsed, then the
 * config-referenced entries, then the runtime-launched siblings. No path appears twice. In
 * single-package mode (no workspace) the root package is the one package: `src/index.ts` and
 * `rootEntries` (fix M1).
 */
export function collectEntryPoints(
  root: string,
  workspaces: Map<string, WorkspacePackage>,
  parsedFiles: ParsedFile[],
  rootEntries: readonly string[] = [],
): string[] {
  const entryPoints: string[] = [];
  const packages =
    workspaces.size > 0 ? [...workspaces.values()] : [{ srcDir: "src", extraEntries: rootEntries }];
  for (const ws of packages) {
    const candidates = [toPosix(`${ws.srcDir}/index.ts`), ...ws.extraEntries];
    for (const entryPath of candidates) {
      const found = parsedFiles.find((f) => f.path === entryPath);
      if (found && !entryPoints.includes(found.path)) entryPoints.push(found.path);
    }
  }
  for (const cfgEntry of configReferencedEntries(root)) {
    if (parsedFiles.some((f) => f.path === cfgEntry) && !entryPoints.includes(cfgEntry)) {
      entryPoints.push(cfgEntry);
    }
  }
  for (const launched of runtimeLaunchedEntries(root, parsedFiles)) {
    if (!entryPoints.includes(launched)) entryPoints.push(launched);
  }
  return entryPoints;
}
