import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { isPidAlive, makeTempDir, sweepStaleTempDirs } from "./temp.ts";

/** A private base folder, so the sweep tests never touch another run's folders. */
const base = mkdtempSync(join(tmpdir(), "temp-helper-test-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

/** Makes the folder `name` in the private base and returns its path. */
function dir(name: string): string {
  const path = join(base, name);
  mkdirSync(path);
  return path;
}

describe("makeTempDir", () => {
  test("the folder name carries the tag and the PID of this run", () => {
    const made = makeTempDir("probe");
    try {
      expect(existsSync(made)).toBe(true);
      expect(basename(made)).toMatch(new RegExp(`^repo-tools-test-probe-${process.pid}-\\w{6}$`));
    } finally {
      rmSync(made, { recursive: true, force: true });
    }
  });
});

describe("isPidAlive", () => {
  test("this process is alive, and an exited child is not", () => {
    expect(isPidAlive(process.pid)).toBe(true);
    const child = Bun.spawnSync([process.execPath, "-e", ""]);
    expect(child.exitCode).toBe(0);
    expect(isPidAlive(child.pid)).toBe(false);
  });
});

describe("sweepStaleTempDirs", () => {
  test("removes the folders of dead runs and keeps the folders of live runs", () => {
    const dead = dir("repo-tools-test-dg-4000001-aB3dEf");
    const live = dir(`repo-tools-test-dg-${process.pid}-aB3dEf`);
    const other = dir("someone-else-4000001-aB3dEf");
    const removed = sweepStaleTempDirs(base, (pid) => pid === process.pid);
    expect(removed).toEqual([dead]);
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });

  test("removes a legacy folder (no PID) only when it is older than one day", () => {
    const oldLegacy = dir("repo-tools-dg-Qw3rTy");
    const newLegacy = dir("repo-tools-dg-Zx9cVb");
    const twoDaysAgo = (Date.now() - 2 * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(oldLegacy, twoDaysAgo, twoDaysAgo);
    const removed = sweepStaleTempDirs(base, () => true);
    expect(removed).toEqual([oldLegacy]);
    expect(existsSync(newLegacy)).toBe(true);
  });

  test("a run that exits without cleanup leaves a folder that the next sweep removes", () => {
    const script = [
      `const { makeTempDir } = await import(${JSON.stringify(join(import.meta.dir, "temp.ts"))});`,
      "process.stdout.write(makeTempDir('killed'));",
    ].join("\n");
    const child = Bun.spawnSync([process.execPath, "-e", script]);
    const left = child.stdout.toString();
    expect(child.exitCode).toBe(0);
    expect(existsSync(left)).toBe(true);
    expect(sweepStaleTempDirs()).toContain(left);
    expect(existsSync(left)).toBe(false);
  });
});
