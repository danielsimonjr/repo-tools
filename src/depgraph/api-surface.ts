/**
 * API-surface extraction for a TypeScript/ESM codebase.
 *
 * Reads source TEXT, not a compiler AST, so it runs without a TypeScript compiler API. It reports,
 * per exported declaration: kind, async, type parameters, parameter list, declared return type, the
 * stability tag and summary of the attached JSDoc block, and the source line. `resolveSurface`
 * follows re-exports from an entry file to the declaring files.
 *
 * Nothing here knows a repository: file loading and specifier resolution are injected, and the
 * stability tags are a parameter. `createTsResolver` is a generic default for relative ESM
 * specifiers that name `.ts` sources as `.js`.
 *
 * Limits, by design: only top-level declarations (brace depth 0) are seen; `export =` and
 * `export default <expression>` are not reported; a signature is the source text as written,
 * whitespace-normalized, not a checked type.
 *
 * @module depgraph/api-surface
 */

/** Stability tags recognised by default. A tag counts only as a whole word after whitespace. */
export const DEFAULT_STABILITY_TAGS: readonly string[] = [
  "public",
  "internal",
  "experimental",
  "beta",
  "alpha",
];

/** Kind of an exported declaration. `namespace` is produced only by `export * as ns`. */
export type ExportKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "const"
  | "variable"
  | "namespace";

/** One exported declaration of one file. */
export interface ExportDetail {
  /** The exported name (after any `as` rename in a local export list). */
  readonly name: string;
  /** The declared name in this file. */
  readonly localName: string;
  readonly kind: ExportKind;
  /** 1-based line of the declaration. */
  readonly line: number;
  /** `async` function or async arrow. */
  readonly async: boolean;
  /** Type parameter list including the angle brackets, or null. */
  readonly typeParams: string | null;
  /** Parameter list without the parentheses, or null when the export is not callable. */
  readonly params: string | null;
  /** Declared return type, or null when absent or not callable. */
  readonly returnType: string | null;
  /** The last recognised stability tag in the attached JSDoc block, or null. */
  readonly stability: string | null;
  /** A `/** ... *\/` block is attached to the declaration. */
  readonly documented: boolean;
  /** The first paragraph of the attached block, before any tag, or null. */
  readonly summary: string | null;
}

/** One re-export statement: `export { a as b } from`, `export type {...} from`, `export * [as ns] from`. */
export interface ReExport {
  readonly from: string;
  readonly star: boolean;
  readonly namespace: string | null;
  readonly names: ReadonlyArray<{
    readonly exported: string;
    readonly local: string;
    readonly typeOnly: boolean;
  }>;
}

/** Options shared by the extractors. */
export interface SurfaceOptions {
  readonly stabilityTags?: readonly string[];
}

/** One symbol of an entry file's public surface. */
export interface SurfaceSymbol extends Omit<ExportDetail, "localName"> {
  /** Name at the declaration site. */
  readonly declaredName: string;
  /** File that declares the symbol (for a namespace: the file it gathers). */
  readonly declaredIn: string;
  /** Files the symbol passes through, entry first, declaring file excluded. */
  readonly via: readonly string[];
  /** Erased at runtime: an interface or type alias, or re-exported with `type`. */
  readonly typeOnly: boolean;
}

/** Result of {@link resolveSurface}. */
export interface Surface {
  readonly entry: string;
  readonly symbols: readonly SurfaceSymbol[];
  /** Relative specifiers that did not resolve to a loadable file, or names a file does not export. */
  readonly unresolved: ReadonlyArray<{
    readonly from: string;
    readonly specifier: string;
    readonly name?: string;
  }>;
  /** Bare (package) specifiers, which this module does not follow. */
  readonly external: ReadonlyArray<{ readonly from: string; readonly specifier: string }>;
}

// ── masking ───────────────────────────────────────────────────────────────

const REGEX_PREFIX = new Set([
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "+",
  "-",
  "*",
  "%",
  "<",
  ">",
  "~",
  "^",
]);
const REGEX_KEYWORDS = new Set([
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "void",
  "yield",
  "await",
]);

/**
 * Replace every character inside comments, strings, template literals and regex literals with a
 * space, keeping newlines, so structural scans on the result see only code. Same length as input.
 */
