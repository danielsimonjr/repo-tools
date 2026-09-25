/**
 * Fix F20: no stale compiled binary is committed. The privacy check fails the whole run when the
 * git index of a repository tracks a `.exe` file, and this repository tracks none.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCheck } from "../../scripts/privacy-check.ts";
import { makeTempDir } from "./temp.ts";

/** Runs git in `cwd` and throws on a non-zero exit. Returns standard output. */
function git(cwd: string, args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

describe("F20: a tracked .exe fails the privacy check", () => {
  test("a repository that tracks a compiled .exe gets a binary finding", async () => {
    const dir = makeTempDir("f20");
    try {
      git(dir, ["init", "-q", "-b", "main"]);
      git(dir, ["config", "core.autocrlf", "false"]);
      mkdirSync(join(dir, "scripts"));
      mkdirSync(join(dir, "tools"));
      writeFileSync(join(dir, "scripts/privacy-denylist.sha256"), "");
      writeFileSync(join(dir, "tools/depgraph.exe"), Buffer.from([77, 90, 0, 0]));
      git(dir, ["add", "."]);
      const findings = await runCheck(dir);
      expect(findings.map((f) => [f.file, f.rule])).toEqual([["tools/depgraph.exe", "binary"]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("this repository tracks no .exe file", () => {
    const tracked = git(join(import.meta.dir, "../.."), ["ls-files", "-z"]).split("\0");
    expect(tracked.filter((f) => /\.exe$/i.test(f))).toEqual([]);
  });
});
