/**
 * Duplicate symbols: names that two or more files define (not only re-export), classed as
 * TRUE_DUPLICATE, DISPATCH_VARIANT, ALIAS_DELEGATION or ALLOWLISTED.
 *
 * The classifier does not see typed-dispatch overloads inside one registration; a person
 * triages each TRUE_DUPLICATE entry.
 *
 * The allowlist file is `depgraph.duplicateAllowlist` of the config (D10a); the default is
 * `duplicate-allowlist.json` in the output folder. The entries sort in code-unit order (fix F22).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "../mask.ts";
import { compareCodeUnits } from "../sort.ts";
import { outputDirOf } from "./paths.ts";
import type { ParsedFile, PublicSurface } from "./types.ts";

/** The export-list keys of `FileExports` that hold own definitions. */
export type DupExportKey = "functions" | "constants" | "classes" | "interfaces" | "types" | "enums";

/** The class of one definer. */
export type DupDefinerTag = "ALLOWLISTED" | "DISPATCH_VARIANT" | "ALIAS_DELEGATION" | "PLAIN";

/** The class of one duplicated name. Only TRUE_DUPLICATE is a merge target. */
export type DupEntryTag =
  | "TRUE_DUPLICATE"
  | "DISPATCH_VARIANT"
  | "ALIAS_DELEGATION"
  | "ALLOWLISTED";

/** One file that defines a duplicated name. */
export interface DuplicateDefiner {
  file: string;
  package: string;
  public: boolean;
  tag: DupDefinerTag;
  /** The allowlist reason, when `tag` is ALLOWLISTED. */
  reason?: string;
}

/** One duplicated name. */
export interface DuplicateSymbolEntry {
  name: string;
  /** The distinct definition categories, sorted and joined with `+`. */
  category: string;
  definers: DuplicateDefiner[];
  /** The sole public definer, `AMBIGUOUS` (two or more), or `internal-only` (none). */
  canonicalHint: string;
  tag: DupEntryTag;
}

/** The content of duplicate-symbols.json. */
export interface DuplicateSymbolsReport {
  note: string;
  summary: {
    runtimeDuplicates: number;
    typeDuplicates: number;
    runtimeByTag: Record<DupEntryTag, number>;
    typeByTag: Record<DupEntryTag, number>;
  };
  runtime: DuplicateSymbolEntry[];
  types: DuplicateSymbolEntry[];
}

/** One allowlist entry. */
export interface DuplicateAllowlistEntry {
  /** Name patterns: `*` matches any name, a trailing `*` is a prefix match. */
  names: string[];
  /** Root-relative file patterns: a trailing `/**` is a directory prefix, else exact. */
  filesGlob: string[];
  reason: string;
}

/** A category and its export-list key. */
export interface DupCategory {
  cat: string;
  key: DupExportKey;
}

/** The runtime categories. */
export const RUNTIME_DUP_CATEGORIES: DupCategory[] = [
  { cat: "function", key: "functions" },
  { cat: "constant", key: "constants" },
  { cat: "class", key: "classes" },
];

/** The type categories. */
export const TYPE_DUP_CATEGORIES: DupCategory[] = [
  { cat: "interface", key: "interfaces" },
  { cat: "type", key: "types" },
  { cat: "enum", key: "enums" },
];

/** The note of duplicate-symbols.json and duplicate-symbols.md (report text, kept verbatim). */
export const DUPLICATE_SYMBOLS_NOTE =
  "This report groups names by OWN definition, not by call graph, then classifies each " +
  "flagged name (see DupEntryTag): TRUE_DUPLICATE (the actionable merge targets), " +
  "DISPATCH_VARIANT (>=2 mathTyped(...) registrations of the same public name — distinct " +
  "dispatch surfaces, Bucket C delegation candidates, not copy-paste bodies), " +
  "ALIAS_DELEGATION (a const-alias forward to an imported symbol, not an independent body — " +
  "excluded once fewer than 2 real bodies remain), and ALLOWLISTED (matches " +
  "duplicate-allowlist.json: hot-path is* guards, AssemblyScript mirrors, per-package " +
  "VERSION strings). NOT detected: same-file typed-dispatch overload polymorphism for " +
  "different argument shapes within one registration — a human still triages TRUE_DUPLICATE " +
  "entries using the defining files + public flags before merging anything.";

/** The entry order: TRUE_DUPLICATE first. */
const DUP_ENTRY_TAG_SORT_ORDER: Record<DupEntryTag, number> = {
  TRUE_DUPLICATE: 0,
  DISPATCH_VARIANT: 1,
  ALIAS_DELEGATION: 2,
  ALLOWLISTED: 3,
};

/** Reads the allowlist file `path`. A missing or invalid file gives an empty allowlist. */
export function loadDuplicateAllowlist(path: string): DuplicateAllowlistEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as {
      entries?: DuplicateAllowlistEntry[];
    };
    return parsed.entries ?? [];
  } catch {
    return [];
  }
}

/** Matches one allowlist pattern: `*`, a `/**` directory prefix, a `*` prefix, or exact. */
export function globMatchSingle(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("/**")) return value.startsWith(pattern.slice(0, -2));
  if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1));
  return value === pattern;
}

