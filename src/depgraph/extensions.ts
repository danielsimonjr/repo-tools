/**
 * Repo-local extensions of depgraph (task D10). This stub loads no extension.
 *
 * The pipeline calls `preflight` before the first write and `report` after the core reports.
 * The WASM, WebGPU and parallel pairing reports and the WASM build gate of the pre-port
 * generator become an extension; the core holds no fixed path of one consumer repo.
 */

/** What an extension hook receives. */
export interface ExtensionContext {
  /** The project root (absolute). */
  root: string;
  /** The output directory (absolute). */
  outputDir: string;
}

/** One extension: optional hooks. */
export interface DepgraphExtension {
  preflight?: (ctx: ExtensionContext) => void | Promise<void>;
  report?: (ctx: ExtensionContext) => void | Promise<void>;
}

/** The extensions of a run. The stub returns none. */
export function loadExtensions(): DepgraphExtension[] {
  return [];
}
