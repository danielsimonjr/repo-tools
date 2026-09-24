/**
 * The chunk manifest: its types, its hash and its file I/O (design section 4).
 *
 * A manifest lives in the chunk folder as `manifest.json`. It records the source file, the file
 * type and one entry for each chunk file.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { posix, relative, resolve, sep, win32 } from "node:path";
import { toJson, writeLf } from "../io.ts";
import type { JsonLayout } from "./splitters.ts";

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
  /**
   * Only for a JSON object: the text around the top-level members (fix K8). `merge` puts the
   * chunk members back into it, so the file comes back byte for byte. A manifest without this
   * field merges as before, by object.
   */
  jsonLayout?: JsonLayout;
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
  return validateManifest(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Returns true when `name` is a plain file name: not empty, not `.` or `..`, and without a path
 * separator, a drive colon or a NUL. A chunk file name must be plain, so that a manifest cannot
 * make `merge` or `status` read a file outside the chunk folder.
 */
export function isPlainFileName(name: string): boolean {
  if (name === "" || name === "." || name === ".." || name.includes("\u0000")) return false;
  return !/[/\\:]/.test(name);
}

/**
 * Returns true when `path` is absolute or drive-relative on POSIX or on Windows. The check does
 * not depend on the OS of the run, so one manifest gives one result on each machine.
 */
export function isAbsoluteAnywhere(path: string): boolean {
  return posix.isAbsolute(path) || win32.isAbsolute(path) || /^[A-Za-z]:/.test(path);
}

function fail(message: string): never {
  throw new Error(`invalid manifest: ${message}`);
}

/**
 * Checks the shape of a parsed manifest and returns it as a `Manifest`. Throws an error that
 * starts with "invalid manifest" on a bad shape, an unsafe chunk file name or an absolute
 * `sourceFile` in a 2.x manifest. A 1.x manifest can hold an absolute `sourceFile`.
 */
export function validateManifest(value: unknown): Manifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("the manifest must be a JSON object");
  }
  const m = value as Record<string, unknown>;
  if (typeof m.version !== "string") fail("version must be a string");
  const version = m.version;
  if (!version.startsWith("1.") && !version.startsWith("2.")) {
    throw new Error(`unsupported manifest version ${version} (this build reads 1.x and 2.x)`);
  }
  if (typeof m.sourceFile !== "string" || m.sourceFile === "") {
    fail("sourceFile must be a non-empty string");
  }
  if (version.startsWith("2.") && isAbsoluteAnywhere(m.sourceFile)) {
    fail("a 2.x manifest cannot hold an absolute sourceFile");
  }
  if (
    m.fileType !== undefined &&
    !["markdown", "json", "typescript"].includes(String(m.fileType))
  ) {
    fail("fileType must be markdown, json or typescript");
  }
  if (!Array.isArray(m.chunks)) fail("chunks must be an array");
  m.chunks.forEach((chunk: unknown, i: number) => {
    if (typeof chunk !== "object" || chunk === null) fail(`chunks[${i}] must be an object`);
    const c = chunk as Record<string, unknown>;
    if (typeof c.filename !== "string") fail(`chunks[${i}].filename must be a string`);
    if (!isPlainFileName(c.filename)) {
      fail(`chunks[${i}] has an unsafe chunk file name ${JSON.stringify(c.filename)}`);
    }
    if (typeof c.hash !== "string") fail(`chunks[${i}].hash must be a string`);
  });
  if (m.jsonLayout !== undefined) {
    const l = m.jsonLayout as Record<string, unknown> | null;
    const valid =
      typeof l === "object" &&
      l !== null &&
      typeof l.prefix === "string" &&
      typeof l.suffix === "string" &&
      Array.isArray(l.separators) &&
      l.separators.every((s) => typeof s === "string") &&
      l.separators.length === Math.max(m.chunks.length - 1, 0);
    if (!valid) fail("jsonLayout needs prefix, suffix and one separator between two chunks");
  }
  return m as unknown as Manifest;
}

/** Writes `manifest` to `path` as JSON with 2-space indentation and one trailing LF. */
export function writeManifest(path: string, manifest: Manifest): void {
  writeLf(path, toJson(manifest));
}
