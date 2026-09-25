/**
 * Checks that the installed `node_modules` tree matches `bun.lock` (task D11).
 *
 * The build bundles the installed packages into the executable and into `dist/cli.js`. A tree
 * that differs from the lockfile gives a build that succeeds and an artifact that fails.
 * `bun install --frozen-lockfile` does not remove a package that the lockfile no longer names,
 * so a stale nested package can stay after a correct install. This check finds three problems:
 * an installed package that the lockfile does not name, an installed version that differs from
 * the lockfile, and a lockfile package that is not installed. A platform-only package (with `os`
 * or `cpu`) can be absent by design, so its absence is not a problem.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** One `packages` entry of `bun.lock`: `[name@version, registry, metadata, integrity]`. */
type LockEntry = [string, string, { os?: unknown; cpu?: unknown }, ...unknown[]];

/** Removes the trailing commas of `bun.lock` text (outside strings), so JSON.parse reads it. */
function stripTrailingCommas(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inString) {
      out += ch;
      if (ch === "\\") out += text[++i] ?? "";
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    if (ch === ",") {
      const next = text.slice(i + 1).match(/^\s*(.)/s)?.[1];
      if (next === "}" || next === "]") continue;
    }
    out += ch;
  }
  return out;
}

/**
 * The folder of the lock key `key`, relative to the project root. A key names nested packages
 * with `/` (`parent/child`); a scoped name keeps its own `/` (`@scope/name`).
 */
export function lockPackageDir(key: string): string {
  const parts = key.split("/");
  const names: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] as string;
    names.push(part.startsWith("@") ? `${part}/${parts[++i] ?? ""}` : part);
  }
  return names.map((n) => `node_modules/${n}`).join("/");
}

/** The package folders under `dir` (relative path `rel`), nested `node_modules` included. */
function installedDirs(root: string, rel: string, found: string[]): void {
  const abs = join(root, rel);
  if (!existsSync(abs)) return;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const names = entry.name.startsWith("@")
      ? readdirSync(join(abs, entry.name), { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => `${entry.name}/${e.name}`)
      : [entry.name];
    for (const name of names) {
      const dir = `${rel}/${name}`;
      if (existsSync(join(root, dir, "package.json"))) found.push(dir);
      installedDirs(root, `${dir}/node_modules`, found);
    }
  }
}

/** The installed version of the package in `dir`, or undefined when it is unreadable. */
function installedVersion(root: string, dir: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

/** Returns the differences between `node_modules` and `bun.lock` in `root`; empty when none. */
export function checkInstalledTree(root: string): string[] {
  if (!existsSync(join(root, "node_modules"))) {
    return ["node_modules is missing: run bun install --frozen-lockfile"];
  }
  const lock = JSON.parse(stripTrailingCommas(readFileSync(join(root, "bun.lock"), "utf8")));
  const packages = (lock.packages ?? {}) as Record<string, LockEntry>;
  const expected = new Map<string, { version: string; optional: boolean }>();
  for (const [key, entry] of Object.entries(packages)) {
    const id = entry[0];
    const meta = entry[2] ?? {};
    expected.set(lockPackageDir(key), {
      version: id.slice(id.lastIndexOf("@") + 1),
      optional: meta.os !== undefined || meta.cpu !== undefined,
    });
  }
  const found: string[] = [];
  installedDirs(root, "node_modules", found);
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const dir of found.sort()) {
    seen.add(dir);
    const version = installedVersion(root, dir) ?? "unknown version";
    const want = expected.get(dir);
    if (!want) problems.push(`${dir} (${version}) is not in bun.lock`);
    else if (want.version !== version) {
      problems.push(`${dir} is ${version}, bun.lock has ${want.version}`);
    }
  }
  for (const [dir, want] of [...expected].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!seen.has(dir) && !want.optional) {
      problems.push(`${dir} (${want.version}) is in bun.lock but not installed`);
    }
  }
  return problems;
}

/** Throws when `node_modules` in `root` does not match `bun.lock`. */
export function assertInstalledTree(root: string): void {
  const problems = checkInstalledTree(root);
  if (problems.length === 0) return;
  throw new Error(
    `node_modules does not match bun.lock; run bun install --frozen-lockfile, and remove ` +
      `node_modules first when a package stays:\n  ${problems.join("\n  ")}`,
  );
}
