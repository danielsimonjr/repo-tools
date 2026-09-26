/**
 * Rewrites the `repo-tools map` goldens from the current code (run this in the commit of a named
 * change).
 *
 *   bun scripts/update-map-goldens.ts
 *
 * For each golden set, the script runs `map` on a copy of the fixture and writes every report,
 * `_exit-code.txt` and `_stdout.txt`, masked with `maskGolden`. It also writes the API-surface
 * report of the mini-repo fixture (`mini-repo/api-surface.json`). Review the diff: each hunk must
 * belong to the change that the commit names.
 */
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMap } from "../src/map/command.ts";
import { API_SURFACE_FILE, GOLDEN_FLAGS, maskGolden } from "./update-depgraph-goldens.ts";

/** The golden sets of `map`: one run of each fixture. */
export const MAP_GOLDEN_SETS = [
  { set: "mini-repo/default", fixture: "mini-repo" },
  { set: "mono-repo/default", fixture: "mono-repo" },
];

/** Runs `map` on `root` with `flags`; returns the exit code and the standard output. */
async function map(root: string, flags: string[]): Promise<{ code: number; stdout: string }> {
  let stdout = "";
  const code = await runMap([`--root=${root}`, ...GOLDEN_FLAGS, ...flags], {
    stdout: (s) => {
      stdout += s;
    },
    stderr: () => {},
  });
  return { code, stdout };
}

async function main(): Promise<void> {
  const repo = join(import.meta.dir, "..");
  const work = mkdtempSync(join(tmpdir(), "repo-tools-map-goldens-"));
  try {
    for (const { set, fixture } of MAP_GOLDEN_SETS) {
      // The folder name is the graph name, so it is the fixture name, as in the smoke test.
      const root = join(work, set.replace("/", "-"), fixture);
      cpSync(join(repo, "tests/fixtures/depgraph", fixture), root, { recursive: true });
      const { code, stdout } = await map(root, []);
      const dest = join(repo, "tests/golden/map", set);
      mkdirSync(dest, { recursive: true });
      for (const old of readdirSync(dest)) {
        if (!old.startsWith("_")) rmSync(join(dest, old));
      }
      const out = join(root, "docs/architecture");
      for (const name of readdirSync(out)) {
        writeFileSync(join(dest, name), maskGolden(readFileSync(join(out, name), "utf8"), root));
      }
      writeFileSync(join(dest, "_exit-code.txt"), `${code}\n`);
      writeFileSync(join(dest, "_stdout.txt"), maskGolden(stdout, root));
      console.log(`${set}: exit ${code}`);
    }
    const apiRoot = join(work, "api-surface", "mini-repo");
    cpSync(join(repo, "tests/fixtures/depgraph/mini-repo"), apiRoot, { recursive: true });
    const api = await map(apiRoot, [`--api-surface=${API_SURFACE_FILE}`]);
    writeFileSync(
      join(repo, "tests/golden/map/mini-repo", API_SURFACE_FILE),
      maskGolden(readFileSync(join(apiRoot, API_SURFACE_FILE), "utf8"), apiRoot),
    );
    console.log(`mini-repo/${API_SURFACE_FILE}: exit ${api.code}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.main) await main();
