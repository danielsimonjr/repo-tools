/**
 * Test helper: temporary folders that a killed test run cannot leak for ever.
 *
 * A test file removes its folders in `afterAll` or `finally`. A killed `bun test` runs neither,
 * so its folders stay in the temp folder. No code in the killed process can prevent that. Thus
 * each folder name carries the PID of its run, and the first `makeTempDir` of each later run
 * removes the folders of runs that are no longer alive. A folder of a live run (for example, a
 * parallel run in another worktree) stays.
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A folder that `makeTempDir` made: the tag, the PID of the run, and the random suffix. */
const CURRENT_NAME = /^repo-tools-test-[a-z0-9-]+-(\d+)-[A-Za-z0-9]{6}$/;

/** A folder from before the PID names (no PID): removed only when older than `LEGACY_AGE_MS`. */
const LEGACY_NAME = /^(repo-tools-[a-z0-9-]+|privacy-(hook|repo|hash))-[A-Za-z0-9]{6}$/;

/** The age after which a legacy folder is stale. No test run lasts one day. */
const LEGACY_AGE_MS = 24 * 60 * 60 * 1000;

/** True after the first sweep of this process. */
let swept = false;

/** True when the process `pid` exists. A process of another user (EPERM) also counts as alive. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Removes the folders in `base` that a dead run left: a PID-named folder whose process is not
 * alive, and a legacy folder older than one day. Returns the removed paths.
 */
export function sweepStaleTempDirs(base = tmpdir(), isAlive = isPidAlive): string[] {
  const removed: string[] = [];
  for (const name of readdirSync(base).sort()) {
    const path = join(base, name);
    const current = CURRENT_NAME.exec(name);
    let stale: boolean;
    if (current) {
      stale = !isAlive(Number(current[1]));
    } else if (LEGACY_NAME.test(name)) {
      try {
        stale = Date.now() - statSync(path).mtimeMs > LEGACY_AGE_MS;
      } catch {
        continue;
      }
    } else {
      continue;
    }
    if (!stale) continue;
    rmSync(path, { recursive: true, force: true });
    removed.push(path);
  }
  return removed;
}

/** Makes a new temporary folder for the test tag `tag` and returns its path. */
export function makeTempDir(tag: string): string {
  if (!swept) {
    swept = true;
    sweepStaleTempDirs();
  }
  return mkdtempSync(join(tmpdir(), `repo-tools-test-${tag}-${process.pid}-`));
}
