/**
 * Deterministic file output. Every file that repo-tools writes has LF line endings, so two
 * runs on two operating systems give the same bytes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Writes `text` with CRLF and CR converted to LF. Creates the parent folder. */
export function writeLf(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text.replace(/\r\n?/g, "\n"));
}

/** Returns `value` as JSON with 2-space indentation and one trailing LF. Key order is kept. */
export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
