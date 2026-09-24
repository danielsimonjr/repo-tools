/**
 * Repo-local extensions of depgraph (design section 5.2).
 *
 * An extension is a `.mjs` module with a default export `{ name, preflight?, report? }`.
 * `depgraph.extensions` names the modules, relative to the root; they load in that order. The
 * pipeline calls each `preflight` before its first write and each `report` after the analysis.
 * A hook that throws, or that returns a rejected promise, fails the run with exit 1, and the
 * error names the extension. The core holds no fixed path of one consumer repo: the WASM,
 * WebGPU and parallel pairing reports and the WASM build gate of the pre-port generator are an
 * extension in the consumer repo.
 */
import { existsSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type DepgraphConfig, isAbsolutePath, resolveUnderRoot } from "../config.ts";
import { writeReport } from "../io.ts";
import { blankCommentsAndStrings, stripComments } from "../mask.ts";

/** The masking functions of `src/mask.ts`. An extension uses these and keeps no copy. */
export interface ExtensionMask {
  blankCommentsAndStrings: (src: string) => string;
  stripComments: (src: string) => string;
}

/** What `preflight` receives. */
export interface PreflightContext {
  /** The project root (absolute). */
  root: string;
  /** The merged config, frozen. */
  config: Readonly<DepgraphConfig>;
  mask: ExtensionMask;
}

/** What `report` receives. */
export interface ReportContext extends PreflightContext {
  /** A frozen copy of the analysis result: the content of dependency-graph.json. */
  graph: unknown;
  /**
   * Writes `text` to `relPath` in the output folder, with LF line endings and one trailing LF.
   * Throws when `relPath` is empty, absolute or leaves the output folder.
   */
  write: (relPath: string, text: string) => void;
}

/** One extension: a name and optional hooks. */
export interface DepgraphExtension {
  name: string;
  preflight?: (ctx: PreflightContext) => void | Promise<void>;
  report?: (ctx: ReportContext) => void | Promise<void>;
}

/** The hooks of an extension. */
type HookName = "preflight" | "report";

/** The masking functions that every context holds. */
const MASK: ExtensionMask = Object.freeze({ blankCommentsAndStrings, stripComments });

/** Returns `value` with every nested object frozen. */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Returns a frozen deep copy of `value`. The pipeline keeps its own object. */
export function readOnlyCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

/** The text of an error of any type. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Loads the extension modules `paths` (relative to `root`) in order. Throws when a path does not
 * end in `.mjs`, when the module does not exist or does not load, or when its default export is
 * not `{ name, preflight?, report? }`. The error names the configured path.
 */
export async function loadExtensions(
  root: string,
  paths: readonly string[],
): Promise<DepgraphExtension[]> {
  const loaded: DepgraphExtension[] = [];
  for (const rel of paths) {
    const label = `extension ${rel.replace(/\\/g, "/")}`;
    if (!rel.endsWith(".mjs")) throw new Error(`${label}: v1 loads .mjs modules only`);
    const abs = resolveUnderRoot(root, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      throw new Error(`${label}: the module does not exist`);
    }
    let mod: { default?: unknown };
    try {
      mod = await import(pathToFileURL(abs).href);
    } catch (err) {
      throw new Error(`${label}: the module does not load: ${messageOf(err)}`);
    }
    loaded.push(checkExtension(label, mod.default));
  }
  return loaded;
}

/** Returns `value` as an extension, or throws when its shape is wrong. */
function checkExtension(label: string, value: unknown): DepgraphExtension {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${label}: the default export must be an object with a name`);
  }
  const ext = value as Record<string, unknown>;
  if (typeof ext.name !== "string" || ext.name === "") {
    throw new Error(`${label}: the default export must have a non-empty string name`);
  }
  for (const hook of ["preflight", "report"] as const) {
    if (ext[hook] !== undefined && typeof ext[hook] !== "function") {
      throw new Error(`${label}: ${hook} must be a function`);
    }
  }
  return value as DepgraphExtension;
}

/**
 * Runs the hook `hook` of each extension in order, and waits for each. Throws when a hook
 * throws or its promise rejects; the error names the extension and the hook.
 */
export async function runHook<H extends HookName>(
  extensions: readonly DepgraphExtension[],
  hook: H,
  ctx: H extends "report" ? ReportContext : PreflightContext,
): Promise<void> {
  for (const ext of extensions) {
    const fn = ext[hook] as ((c: typeof ctx) => void | Promise<void>) | undefined;
    if (!fn) continue;
    try {
      await fn.call(ext, ctx);
    } catch (err) {
      throw new Error(`extension ${ext.name} failed in ${hook}: ${messageOf(err)}`);
    }
  }
}

/** The `preflight` context of a run. */
export function preflightContext(root: string, config: DepgraphConfig): PreflightContext {
  return { root, config: readOnlyCopy(config), mask: MASK };
}

/**
 * The `report` context of a run: the `preflight` context, a frozen copy of `graph`, and a
 * `write` that stays in `outputDir`.
 */
export function reportContext(
  root: string,
  config: DepgraphConfig,
  outputDir: string,
  graph: unknown,
): ReportContext {
  return {
    ...preflightContext(root, config),
    graph: readOnlyCopy(graph),
    write: (relPath: string, text: string): void => {
      writeReport(outputPath(outputDir, relPath), text);
    },
  };
}

/**
 * The absolute path of `relPath` in `outputDir`. Throws when `relPath` is empty or absolute, or
 * when it names the output folder itself or a path outside it.
 */
export function outputPath(outputDir: string, relPath: string): string {
  if (typeof relPath !== "string" || relPath === "" || isAbsolutePath(relPath)) {
    throw new Error("write: the path must be relative to the output folder");
  }
  const path = resolve(outputDir, relPath);
  const rel = relative(outputDir, path);
  if (
    rel === "" ||
    rel === ".." ||
    rel.startsWith("../") ||
    rel.startsWith("..\\") ||
    isAbsolute(rel)
  ) {
    throw new Error("write: the path must stay in the output folder");
  }
  return path;
}
