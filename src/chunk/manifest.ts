/**
 * The chunk manifest: its types, its hash and its file I/O (design section 4).
 *
 * A manifest lives in the chunk folder as `manifest.json`. It records the source file, the file
 * type and one entry for each chunk file.
 */
import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { writeLf } from "../io.ts";

export type FileType = "markdown" | "json" | "typescript";

/** One chunk file in a manifest. */
export interface ChunkInfo {
  index: number;
  filename: string;
  title: string;
  level: number;
  startLine: number;
  endLine: number;
  lineCount: number;
  hash: string;
  modified: boolean;
}

/** The content of `manifest.json`. */
export interface Manifest {
  version: string;
  sourceFile: string;
  sourceHash: string;
  /** Only in manifests of version 1.1.0. `split` no longer writes it (fix K2). */
  createdAt?: string;
  fileType: FileType;
  splitLevel: number;
  chunks: ChunkInfo[];
}

/** The manifest format version that `split` writes. */
export const MANIFEST_VERSION = "1.1.0";

/** The file name of the manifest in a chunk folder. */
export const MANIFEST_NAME = "manifest.json";

/** Returns a 32-bit hash of `content` as 8 hex digits. Detects changes to a chunk. */
export function contentHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = (hash << 5) - hash + content.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/**
 * Returns the path of `sourcePath` relative to the manifest folder, with `/` separators. The
 * manifest then stays valid when the source file and the chunk folder move together (fix K1).
 */
export function relativeSource(manifestDir: string, sourcePath: string): string {
  return relative(manifestDir, sourcePath).split(sep).join("/");
}

/**
 * Returns the absolute source path of a manifest. A relative `sourceFile` resolves against the
 * manifest folder. An absolute `sourceFile` (an old manifest) stays as it is.
 */
export function resolveSource(manifestDir: string, sourceFile: string): string {
  return resolve(manifestDir, sourceFile);
}

/** Reads and parses a manifest file. Throws on a read error or on invalid JSON. */
export function readManifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

/** Writes `manifest` to `path` as JSON with 2-space indentation. */
export function writeManifest(path: string, manifest: Manifest): void {
  writeLf(path, JSON.stringify(manifest, null, 2));
}
