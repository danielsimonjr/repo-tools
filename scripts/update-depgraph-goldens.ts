/**
 * Rewrites the depgraph goldens from the current code (run this in the commit of a named fix).
 *
 *   bun scripts/update-depgraph-goldens.ts
 *
 * For each golden set, the script runs `depgraph` on a copy of the fixture and writes every
 * report, `_exit-code.txt` and `_stdout.port.txt`, masked as `tests/golden/depgraph/README.md`
 * describes. It never touches `_stdout.txt`, the pre-port reference. It also writes the
 * API-surface report of the mini-repo fixture (`mini-repo/api-surface.json`, design section 6.2).
 * Review the diff: each hunk must belong to the fix that the commit names.
 */
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/depgraph/index.ts";

export const GOLDEN_SETS = [
  { set: "mini-repo/default", fixture: "mini-repo", flags: [] as string[] },
  { set: "mini-repo/all", fixture: "mini-repo", flags: ["--all"] },
  { set: "mono-repo/default", fixture: "mono-repo", flags: [] as string[] },
  { set: "mono-repo/all", fixture: "mono-repo", flags: ["--all"] },
];

/** The file name of the API-surface golden of the mini-repo fixture. */
export const API_SURFACE_FILE = "api-surface.json";

/** The golden masking: the fixture root in both separator forms, date-times and dates. */
export function maskGolden(text: string, root: string): string {
  return text
    .split(root)
    .join("<ROOT>")
    .split(root.split("\\").join("/"))
    .join("<ROOT>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<DATETIME>")
    .replace(/\d{4}-\d{2}-\d{2}/g, "<DATE>");
}

async function main(): Promise<void> {
  const repo = join(import.meta.dir, "..");
  const work = mkdtempSync(join(tmpdir(), "repo-tools-goldens-"));
  try {
    for (const { set, fixture, flags } of GOLDEN_SETS) {
      const root = join(work, set.replace("/", "-"));
      cpSync(join(repo, "tests/fixtures/depgraph", fixture), root, { recursive: true });
      let stdout = "";
      const code = await run([`--root=${root}`, ...flags], {
        stdout: (s) => {
          stdout += s;
        },
        stderr: () => {},
      });
      const dest = join(repo, "tests/golden/depgraph", set);
      for (const old of readdirSync(dest)) {
        if (!old.startsWith("_")) rmSync(join(dest, old));
      }
      const out = join(root, "docs/architecture");
      for (const name of readdirSync(out)) {
        writeFileSync(join(dest, name), maskGolden(readFileSync(join(out, name), "utf8"), root));
      }
      writeFileSync(join(dest, "_exit-code.txt"), `${code}\n`);
      writeFileSync(join(dest, "_stdout.port.txt"), maskGolden(stdout, root));
      console.log(`${set}: exit ${code}`);
    }
    const apiRoot = join(work, "api-surface");
    cpSync(join(repo, "tests/fixtures/depgraph/mini-repo"), apiRoot, { recursive: true });
    const apiCode = await run([`--root=${apiRoot}`, `--api-surface=${API_SURFACE_FILE}`], {
      stdout: () => {},
      stderr: () => {},
    });
    writeFileSync(
      join(repo, "tests/golden/depgraph/mini-repo", API_SURFACE_FILE),
      maskGolden(readFileSync(join(apiRoot, API_SURFACE_FILE), "utf8"), apiRoot),
    );
    console.log(`mini-repo/${API_SURFACE_FILE}: exit ${apiCode}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.main) await main();