export function maskNonCode(src: string): string {
  const out = src.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
  };
  // Stack of brace depths at which a template expression `${` was opened.
  const templateStack: number[] = [];
  let depth = 0;
  let i = 0;
  const prevCode = (at: number): string => {
    let k = at - 1;
    while (k >= 0 && /\s/.test(out[k] as string)) k--;
    if (k < 0) return "";
    if (/[\w$]/.test(out[k] as string)) {
      let s = k;
      while (s > 0 && /[\w$]/.test(out[s - 1] as string)) s--;
      return out.slice(s, k + 1).join("");
    }
    return out[k] as string;
  };
  const skipTemplate = (start: number): number => {
    // start is just after a backtick (or after the closing } of an expression). Returns the index
    // just past the closing backtick, or the index of `${` (with templateStack pushed).
    let k = start;
    while (k < src.length) {
      const c = src[k];
      if (c === "\\") {
        k += 2;
        continue;
      }
      if (c === "`") return k + 1;
      if (c === "$" && src[k + 1] === "{") {
        templateStack.push(depth);
        return -(k + 2) - 1;
      }
      k++;
    }
    return src.length;
  };
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      const end = src.indexOf("\n", i);
      const stop = end < 0 ? src.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "'" || c === '"') {
      let k = i + 1;
      while (k < src.length && src[k] !== c && src[k] !== "\n") k += src[k] === "\\" ? 2 : 1;
      blank(i, Math.min(k + 1, src.length));
      i = k + 1;
      continue;
    }
    if (
      c === "`" ||
      (c === "}" && templateStack.length > 0 && templateStack[templateStack.length - 1] === depth)
    ) {
      if (c === "}") templateStack.pop();
      const r = skipTemplate(i + 1);
      if (r < 0) {
        const resume = -(r + 1);
        blank(i, resume);
        i = resume;
      } else {
        blank(i, r);
        i = r;
      }
      continue;
    }
    if (c === "/") {
      const p = prevCode(i);
      if (p === "" || REGEX_PREFIX.has(p) || REGEX_KEYWORDS.has(p)) {
        let k = i + 1;
        let inClass = false;
        while (k < src.length && src[k] !== "\n") {
          const d = src[k];
          if (d === "\\") {
            k += 2;
            continue;
          }
          if (d === "[") inClass = true;
          else if (d === "]") inClass = false;
          else if (d === "/" && !inClass) break;
          k++;
        }
        blank(i, Math.min(k + 1, src.length));
        i = k + 1;
        continue;
      }
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    i++;
  }
  return out.join("");
}

// ── small scanners over masked text ───────────────────────────────────────

const OPEN = "([{<";
const CLOSE = ")]}>";

/** Index just past the bracket that closes the one at `start` (any of ( [ { <). `=>` is not a bracket. */
function scanBalanced(masked: string, start: number): number {
  let depth = 0;
  for (let k = start; k < masked.length; k++) {
    const c = masked[k] as string;
    if (c === ">" && masked[k - 1] === "=") continue;
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) {
      depth--;
      if (depth === 0) return k + 1;
    }
  }
  return masked.length;
}

function skipWs(masked: string, k: number): number {
  while (k < masked.length && /\s/.test(masked[k] as string)) k++;
  return k;
}

function norm(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/,$/, "").trim();
}

/**
 * Scan a type annotation that starts at `k` (just after the colon). Stops at depth 0 on `;`, on a
 * body `{` that follows a complete type, on `=>` when `stopAtArrow`, or on `=` when `stopAtAssign`.
 */
function scanType(
  masked: string,
  orig: string,
  k: number,
  stopAtArrow: boolean,
  stopAtAssign: boolean,
): number {
  let depth = 0;
  const start = k;
  for (; k < masked.length; k++) {
    const c = masked[k] as string;
    const isArrow = c === "=" && masked[k + 1] === ">";
    if (depth === 0) {
      if (c === ";") return k;
      if (stopAtArrow && isArrow && orig.slice(start, k).trim() !== "") return k;
      if (stopAtAssign && c === "=" && !isArrow && masked[k - 1] !== "=" && masked[k + 1] !== "=")
        return k;
      if (c === "{") {
        const before = orig.slice(start, k).trimEnd();
        if (before.trim() !== "" && /[\w$)\]>}'"`]$/.test(before)) return k;
      }
    }
    if (c === ">" && masked[k - 1] === "=") continue;
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth--;
  }
  return k;
}

