/**
 * The config keys and the flags of D10a in the depgraph pipeline: `--src`, `--tests`, `--out`,
 * `--exclude`, `--also-exclude`, and the config keys `strictOrphans`, `regenerateCommand`,
 * `verificationMarker`, `duplicateAllowlist` and `coveragePolicy`. Path flags and config paths
 * resolve against the root.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE } from "../../src/config.ts";
import { parseDepgraphArgs } from "../../src/depgraph/index.ts";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

const PKG = JSON.stringify({ name: "wire", version: "1.0.0" });

/** Reads the report `name` in the output folder `out` of `root`. */
function readOut(root: string, out: string, name: string): string {
  return readFileSync(join(root, out, name), "utf8");
}

/** The file paths of every module in `dependency-graph.json`. */
function graphPaths(json: string): string[] {
  const graph = JSON.parse(json) as { modules: Record<string, Record<string, unknown>> };
  return Object.values(graph.modules).flatMap((files) => Object.keys(files));
}

/** Writes `config` as the depgraph section of the config file. */
function config(depgraph: object): string {
  return JSON.stringify({ depgraph });
}

describe("the D10a list and path flags parse", () => {
  test("each list flag splits on commas", () => {
    const o = parseDepgraphArgs(
      ["--src=lib,app", "--tests=spec", "--out=out", "--exclude=a,b", "--also-exclude=c"],
      "cwd",
    );
    expect(o.settings).toEqual({
      src: ["lib", "app"],
      tests: ["spec"],
      out: "out",
      exclude: ["a", "b"],
      alsoExclude: ["c"],
    });
    expect(parseDepgraphArgs(["--src=auto"], "cwd").settings.src).toBe("auto");
  });

  test("an empty list item and an absolute path are invalid values", () => {
    expect(() => parseDepgraphArgs(["--src=a,,b"], "cwd")).toThrow(/--src.*empty item/);
    expect(() => parseDepgraphArgs(["--out=/abs"], "cwd")).toThrow(/--out.*absolute path/);
    expect(() => parseDepgraphArgs(["--tests=C:\\t"], "cwd")).toThrow(/--tests.*absolute path/);
  });
});

describe("--out and depgraph.out", () => {
  const tree = {
    "package.json": PKG,
    "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
  };

  test("--out writes every report into the folder under the root", async () => {
    const root = makeTree(tree);
    const r = await runDepgraph(root, ["--out=out/arch"]);
    expect(r.code).toBe(0);
    expect(existsSync(join(root, "out/arch/DEPENDENCY_GRAPH.md"))).toBe(true);
    expect(existsSync(join(root, "docs"))).toBe(false);
    expect(r.stdout).toContain("Written: out/arch/dependency-graph.json");
    expect(r.stdout).toContain("Created output directory: out/arch");
    expect(r.stdout).not.toContain(root);
  });

  test("depgraph.out does the same, and --out wins over it", async () => {
    const root = makeTree({ ...tree, [CONFIG_FILE]: config({ out: "from-config" }) });
    expect((await runDepgraph(root)).code).toBe(0);
    expect(existsSync(join(root, "from-config/DEPENDENCY_GRAPH.md"))).toBe(true);
    expect((await runDepgraph(root, ["--out=from-flag"])).code).toBe(0);
    expect(existsSync(join(root, "from-flag/DEPENDENCY_GRAPH.md"))).toBe(true);
  });

  test("--check-census reads the inventory in the --out folder", async () => {
    const root = makeTree(tree);
    await runDepgraph(root, ["--out=o"]);
    expect((await runDepgraph(root, ["--out=o", "--check-census"])).code).toBe(0);
  });
});

