/**
 * Fix F4: dependency-graph.yaml is built with js-yaml 5, which has no `quotingType` option.
 * The typecheck rejects a `quotingType` option, because the js-yaml 5 types do not declare it.
 * Byte comparison of the YAML lives with the map goldens.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const repo = join(import.meta.dir, "../..");

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
});