interface Signature {
  readonly async: boolean;
  readonly typeParams: string | null;
  readonly params: string | null;
  readonly returnType: string | null;
}

const NO_SIGNATURE: Signature = { async: false, typeParams: null, params: null, returnType: null };

function readCallable(masked: string, orig: string, k: number, arrow: boolean): Signature | null {
  let isAsync = false;
  k = skipWs(masked, k);
  if (arrow && masked.startsWith("async", k) && !/[\w$]/.test(masked[k + 5] ?? "")) {
    isAsync = true;
    k = skipWs(masked, k + 5);
  }
  let typeParams: string | null = null;
  if (masked[k] === "<") {
    const end = scanBalanced(masked, k);
    typeParams = norm(orig.slice(k, end));
    k = skipWs(masked, end);
  }
  if (masked[k] !== "(") return null;
  const close = scanBalanced(masked, k);
  const params = norm(orig.slice(k + 1, close - 1));
  k = skipWs(masked, close);
  let returnType: string | null = null;
  if (masked[k] === ":") {
    const end = scanType(masked, orig, k + 1, arrow, false);
    returnType = norm(orig.slice(k + 1, end)) || null;
    k = skipWs(masked, end);
  }
  if (arrow && !(masked[k] === "=" && masked[k + 1] === ">")) return null;
  return { async: isAsync, typeParams, params, returnType };
}

// ── JSDoc ─────────────────────────────────────────────────────────────────

function attachedDoc(orig: string, declStart: number): string | null {
  let k = declStart - 1;
  while (k >= 0 && /\s/.test(orig[k] as string)) k--;
  if (k < 1 || orig[k] !== "/" || orig[k - 1] !== "*") return null;
  const open = orig.lastIndexOf("/*", k - 1);
  if (open < 0 || orig[open + 2] !== "*") return null;
  return orig.slice(open, k + 1);
}

function docStability(doc: string, tags: readonly string[]): string | null {
  let found: string | null = null;
  for (const m of doc.matchAll(/(?:^|[\s*])@([a-z]+(?:-[a-z]+)*)(?![\w-])/g)) {
    if (tags.includes(m[1] as string)) found = m[1] as string;
  }
  return found;
}

function docSummary(doc: string): string | null {
  const body = doc.replace(/^\/\*\*/, "").replace(/\*\/$/, "");
  const lines = body.split(/\r?\n/).map((l) => l.replace(/^\s*\*?\s?/, ""));
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t === "") {
      if (kept.length) break;
      continue;
    }
    if (t.startsWith("@")) break;
    kept.push(t);
  }
  const text = (kept.join(" ").split(/\s@[a-z]/)[0] as string).trim();
  return text === "" ? null : text;
}

// ── declarations ──────────────────────────────────────────────────────────

const DECL =
  /(^|\n)(export[ \t]+)?(declare[ \t]+)?(default[ \t]+)?(async[ \t]+)?(abstract[ \t]+)?(function\*?|class|interface|type|enum|const|let|var)[ \t]+([A-Za-z_$][\w$]*)/g;

interface Decl extends ExportDetail {
  readonly exported: boolean;
  readonly isDefault: boolean;
  readonly start: number;
}

function braceDepths(masked: string): Int32Array {
  const d = new Int32Array(masked.length + 1);
  let depth = 0;
  for (let k = 0; k < masked.length; k++) {
    d[k] = depth;
    if (masked[k] === "{") depth++;
    else if (masked[k] === "}") depth--;
  }
  d[masked.length] = depth;
  return d;
}

function lineOf(src: string, at: number): number {
  let n = 1;
  for (let k = 0; k < at; k++) if (src[k] === "\n") n++;
  return n;
}