describe("--src and depgraph.src", () => {
  const tree = {
    "package.json": PKG,
    "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
    "lib/a.ts": "/** A. */\nexport const a = 1;\n",
    "lib/b.test.ts": "import { a } from './a.js';\n",
  };

  test("--src replaces the automatic source roots, and the census walks them", async () => {
    const root = makeTree(tree);
    const r = await runDepgraph(root, ["--src=lib"]);
    expect(r.code).toBe(0);
    const paths = graphPaths(readOut(root, "docs/architecture", "dependency-graph.json"));
    expect(paths).toContain("lib/a.ts");
    expect(paths).not.toContain("src/index.ts");
    const inventory = readOut(root, "docs/architecture", "file-inventory.json");
    expect(inventory).toContain('"lib/a.ts"');
    // The tests under a configured source root count.
    const coverage = JSON.parse(readOut(root, "docs/architecture", "test-coverage.json"));
    expect(coverage.testedFiles).toEqual(["lib/a.ts"]);
    expect(r.stdout).toContain("  lib: 1 files");
  });

  test("depgraph.src does the same", async () => {
    const root = makeTree({ ...tree, [CONFIG_FILE]: config({ src: ["lib"] }) });
    expect((await runDepgraph(root)).code).toBe(0);
    const paths = graphPaths(readOut(root, "docs/architecture", "dependency-graph.json"));
    expect(paths).toEqual(["lib/a.ts"]);
  });
});

describe("--tests and depgraph.tests", () => {
  const tree = {
    "package.json": PKG,
    "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
    "spec/index.test.ts": "import { main } from '../src/index.js';\n",
  };

  test("by default a spec/ folder holds no test", async () => {
    const root = makeTree(tree);
    await runDepgraph(root);
    const coverage = JSON.parse(readOut(root, "docs/architecture", "test-coverage.json"));
    expect(coverage.testedFiles).toEqual([]);
  });

  test("--tests=spec reads its tests, and depgraph.tests does the same", async () => {
    const root = makeTree(tree);
    await runDepgraph(root, ["--tests=spec"]);
    const flag = JSON.parse(readOut(root, "docs/architecture", "test-coverage.json"));
    expect(flag.testedFiles).toEqual(["src/index.ts"]);
    const root2 = makeTree({ ...tree, [CONFIG_FILE]: config({ tests: ["spec"] }) });
    await runDepgraph(root2);
    const cfg = JSON.parse(readOut(root2, "docs/architecture", "test-coverage.json"));
    expect(cfg.testedFiles).toEqual(["src/index.ts"]);
  });
});

describe("--exclude and --also-exclude", () => {
  const tree = {
    "package.json": PKG,
    "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
    "src/gen/g.ts": "/** Generated. */\nexport const g = 1;\n",
    "src/vendor/v.ts": "/** Vendored. */\nexport const v = 1;\n",
  };

  test("--also-exclude extends the skip list in the graph and the census", async () => {
    const root = makeTree(tree);
    expect((await runDepgraph(root, ["--also-exclude=gen"])).code).toBe(0);
    const paths = graphPaths(readOut(root, "docs/architecture", "dependency-graph.json"));
    expect(paths).not.toContain("src/gen/g.ts");
    expect(paths).toContain("src/vendor/v.ts");
    expect(readOut(root, "docs/architecture", "file-inventory.json")).not.toContain("src/gen/");
  });

  test("--exclude replaces the skip list; depgraph.alsoExclude extends it", async () => {
    const root = makeTree(tree);
    await runDepgraph(root, ["--exclude=vendor"]);
    const paths = graphPaths(readOut(root, "docs/architecture", "dependency-graph.json"));
    expect(paths).toContain("src/gen/g.ts");
    expect(paths).not.toContain("src/vendor/v.ts");
    const root2 = makeTree({ ...tree, [CONFIG_FILE]: config({ alsoExclude: ["gen", "vendor"] }) });
    await runDepgraph(root2);
    const paths2 = graphPaths(readOut(root2, "docs/architecture", "dependency-graph.json"));
    expect(paths2).toEqual(["src/index.ts"]);
  });
});

