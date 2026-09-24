/**
 * Reachability roots: the files that nothing imports but that ship or run. Sources are the
 * `package.json` `exports` subpaths, `bin` targets and scripts, secondary tsconfig files, the
 * tsup config, root-level build configs and `new URL(..., import.meta.url)` launches.
 *
 * Fix F14: `tsupConfigEntries` reads every `entry: [...]` array of each `tsup.config.*` file,
 * whenever the file exists.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { listNames } from "./dirlist.ts";
import { relativePosix, toPosix } from "./paths.ts";
import { getAllSourceTsFiles } from "./scanner.ts";
import type { ParsedFile, WorkspacePackage } from "./types.ts";

/** The `package.json` fields that name build roots. */
export interface PackageRootFields {
  exports?: Record<string, unknown>;
  bin?: Record<string, string> | string;
  scripts?: Record<string, string>;
}

/** A tsup config file name: `tsup.config.ts`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs` or `.json`. */
const TSUP_CONFIG = /^tsup\.config\.(?:[mc]?[jt]s|json)$/;

/**
 * The `.ts` entries of every `entry: [...]` array in each tsup config of `<pkgDir>` (fix F14),
 * as root-relative POSIX paths. Returns an empty list when no config exists or none is readable.
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
    for (const arr of code.matchAll(/["']?\bentry["']?\s*:\s*\[([^\]]*)\]/g)) {
      for (const m of (arr[1] ?? "").matchAll(/['"`]([^'"`]+\.ts)['"`]/g)) {
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
): string[] {
  const entries: string[] = [];
  const addIfExists = (srcPath: string): void => {
    const norm = toPosix(srcPath);
    if (existsSync(join(root, srcPath)) && !entries.includes(norm)) entries.push(norm);
  };
  if (pkg.exports && typeof pkg.exports === "object") {
    for (const key of Object.keys(pkg.exports)) {
      if (key === "." || !key.startsWith("./")) continue;
      addIfExists(join(pkgDir, "src", `${key.slice(2)}.ts`));
    }
  }
  const binValues = typeof pkg.bin === "string" ? [pkg.bin] : pkg.bin ? Object.values(pkg.bin) : [];
  for (const bin of binValues) {
    const m = /(?:\.\/)?dist\/(.+)\.[cm]?js$/.exec(bin);
    if (!m) continue;
    const rel = (m[1] ?? "").replace(/^src\//, "");
    addIfExists(join(pkgDir, "src", `${rel}.ts`));
  }
  for (const script of Object.values(pkg.scripts ?? {})) {
    if (!script) continue;
    for (const m of script.matchAll(/(?:^|\s)(src\/[\w./-]+\.ts)\b/g)) {
      addIfExists(join(pkgDir, m[1] ?? ""));
    }
    // Port fidelity: the pre-port generator's pattern holds a literal backspace byte (0x08)
    // after `js`, so it never matches a real script and `node dist/x.js` scripts are never
    // seeded. The port keeps that behaviour as `\x08` until fix F33 turns the seeding on.
    for (const m of script.matchAll(
      // biome-ignore lint/suspicious/noControlCharactersInRegex: the 0x08 is deliberate port fidelity (F33).
      /node\s+(?:--[\w-]+(?:=\S+)?\s+)*(?:\.\/)?dist\/(\S+?)\.[cm]?js\x08/g,
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
 * The monorepo entry points: each package `src/index.ts` and extra entry that was parsed, then
 * the config-referenced entries, then the runtime-launched siblings. No path appears twice.
 */
export function collectEntryPoints(
  root: string,
  workspaces: Map<string, WorkspacePackage>,
  parsedFiles: ParsedFile[],
): string[] {
  const entryPoints: string[] = [];
  for (const [, ws] of workspaces) {
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