function readDeclarations(
  src: string,
  opts: SurfaceOptions,
): { decls: Decl[]; masked: string; depths: Int32Array } {
  const tags = opts.stabilityTags ?? DEFAULT_STABILITY_TAGS;
  const masked = maskNonCode(src);
  const depths = braceDepths(masked);
  const decls: Decl[] = [];
  for (const m of masked.matchAll(DECL)) {
    const start = (m.index ?? 0) + (m[1] as string).length;
    if (depths[start] !== 0) continue;
    const word = m[7] as string;
    const name = m[8] as string;
    const kind: ExportKind = word.startsWith("function")
      ? "function"
      : word === "let" || word === "var"
        ? "variable"
        : (word as ExportKind);
    const afterName = start + m[0].length - (m[1] as string).length;
    let sig = NO_SIGNATURE;
    if (kind === "function") {
      const s = readCallable(masked, src, afterName, false);
      if (s) sig = { ...s, async: Boolean(m[5]) };
    } else if (kind === "const" || kind === "variable") {
      let k = skipWs(masked, afterName);
      if (masked[k] === ":") k = scanType(masked, src, k + 1, false, true);
      k = skipWs(masked, k);
      if (masked[k] === "=" && masked[k + 1] !== "=") {
        const s = readCallable(masked, src, k + 1, true);
        if (s) sig = s;
      }
    }
    const doc = attachedDoc(src, start);
    decls.push({
      name: m[4] ? "default" : name,
      localName: name,
      kind,
      line: lineOf(src, start),
      async: sig.async,
      typeParams: sig.typeParams,
      params: sig.params,
      returnType: sig.returnType,
      stability: doc ? docStability(doc, tags) : null,
      documented: doc !== null,
      summary: doc ? docSummary(doc) : null,
      exported: Boolean(m[2]),
      isDefault: Boolean(m[4]),
      start,
    });
  }
  return { decls, masked, depths };
}

function strip(d: Decl, exportedName: string): ExportDetail {
  return {
    name: exportedName,
    localName: d.localName,
    kind: d.kind,
    line: d.line,
    async: d.async,
    typeParams: d.typeParams,
    params: d.params,
    returnType: d.returnType,
    stability: d.stability,
    documented: d.documented,
    summary: d.summary,
  };
}

interface ExportList {
  readonly from: string | null;
  readonly star: boolean;
  readonly namespace: string | null;
  readonly names: ReadonlyArray<{ exported: string; local: string; typeOnly: boolean }>;
}

const EXPORT_LIST =
  /(^|\n)export[ \t]+(type[ \t]+)?(\*(?:[ \t]+as[ \t]+([A-Za-z_$][\w$]*))?|\{([^}]*)\})(?:[ \t\n]*from)?/g;

function readExportLists(src: string, masked: string, depths: Int32Array): ExportList[] {
  const lists: ExportList[] = [];
  for (const m of masked.matchAll(EXPORT_LIST)) {
    const start = (m.index ?? 0) + (m[1] as string).length;
    if (depths[start] !== 0) continue;
    const end = (m.index ?? 0) + m[0].length;
    // The specifier is masked (it is a string); read it from the original text.
    const spec = /^\s*(['"])([^'"]+)\1/.exec(src.slice(end));
    const hasFrom = /from$/.test(m[0]);
    const from = hasFrom && spec ? (spec[2] as string) : null;
    const allType = Boolean(m[2]);
    if ((m[3] as string).startsWith("*")) {
      if (from) lists.push({ from, star: true, namespace: m[4] ?? null, names: [] });
      continue;
    }
    // Names come from the MASKED text: a comment inside the braces is blank there, never a name.
    const names = masked
      .slice(start, end)
      .replace(/^[^{]*\{/, "")
      .replace(/\}[\s\S]*$/, "")
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p !== "")
      .map((p) => {
        const typeOnly = allType || /^type\s/.test(p);
        const [local, exported] = p
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)
          .map((x) => x.trim());
        return { exported: (exported ?? local) as string, local: local as string, typeOnly };
      });
    lists.push({ from, star: false, namespace: null, names });
  }
  return lists;
}

/**
 * Every exported top-level declaration of one source file, in source order. A local export list
 * (`export { a, b as c }`) exports the declarations it names under the listed names.
 */
export function extractExportDetails(source: string, opts: SurfaceOptions = {}): ExportDetail[] {
  const { decls, masked, depths } = readDeclarations(source, opts);
  const out: Array<{ at: number; d: ExportDetail }> = [];
  for (const d of decls) if (d.exported) out.push({ at: d.start, d: strip(d, d.name) });
  const byLocal = new Map<string, Decl>();
  for (const d of decls) if (!byLocal.has(d.localName)) byLocal.set(d.localName, d);
  for (const list of readExportLists(source, masked, depths)) {
    if (list.from !== null) continue;
    for (const n of list.names) {
      const d = byLocal.get(n.local);
      if (d) out.push({ at: d.start, d: strip(d, n.exported) });
    }
  }
  return out.sort((a, b) => a.at - b.at).map((x) => x.d);
}

/** Every `export ... from` statement of one source file, in source order. */
export function extractReExports(source: string): ReExport[] {
  const masked = maskNonCode(source);
  return readExportLists(source, masked, braceDepths(masked))
    .filter((l): l is ExportList & { from: string } => l.from !== null)
    .map((l) => ({
      from: l.from,
      star: l.star,
      namespace: l.namespace,
      names: l.names.map((n) => ({ ...n })),
    }));
}

const IMPORT = /(^|\n)import[ \t]+(type[ \t]+)?\{([^}]*)\}[ \t\n]*from/g;

