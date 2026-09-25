/**
 * The tree-sitter grammars of the map engine: loaded lazily, once each, from the `.wasm` files
 * that ship with the tool.
 *
 * The `.wasm` imports use Bun's file loader. In the compiled executable the path is the embedded
 * file (absolute); from source it is the file in `node_modules` (absolute); in the Node bundle it
 * is a path relative to the bundle, and Node resolves a relative path against the working folder.
 * So a relative path resolves against this module's URL, never the working folder.
 */
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import pythonWasm from "tree-sitter-python/tree-sitter-python.wasm" with { type: "file" };
import typescriptWasm from "tree-sitter-typescript/tree-sitter-typescript.wasm" with {
  type: "file",
};
import { Language, Parser } from "web-tree-sitter";
import runtimeWasm from "web-tree-sitter/web-tree-sitter.wasm" with { type: "file" };

/** A grammar that the engine can load. */
export type GrammarName = "typescript" | "python";

const WASM: Readonly<Record<GrammarName, string>> = {
  typescript: typescriptWasm,
  python: pythonWasm,
};

/** The bytes of a bundled asset. A relative path is relative to this module, not the cwd. */
function assetBytes(path: string): Uint8Array {
  const file = isAbsolute(path) ? path : fileURLToPath(new URL(path, import.meta.url));
  return new Uint8Array(readFileSync(file));
}

let runtime: Promise<void> | undefined;
const parsers = new Map<GrammarName, Parser>();
const loading = new Map<GrammarName, Promise<Parser>>();

/** Loads the tree-sitter runtime once. */
function initRuntime(): Promise<void> {
  runtime ??= Parser.init({ wasmBinary: assetBytes(runtimeWasm) });
  return runtime;
}

/** Loads the grammar `name` once, and returns its parser. */
export function loadGrammar(name: GrammarName): Promise<Parser> {
  let pending = loading.get(name);
  if (!pending) {
    pending = (async () => {
      await initRuntime();
      const parser = new Parser();
      parser.setLanguage(await Language.load(assetBytes(WASM[name])));
      parsers.set(name, parser);
      return parser;
    })();
    loading.set(name, pending);
  }
  return pending;
}

/** The parser of a grammar that `loadGrammar` already loaded. Throws when it is not loaded. */
export function parserFor(name: GrammarName): Parser {
  const parser = parsers.get(name);
  if (!parser) throw new Error(`the ${name} grammar is not loaded; call loadGrammar first`);
  return parser;
}
