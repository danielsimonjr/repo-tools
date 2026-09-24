/**
 * The chunk manifest: its types, its hash and its file I/O (design section 4).
 *
 * A manifest lives in the chunk folder as `manifest.json`. It records the source file, the file
 * type and one entry for each chunk file.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { toJson, writeLf } from "../io.ts";

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

/**
 * The manifest format version that `split` writes. Version 2.0.0 has a relative `sourceFile`
 * (K1), no `createdAt` (K2) and SHA-256 hashes (K3). A 1.x reader cannot read it.
 */
export const MANIFEST_VERSION = "2.0.0";

/** The file name of the manifest in a chunk folder. */
export const MANIFEST_NAME = "manifest.json";

/**
 * Returns the SHA-256 of the UTF-8 bytes of `content` as 64 hex digits. Detects changes to a
 * chunk or to the source file (fix K3: the old 32-bit hash let edits such as "Aa" to "BB" pass
 * as unchanged).
 */
export function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * The 32-bit hash of the original chunker, as 8 hex digits. Only 1.x manifests use it; `merge`
 * and `status` need it to compare the chunks of such a manifest.
 */
export function legacyHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/** Returns the hash function that made the hashes of `manifest`. */
export function hashFor(manifest: Manifest): (content: string) => string {
  return manifest.version.startsWith("1.") ? legacyHash : contentHash;
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

/**
 * Reads and parses a manifest file. Accepts versions 1.x and 2.x. Throws on a read error, on
 * invalid JSON and on another version.
 */
export function readManifest(path: string): Manifest {
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Manifest;
  const version = String(manifest.version);
  if (!version.startsWith("1.") && !version.startsWith("2.")) {
    throw new Error(`unsupported manifest version ${version} (this build reads 1.x and 2.x)`);
  }
  return manifest;
}

/** Writes `manifest` to `path` as JSON with 2-space indentation and one trailing LF. */
export function writeManifest(path: string, manifest: Manifest): void {
  writeLf(path, toJson(manifest));
}