function importBindings(
  src: string,
  masked: string,
): Map<string, { from: string; imported: string; typeOnly: boolean }> {
  const map = new Map<string, { from: string; imported: string; typeOnly: boolean }>();
  for (const m of masked.matchAll(IMPORT)) {
    const end = (m.index ?? 0) + m[0].length;
    const spec = /^\s*(['"])([^'"]+)\1/.exec(src.slice(end));
    if (!spec) continue;
    const inner = masked
      .slice((m.index ?? 0) + (m[1] as string).length, end)
      .replace(/^[^{]*\{/, "")
      .replace(/\}[\s\S]*$/, "");
    for (const part of inner
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)) {
      const typeOnly = Boolean(m[2]) || /^type\s/.test(part);
      const [imported, local] = part
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .map((x) => x.trim());
      map.set((local ?? imported) as string, {
        from: spec[2] as string,
        imported: imported as string,
        typeOnly,
      });
    }
  }
  return map;
}

// ── surface ───────────────────────────────────────────────────────────────

type Entry = SurfaceSymbol;

/**
 * The public surface of `entry`: every name it exports, followed through `export ... from`, local
 * export lists of imported bindings, `export *` (which never carries `default`) and
 * `export * as ns`. Cycles are cut. Symbols are sorted by exported name (code-unit order).
 *
 * @param load     Returns a file's source text, or null when it does not exist.
 * @param resolve  Maps (importing file, relative specifier) to a loadable path, or null.
 */
export function resolveSurface(
  entry: string,
  load: (path: string) => string | null,
  resolve: (from: string, specifier: string) => string | null,
  opts: SurfaceOptions = {},
): Surface {
  const unresolved: Array<{ from: string; specifier: string; name?: string }> = [];
  const external: Array<{ from: string; specifier: string }> = [];
  const memo = new Map<string, Map<string, Entry>>();
  const seenProblem = new Set<string>();
  const note = (
    list: Array<{ from: string; specifier: string; name?: string }>,
    item: { from: string; specifier: string; name?: string },
  ) => {
    const key = `${item.from}|${item.specifier}|${item.name ?? ""}`;
    if (!seenProblem.has(key)) {
      seenProblem.add(key);
      list.push(item);
    }
  };

  const target = (from: string, spec: string): string | null => {
    if (!spec.startsWith(".")) {
      note(external, { from, specifier: spec });
      return null;
    }
    const p = resolve(from, spec);
    if (p === null || load(p) === null) {
      note(unresolved, { from, specifier: spec });
      return null;
    }
    return p;
  };

  const exportsOf = (
    path: string,
    stack: Set<string>,
  ): { map: Map<string, Entry>; cut: boolean } => {
    const cached = memo.get(path);
    if (cached) return { map: cached, cut: false };
    if (stack.has(path)) return { map: new Map(), cut: true };
    const src = load(path);
    if (src === null) return { map: new Map(), cut: false };
    const inner = new Set(stack).add(path);
    const map = new Map<string, Entry>();
    let cut = false;
    const own = (d: ExportDetail, typeOnlyRe: boolean): Entry => {
      const { localName, ...rest } = d;
      return {
        ...rest,
        declaredName: localName,
        declaredIn: path,
        via: [],
        typeOnly: typeOnlyRe || d.kind === "interface" || d.kind === "type",
      };
    };
    const lift = (e: Entry, exported: string, typeOnly: boolean): Entry => ({
      ...e,
      name: exported,
      via: [path, ...e.via],
      typeOnly: e.typeOnly || typeOnly,
    });
    const named = (fromSpec: string, local: string, exported: string, typeOnly: boolean) => {
      const t = target(path, fromSpec);
      if (t === null) return;
      const sub = exportsOf(t, inner);
      cut ||= sub.cut;
      const e = sub.map.get(local);
      if (e) {
        if (!map.has(exported)) map.set(exported, lift(e, exported, typeOnly));
      } else if (!sub.cut) note(unresolved, { from: path, specifier: fromSpec, name: local });
    };

    for (const d of extractExportDetails(src, opts))
      if (!map.has(d.name)) map.set(d.name, own(d, false));

    const masked = maskNonCode(src);
    const depths = braceDepths(masked);
    const imports = importBindings(src, masked);
    for (const list of readExportLists(src, masked, depths)) {
      if (list.from === null) {
        for (const n of list.names) {
          if (map.has(n.exported)) continue;
          const imp = imports.get(n.local);
          if (imp) named(imp.from, imp.imported, n.exported, n.typeOnly || imp.typeOnly);
        }
        continue;
      }
      if (list.star && list.namespace) {
        const t = target(path, list.from);
        if (t !== null && !map.has(list.namespace)) {
          map.set(list.namespace, {
            name: list.namespace,
            declaredName: list.namespace,
            declaredIn: t,
            via: [path],
            typeOnly: false,
            kind: "namespace",
            line: 0,
            async: false,
            typeParams: null,
            params: null,
            returnType: null,
            stability: null,
            documented: false,
            summary: null,
          });
        }
        continue;
      }
      if (list.star) {
        const t = target(path, list.from);
        if (t === null) continue;
        const sub = exportsOf(t, inner);
        cut ||= sub.cut;
        for (const [n, e] of sub.map)
          if (n !== "default" && !map.has(n)) map.set(n, lift(e, n, false));
        continue;
      }
      for (const n of list.names) named(list.from, n.local, n.exported, n.typeOnly);
    }
    if (!cut) memo.set(path, map);
    return { map, cut };
  };

  const root = exportsOf(entry, new Set()).map;
  const symbols = [...root.values()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  return { entry, symbols, unresolved, external };
}

/**
 * A resolver for relative ESM specifiers in a TypeScript source tree: `./x.js` → `./x.ts` (then
 * `.tsx`, then the specifier itself), an extensionless `./x` → `./x.ts` or `./x/index.ts`. Paths are
 * POSIX, relative to the same root as `exists`.
 */
export function createTsResolver(
  exists: (path: string) => boolean,
): (from: string, specifier: string) => string | null {
  return (from, specifier) => {
    const parts = from.split("/").slice(0, -1);
    for (const seg of specifier.split("/")) {
      if (seg === "." || seg === "") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    const base = parts.join("/");
    const candidates = /\.(m|c)?js$/.test(base)
      ? [base.replace(/\.(m|c)?js$/, ".ts"), base.replace(/\.(m|c)?js$/, ".tsx"), base]
      : /\.tsx?$/.test(base)
        ? [base]
        : [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`];
    return candidates.find(exists) ?? null;
  };
}

/** Stable, timestamp-free report object for {@link resolveSurface}; the `--api-surface` output. */
export function buildApiSurfaceReport(
  surface: Surface,
  files: ReadonlyArray<{ readonly path: string; readonly exports: readonly ExportDetail[] }>,
  stabilityTags: readonly string[],
): object {
  const count = <T>(items: readonly T[], key: (t: T) => string) => {
    const out: Record<string, number> = {};
    for (const it of items) out[key(it)] = (out[key(it)] ?? 0) + 1;
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
  };
  return {
    schemaVersion: 1,
    entry: surface.entry,
    stabilityTags: [...stabilityTags],
    summary: {
      symbols: surface.symbols.length,
      runtime: surface.symbols.filter((s) => !s.typeOnly).length,
      typeOnly: surface.symbols.filter((s) => s.typeOnly).length,
      byKind: count(surface.symbols, (s) => s.kind),
      byStability: count(surface.symbols, (s) => s.stability ?? "untagged"),
      undocumented: surface.symbols.filter((s) => !s.documented && s.kind !== "namespace").length,
    },
    symbols: surface.symbols,
    unresolved: surface.unresolved,
    external: surface.external,
    files: [...files]
      .sort((a, b) => (a.path < b.path ? -1 : 1))
      .map((f) => ({ path: f.path, exports: f.exports })),
  };
}
