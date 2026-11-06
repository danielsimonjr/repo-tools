/**
 * The Markdown documents of a docs folder, read for `repo-tools check` and for the Verification
 * writer of `repo-tools map`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDirectory } from "../depgraph/paths.ts";
import { sortCodeUnits } from "../sort.ts";
import type { DocFile } from "./verify.ts";

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Reads the Markdown documents of `dir`, in code-unit order. `label` names the folder. */
export function readDocs(dir: string, label: string): DocFile[] {
  if (!isDirectory(dir)) {
    throw new Error(`the docs folder ${label} does not exist or is not a folder`);
  }
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    throw new Error(`cannot read the docs folder ${label}`);
  }
  // The ending matches in any letter case: a skipped `X.MD` would be a silent pass.
  const names = sortCodeUnits(entries.filter((name) => /\.md$/i.test(name)));
  if (names.length === 0) {
    throw new Error(
      `the docs folder ${label} holds no *.md file -- nothing to verify. This is a failure, ` +
        "not a pass: an empty folder can mean that the documents moved or were never written.",
    );
  }
  return names.map((name) => {
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(join(dir, name));
    } catch {
      throw new Error(`cannot read ${label}/${name}`);
    }
    try {
      return { name, text: decoder.decode(bytes) };
    } catch {
      throw new Error(`${label}/${name} is not valid UTF-8`);
    }
  });
}
