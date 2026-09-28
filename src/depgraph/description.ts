/**
 * The file description that the subsystem reports show: the first line of a JSDoc block or of a
 * `//` comment, else a description made from the file name.
 */
import { basename, dirname } from "node:path";
import { stripComments } from "../mask.ts";
import { withoutTsExtension } from "./paths.ts";
import type { ParsedFile } from "./types.ts";

/** A line of three or more separator characters (`===`, `---`, `***`). */
const RULE_LINE = /^[=\-*~#_]{3,}$/;

/**
 * The description of a file: the first text line of its first JSDoc block, else the text of
 * its first `//` line. At most 120 characters. Returns null when neither exists.
 */
export function extractDescription(content: string): string | null {
  const jsdocMatch = content.match(/\/\*\*\s*\n([^*]*(?:\*(?!\/)[^*]*)*)\*\//);
  if (jsdocMatch) {
    const lines = (jsdocMatch[1] ?? "")
      .split("\n")
      .map((line) => line.replace(/^\s*\*\s?/, "").trim())
      .map((line) => {
        // `@scope/pkg - description` lines give their description part.
        if (line.startsWith("@") && line.includes(" - ")) {
          return line.split(" - ").slice(1).join(" - ").trim();
        }
        return line;
      })
      .filter((line) => !line.startsWith("@") && line.length > 0)
      .filter((line) => !RULE_LINE.test(line));
    if (lines.length > 0) return (lines[0] ?? "").slice(0, 120);
  }
  const singleLineMatch = content.match(/^\/\/\s*(.+)$/m);
  if (singleLineMatch) {
    const desc = (singleLineMatch[1] ?? "").trim();
    if (RULE_LINE.test(desc)) return null;
    return desc.slice(0, 120);
  }
  return null;
}

/**
 * Cleans one export name: removes comments, collapses white space, and removes a leading
 * `type ` keyword when the text holds no `{`.
 */
export function cleanExportName(name: string): string {
  let cleaned = stripComments(name);
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (cleaned.startsWith("type ") && !cleaned.includes("{")) cleaned = cleaned.slice(5).trim();
  return cleaned;
}

/** A description made from the file name and the export counts, for a file with none. */
export function generateFallbackDescription(file: ParsedFile): string {
  const fileName = withoutTsExtension(basename(file.path));
  if (fileName === "index") {
    if (file.exports.reExported.length > 0) {
      const pkgName = file.packageName || dirname(file.path).split("/").pop() || "";
      return `Package entry point for ${pkgName || "module"} (re-exports ${file.exports.reExported.length} symbols)`;
    }
    if (file.exports.named.length > 0) {
      return `Entry point exporting ${file.exports.named.length} symbols`;
    }
    return "Package entry point";
  }
  const hasOnlyTypes =
    file.exports.named.length === 0 &&
    !file.exports.default &&
    (file.exports.interfaces.length > 0 || file.exports.types.length > 0);
  if (hasOnlyTypes) {
    const aliases = file.exports.types.filter((t) => !file.exports.interfaces.includes(t)).length;
    return `Type definitions (${file.exports.interfaces.length} interfaces, ${aliases} type aliases)`;
  }
  return `${fileName} module`;
}
