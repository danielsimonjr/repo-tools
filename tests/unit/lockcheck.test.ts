/** The build refuses a `node_modules` tree that does not match `bun.lock` (task D11). */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkInstalledTree, lockPackageDir } from "../../scripts/lockcheck.ts";
import { makeTempDir } from "./temp.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A bun.lock with a scoped package, a nested package and a platform-only package. */
const LOCK = `{
  "lockfileVersion": 2,
  "workspaces": { "": { "name": "fx", "dependencies": { "a": "1.0.0" } } },
  "packages": {
    "@s/b": ["@s/b@2.0.0", "", {}, "sha512-x"],

    "a": ["a@1.0.0", "", { "dependencies": { "c": "1.0.0" } }, "sha512-x"],

    "a/c": ["c@1.0.0", "", {}, "sha512-x"],

    "c": ["c@3.0.0", "", {}, "sha512-x"],

    "plat": ["plat@1.0.0", "", { "os": "aix", "cpu": "ppc64" }, "sha512-x"],
  }
}
`;

/** Writes a project with `bun.lock` and the installed packages `installed` (dir to version). */
function project(installed: Record<string, string>): string {
  const root = makeTempDir("lockcheck");
  made.push(root);
  writeFileSync(join(root, "bun.lock"), LOCK);
  for (const [dir, version] of Object.entries(installed)) {
    const file = join(root, dir, "package.json");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ name: dir.split("node_modules/").pop(), version }));
  }
  return root;
}

const MATCHING: Record<string, string> = {
  "node_modules/@s/b": "2.0.0",
  "node_modules/a": "1.0.0",
  "node_modules/a/node_modules/c": "1.0.0",
  "node_modules/c": "3.0.0",
};

describe("lockPackageDir", () => {
  test("maps a lock key to its folder, scoped and nested keys included", () => {
    expect(lockPackageDir("a")).toBe("node_modules/a");
    expect(lockPackageDir("@s/b")).toBe("node_modules/@s/b");
    expect(lockPackageDir("a/c")).toBe("node_modules/a/node_modules/c");
    expect(lockPackageDir("@s/b/@t/d")).toBe("node_modules/@s/b/node_modules/@t/d");
  });
});

describe("checkInstalledTree", () => {
  test("a tree that matches the lockfile has no problem (control)", () => {
    expect(checkInstalledTree(project(MATCHING))).toEqual([]);
  });

  test("a stale nested package that the lockfile does not name is a problem", () => {
    const root = project({ ...MATCHING, "node_modules/a/node_modules/old": "4.3.2" });
    expect(checkInstalledTree(root)).toEqual([
      "node_modules/a/node_modules/old (4.3.2) is not in bun.lock",
    ]);
  });

  test("an installed version that differs from the lockfile is a problem", () => {
    const root = project({ ...MATCHING, "node_modules/a/node_modules/c": "0.9.0" });
    expect(checkInstalledTree(root)).toEqual([
      "node_modules/a/node_modules/c is 0.9.0, bun.lock has 1.0.0",
    ]);
  });

  test("a missing package is a problem, but a missing platform-only package is not", () => {
    const { "node_modules/c": _, ...withoutC } = MATCHING;
    expect(checkInstalledTree(project(withoutC))).toEqual([
      "node_modules/c (3.0.0) is in bun.lock but not installed",
    ]);
  });

  test("no node_modules folder is one problem", () => {
    expect(checkInstalledTree(project({}))).toEqual([
      "node_modules is missing: run bun install --frozen-lockfile",
    ]);
  });
});

describe("the build refuses a stale tree", () => {
  const build = join(import.meta.dir, "../../scripts/build.ts");

  test("--compile exits 1 and names the stale package, before it compiles", () => {
    const root = project({ ...MATCHING, "node_modules/a/node_modules/old": "4.3.2" });
    const r = Bun.spawnSync([process.execPath, build, "--compile", "--outdir=out"], { cwd: root });
    expect(r.exitCode).toBe(1);
    const err = r.stderr.toString();
    expect(err).toContain("node_modules does not match bun.lock");
    expect(err).toContain("node_modules/a/node_modules/old (4.3.2) is not in bun.lock");
    expect(err).toContain("bun install --frozen-lockfile");
  });

  test("the bundle build refuses it too", () => {
    const root = project({ ...MATCHING, "node_modules/c": "2.0.0" });
    const r = Bun.spawnSync([process.execPath, build, "--outfile=out/cli.js"], { cwd: root });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("node_modules/c is 2.0.0, bun.lock has 3.0.0");
  });
});
