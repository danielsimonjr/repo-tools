import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A string field of the package.json in `root`, or null. A missing, malformed or non-object
 * package.json is no error, and an empty or non-string field counts as absent. Every report takes
 * the project name from here, so all reports of one repository agree.
 */
export function packageField(root: string, key: string): string | null {
  let pkg: unknown = null;
  try {
    pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  } catch {
    // No readable package.json: the caller falls back.
  }
  if (typeof pkg !== "object" || pkg === null || Array.isArray(pkg)) return null;
  const value = (pkg as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