/** The first allowlist entry that matches both `name` and `filePath`. */
export function findAllowlistMatch(
  allowlist: DuplicateAllowlistEntry[],
  name: string,
  filePath: string,
): DuplicateAllowlistEntry | undefined {
  return allowlist.find(
    (e) =>
      e.names.some((n) => globMatchSingle(n, name)) &&
      e.filesGlob.some((f) => globMatchSingle(f, filePath)),
  );
}

/** Escapes the regular-expression characters of `s`. */
export function escapeRegExpLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True for `export const NAME = mathTyped(...)`, a typed-dispatch registration. */
export function isDispatchVariantBody(code: string, name: string): boolean {
  const re = new RegExp(
    `export\\s+const\\s+${escapeRegExpLiteral(name)}\\s*(?::[^=]+)?=\\s*mathTyped\\s*(?:<[^>]*>)?\\s*\\(`,
  );
  return re.test(code);
}

/** Every local binding name that an `import ... from` statement of `code` introduces. */
export function collectImportedLocalNames(code: string): Set<string> {
  const names = new Set<string>();
  const importRegex =
    /import\s+(?:type\s+)?(?:(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+))(?:\s*,\s*(?:\{([^}]+)\}|(\w+)))?)\s+from\s+['"][^'"]+['"]/g;
  for (const m of code.matchAll(importRegex)) {
    const named = m[1] || m[4] || "";
    const def = m[2] || m[5] || "";
    const ns = m[3] || "";
    if (named) {
      for (const item of named.split(",")) {
        const trimmed = item.trim().replace(/^type\s+/, "");
        if (!trimmed) continue;
        const parts = trimmed.split(/\s+as\s+/);
        const local = (parts[parts.length - 1] ?? "").trim();
        if (local) names.add(local);
      }
    }
    if (def) names.add(def);
    if (ns) names.add(ns);
  }
  return names;
}

/** True for `export const NAME = ident;` where `ident` is an imported binding. */
export function isAliasDelegationBody(
  code: string,
  name: string,
  importedLocalNames: Set<string>,
): boolean {
  const re = new RegExp(
    `export\\s+const\\s+${escapeRegExpLiteral(name)}\\s*(?::[^=]+)?=\\s*([A-Za-z_$][\\w$]*)\\s*;`,
  );
  const m = code.match(re);
  return !!m && importedLocalNames.has(m[1] ?? "");
}

/**
 * Classes one definer: ALLOWLISTED first. A `constant` definer can then be DISPATCH_VARIANT or
 * ALIAS_DELEGATION. Everything else is PLAIN. `readRaw` gives the raw source of a path.
 */
export function classifyDefiner(
  file: ParsedFile,
  name: string,
  category: string,
  allowlist: DuplicateAllowlistEntry[],
  readRaw: (relPath: string) => string,
): { tag: DupDefinerTag; reason?: string } {
  const allowMatch = findAllowlistMatch(allowlist, name, file.path);
  if (allowMatch) return { tag: "ALLOWLISTED", reason: allowMatch.reason };
  if (category === "constant") {
    const raw = readRaw(file.path);
    if (raw) {
      // Fix F27: string-aware comment removal keeps a `//` inside a string.
      const code = stripComments(raw);
      if (isDispatchVariantBody(code, name)) return { tag: "DISPATCH_VARIANT" };
      if (isAliasDelegationBody(code, name, collectImportedLocalNames(code))) {
        return { tag: "ALIAS_DELEGATION" };
      }
    }
  }
  return { tag: "PLAIN" };
}

/**
 * Every own definition of every name, keyed by name. A re-exported name is not an own
 * definition, and an interface does not count again as a type.
 */
export function collectOwnDefiners(
  files: ParsedFile[],
  categories: DupCategory[],
): Map<string, Array<{ file: ParsedFile; category: string }>> {
  const byName = new Map<string, Array<{ file: ParsedFile; category: string }>>();
  for (const file of files) {
    const reExported = new Set(file.exports.reExported);
    for (const { cat, key } of categories) {
      for (const name of file.exports[key]) {
        if (reExported.has(name)) continue;
        if (key === "types" && file.exports.interfaces.includes(name)) continue;
        const list = byName.get(name) ?? [];
        list.push({ file, category: cat });
        byName.set(name, list);
      }
    }
  }
  return byName;
}

/** Makes one entry and its canonical hint. */
export function finalizeDuplicateEntry(
  name: string,
  categories: Set<string>,
  definers: DuplicateDefiner[],
  tag: DupEntryTag,
): DuplicateSymbolEntry {
  const publicDefiners = definers.filter((d) => d.public);
  const canonicalHint =
    publicDefiners.length === 1
      ? (publicDefiners[0]?.file ?? "")
      : publicDefiners.length > 1
        ? "AMBIGUOUS"
        : "internal-only";
  return { name, category: [...categories].sort().join("+"), definers, canonicalHint, tag };
}

