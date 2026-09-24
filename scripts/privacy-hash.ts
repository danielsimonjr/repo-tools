/**
 * Prints denylist lines (`<sha256-hex> <category>`) for the privacy check.
 *
 * Usage:
 *   bun scripts/privacy-hash.ts <category> <token...>   hash the given tokens
 *   bun scripts/privacy-hash.ts --from <file>           hash a `<category> <token>` word list
 *
 * Keep the plaintext word list OUT of the repository. Commit only the output. A token must be
 * one word the checker can produce (`[A-Za-z0-9_-]+`); any other entry could never match.
 */
import { readFileSync } from "node:fs";
import { hashToken } from "./privacy-check.ts";

const WORD = /^[A-Za-z0-9_-]+$/;

/** Returns the denylist lines, sorted and unique. Throws on an entry that can never match. */
export function denylistLines(pairs: string[][]): string {
  const out = pairs.map((fields, index) => {
    const [category, token] = fields;
    if (fields.length !== 2 || !category || !token) {
      throw new Error(`entry ${index + 1}: expected exactly '<category> <token>'`);
    }
    if (category !== "person" && category !== "private") {
      throw new Error(`entry ${index + 1}: unknown category (use person or private)`);
    }
    if (!WORD.test(token)) {
      throw new Error(`entry ${index + 1}: not one word; the checker can never match it`);
    }
    return `${hashToken(token)} ${category}`;
  });
  return `${[...new Set(out)].sort().join("\n")}\n`;
}

if (import.meta.main) {
  const [first, ...rest] = process.argv.slice(2);
  try {
    if (first === "--from" && rest[0]) {
      const pairs = readFileSync(rest[0], "utf8")
        .split(/\r?\n/)
        .map((l) => l.replace(/#.*/, "").trim())
        .filter(Boolean)
        .map((l) => l.split(/\s+/));
      process.stdout.write(denylistLines(pairs));
    } else if (first && rest.length > 0) {
      process.stdout.write(denylistLines(rest.map((t) => [first, t])));
    } else {
      throw new Error("usage: privacy-hash.ts <person|private> <token...> | --from <word-list>");
    }
  } catch (e) {
    console.error(`privacy-hash: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