describe("depgraph.strictOrphans, the banner keys and the file keys", () => {
  const orphanTree = {
    "package.json": PKG,
    "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
    "src/lone.ts": "/** Nobody imports this. */\nexport const lone = 1;\n",
  };

  test("depgraph.strictOrphans makes an orphan fail the run", async () => {
    expect((await runDepgraph(makeTree(orphanTree))).code).toBe(0);
    const root = makeTree({ ...orphanTree, [CONFIG_FILE]: config({ strictOrphans: true }) });
    const r = await runDepgraph(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("src/lone.ts");
  });

  test("regenerateCommand and verificationMarker set the banner of every Markdown report", async () => {
    const root = makeTree({
      ...orphanTree,
      [CONFIG_FILE]: config({ regenerateCommand: "npm run docs:deps", verificationMarker: null }),
    });
    await runDepgraph(root);
    const banner =
      "<!-- GENERATED FILE -- do not edit by hand.\n     Regenerate with `npm run docs:deps`. -->\n\n";
    for (const name of [
      "DEPENDENCY_GRAPH.md",
      "duplicate-symbols.md",
      "TEST_COVERAGE.md",
      "unused-analysis.md",
      "FILE_INVENTORY.md",
    ]) {
      expect(readOut(root, "docs/architecture", name).startsWith(banner)).toBe(true);
    }
  });

  test("a custom verificationMarker is the first line", async () => {
    const root = makeTree({
      ...orphanTree,
      [CONFIG_FILE]: config({ verificationMarker: "<!-- x -->" }),
    });
    await runDepgraph(root);
    expect(readOut(root, "docs/architecture", "DEPENDENCY_GRAPH.md").split("\n")[0]).toBe(
      "<!-- x -->",
    );
  });

  const dupTree = {
    "package.json": PKG,
    "src/index.ts": "export { a } from './a.js';\nexport { b } from './b.js';\n",
    "src/a.ts": "/** A. */\nexport const VERSION = '1';\nexport const a = 1;\n",
    "src/b.ts": "/** B. */\nexport const VERSION = '2';\nexport const b = 1;\n",
  };
  const allow = JSON.stringify({
    entries: [{ names: ["VERSION"], filesGlob: ["src/**"], reason: "per-file version" }],
  });

  test("the allowlist is read from depgraph.duplicateAllowlist, else from the output folder", async () => {
    const dupOf = (root: string) =>
      JSON.parse(readOut(root, "docs/architecture", "duplicate-symbols.json")).runtime as Array<{
        name: string;
        tag: string;
      }>;
    const plain = makeTree(dupTree);
    await runDepgraph(plain);
    expect(dupOf(plain)).toEqual([
      expect.objectContaining({ name: "VERSION", tag: "TRUE_DUPLICATE" }),
    ]);
    const cfg = makeTree({
      ...dupTree,
      "cfg/allow.json": allow,
      [CONFIG_FILE]: config({ duplicateAllowlist: "cfg/allow.json" }),
    });
    await runDepgraph(cfg);
    expect(dupOf(cfg)).toEqual([expect.objectContaining({ name: "VERSION", tag: "ALLOWLISTED" })]);
    const byDefault = makeTree({ ...dupTree, "docs/architecture/duplicate-allowlist.json": allow });
    await runDepgraph(byDefault);
    expect(dupOf(byDefault)).toEqual([expect.objectContaining({ tag: "ALLOWLISTED" })]);
  });

  test("the coverage policy is read from depgraph.coveragePolicy", async () => {
    const policy = JSON.stringify({
      categories: { gen: { label: "Generated", rationale: "r", pathPrefixes: ["src/"] } },
    });
    const root = makeTree({
      ...orphanTree,
      "cfg/policy.json": policy,
      [CONFIG_FILE]: config({ coveragePolicy: "cfg/policy.json" }),
    });
    await runDepgraph(root);
    const coverage = JSON.parse(readOut(root, "docs/architecture", "test-coverage.json"));
    expect(coverage.metadata.effectiveCoverage.policyLoaded).toBe(true);
  });
});