/**
 * The entries for names with two or more distinct defining files. Entry class: fewer than 2
 * non-alias definers gives ALIAS_DELEGATION; else fewer than 2 non-allowlisted definers gives
 * ALLOWLISTED; else 2 or more dispatch definers give DISPATCH_VARIANT; else TRUE_DUPLICATE.
 * A definer is public when its file is in the wildcard surface or its name is named-public.
 */
export function buildDuplicateEntries(
  byName: Map<string, Array<{ file: ParsedFile; category: string }>>,
  publicSurface: PublicSurface,
  allowlist: DuplicateAllowlistEntry[],
  readRaw: (relPath: string) => string,
): DuplicateSymbolEntry[] {
  const isFilePublic = (file: ParsedFile, name: string): boolean =>
    publicSurface.publicWildcardFiles.has(file.path) ||
    publicSurface.publicNamed.has(`${file.path}::${name}`);
  const entries: DuplicateSymbolEntry[] = [];
  for (const [name, defs] of byName) {
    const byFile = new Map<string, { file: ParsedFile; category: string }>();
    for (const d of defs) if (!byFile.has(d.file.path)) byFile.set(d.file.path, d);
    if (byFile.size < 2) continue;
    const categories = new Set<string>();
    const definers: DuplicateDefiner[] = [];
    for (const { file, category } of byFile.values()) {
      categories.add(category);
      const { tag, reason } = classifyDefiner(file, name, category, allowlist, readRaw);
      definers.push({
        file: file.path,
        package: file.packageName ?? "unknown",
        public: isFilePublic(file, name),
        tag,
        ...(reason ? { reason } : {}),
      });
    }
    definers.sort((a, b) => compareCodeUnits(a.file, b.file));
    const nonAlias = definers.filter((d) => d.tag !== "ALIAS_DELEGATION");
    if (nonAlias.length < 2) {
      entries.push(finalizeDuplicateEntry(name, categories, definers, "ALIAS_DELEGATION"));
      continue;
    }
    const nonAllowlisted = nonAlias.filter((d) => d.tag !== "ALLOWLISTED");
    let entryTag: DupEntryTag;
    if (nonAllowlisted.length < 2) {
      entryTag = "ALLOWLISTED";
    } else {
      const dispatchCount = nonAllowlisted.filter((d) => d.tag === "DISPATCH_VARIANT").length;
      entryTag = dispatchCount >= 2 ? "DISPATCH_VARIANT" : "TRUE_DUPLICATE";
    }
    entries.push(finalizeDuplicateEntry(name, categories, definers, entryTag));
  }
  entries.sort(
    (a, b) =>
      DUP_ENTRY_TAG_SORT_ORDER[a.tag] - DUP_ENTRY_TAG_SORT_ORDER[b.tag] ||
      b.definers.length - a.definers.length ||
      compareCodeUnits(a.name, b.name),
  );
  return entries;
}

/** The entry count per tag. */
export function tallyByTag(entries: DuplicateSymbolEntry[]): Record<DupEntryTag, number> {
  const tally: Record<DupEntryTag, number> = {
    TRUE_DUPLICATE: 0,
    DISPATCH_VARIANT: 0,
    ALIAS_DELEGATION: 0,
    ALLOWLISTED: 0,
  };
  for (const e of entries) tally[e.tag]++;
  return tally;
}

/**
 * The runtime and type duplicate entries of `files`. Reads raw sources from `root`, and the
 * allowlist from `allowlistPath` (default: `duplicate-allowlist.json` in the default output
 * folder).
 */
export function detectDuplicateSymbols(
  files: ParsedFile[],
  publicSurface: PublicSurface,
  root: string,
  allowlistPath: string = join(outputDirOf(root), "duplicate-allowlist.json"),
): { runtime: DuplicateSymbolEntry[]; types: DuplicateSymbolEntry[] } {
  const allowlist = loadDuplicateAllowlist(allowlistPath);
  const cache = new Map<string, string>();
  const readRaw = (relPath: string): string => {
    let content = cache.get(relPath);
    if (content === undefined) {
      try {
        content = readFileSync(join(root, relPath), "utf-8");
      } catch {
        content = "";
      }
      cache.set(relPath, content);
    }
    return content;
  };
  return {
    runtime: buildDuplicateEntries(
      collectOwnDefiners(files, RUNTIME_DUP_CATEGORIES),
      publicSurface,
      allowlist,
      readRaw,
    ),
    types: buildDuplicateEntries(
      collectOwnDefiners(files, TYPE_DUP_CATEGORIES),
      publicSurface,
      allowlist,
      readRaw,
    ),
  };
}

/** The full report of one run. */
export function buildDuplicateReport(dup: {
  runtime: DuplicateSymbolEntry[];
  types: DuplicateSymbolEntry[];
}): DuplicateSymbolsReport {
  const runtimeByTag = tallyByTag(dup.runtime);
  const typeByTag = tallyByTag(dup.types);
  return {
    note: DUPLICATE_SYMBOLS_NOTE,
    summary: {
      runtimeDuplicates: runtimeByTag.TRUE_DUPLICATE,
      typeDuplicates: typeByTag.TRUE_DUPLICATE,
      runtimeByTag,
      typeByTag,
    },
    runtime: dup.runtime,
    types: dup.types,
  };
}
