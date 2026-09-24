/**
 * Fix F4: dependency-graph.yaml is built with js-yaml 5, which has no `quotingType` option. The
 * YAML of each golden set must equal the golden file byte for byte under the pinned js-yaml 5.
 * The typecheck rejects a `quotingType` option, because the js-yaml 5 types do not declare it.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "../../src/depgraph/index.ts";

const repo = join(import.meta.dir, "../..");
const work = mkdtempSync(join(tmpdir(), "repo-tools-f4-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** The version of the js-yaml copy that the reporter loads. */
function loadedJsYamlVersion(): string {
  let dir = dirname(Bun.resolveSync("js-yaml", join(repo, "src/depgraph/reporters")));
  while (dir !== dirname(dir)) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      const data = JSON.parse(readFileSync(pkg, "utf8")) as { name?: string; version: string };
      if (data.name === "js-yaml") return data.version;
    }
    dir = dirname(dir);
  }
  throw new Error("js-yaml package.json not found");
}

describe("F4: the YAML report is built with js-yaml 5", () => {
  test("package.json pins js-yaml 5 exactly, and that copy is the one loaded", () => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["js-yaml"]).toMatch(/^5\.\d+\.\d+$/);
    expect(loadedJsYamlVersion()).toBe(pkg.dependencies["js-yaml"] as string);
  });

  for (const [set, fixture, flags] of [
    ["mini-repo/default", "mini-repo", []],
    ["mini-repo/all", "mini-repo", ["--all"]],
    ["mono-repo/default", "mono-repo", []],
    ["mono-repo/all", "mono-repo", ["--all"]],
  ] as const) {
    test(`${set}: dependency-graph.yaml equals the golden file`, async () => {
      const root = join(work, set.replace("/", "-"));
      cpSync(join(repo, "tests/fixtures/depgraph", fixture), root, { recursive: true });
      await run([`--root=${root}`, ...flags], { stdout: () => {}, stderr: () => {} });
      const got = readFileSync(join(root, "docs/architecture/dependency-graph.yaml"), "utf8");
      const want = readFileSync(join(repo, "tests/golden/depgraph", set, "dependency-graph.yaml"));
      expect(got).toBe(want.toString("utf8"));
    });
  }
});
