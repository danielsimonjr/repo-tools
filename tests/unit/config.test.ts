/**
 * The config file `repo-tools.config.json` (design section 5.1): every key with its default and
 * type, the rejection of an unknown key, an absolute path, an unreadable file and invalid JSON,
 * the precedence (command line, then config file, then default) and the resolution of paths
 * against the root.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_FILE,
  type DepgraphConfig,
  loadConfigFile,
  mergeDepgraphConfig,
  parseConfig,
} from "../../src/config.ts";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

/** The defaults of design section 5.1 (the test folders keep both spellings; see `tests`). */
const DEFAULTS: DepgraphConfig = {
  src: "auto",
  tests: ["test", "tests"],
  out: "docs/architecture",
  exclude: ["node_modules", "dist", "build", "coverage", ".git"],
  alsoExclude: [],
  strictOrphans: false,
  duplicateAllowlist: "docs/architecture/duplicate-allowlist.json",
  duplicateBaseline: "docs/architecture/duplicate-baseline.json",
  coveragePolicy: "docs/architecture/coverage-policy.json",
  regenerateCommand: "repo-tools depgraph",
  verificationMarker: "<!-- repo-map:no-verification -->",
  apiSurface: {
    out: null,
    entry: "src/index.ts",
    stabilityTags: ["public", "internal", "experimental", "beta", "alpha"],
  },
  extensions: [],
};

/** A config that sets every key to a value other than its default. */
const EVERY_KEY = {
  depgraph: {
    src: ["lib", "app"],
    tests: ["spec"],
    out: "out/arch",
    exclude: ["vendor"],
    alsoExclude: ["gen"],
    strictOrphans: true,
    duplicateAllowlist: "cfg/allow.json",
    duplicateBaseline: "cfg/base.json",
    coveragePolicy: "cfg/policy.json",
    regenerateCommand: "npm run docs:deps",
    verificationMarker: null,
    apiSurface: { out: "api.json", entry: "lib/index.ts", stabilityTags: ["stable"] },
    extensions: ["tools/ext.mjs"],
  },
};

/** A small valid package, with `extra` files. */
function pkg(extra: Record<string, string> = {}): string {
  return makeTree({
    "package.json": JSON.stringify({ name: "cfg", version: "1.0.0" }),
    "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
    ...extra,
  });
}

describe("config file: keys, defaults and types", () => {
  test("with no config file, every key has its default", () => {
    expect(loadConfigFile(pkg())).toEqual({});
    expect(mergeDepgraphConfig({}, {})).toEqual(DEFAULTS);
  });

  test("every key of the table loads with its type", () => {
    const root = pkg({ [CONFIG_FILE]: JSON.stringify(EVERY_KEY) });
    const merged = mergeDepgraphConfig({}, loadConfigFile(root));
    expect(merged).toEqual(EVERY_KEY.depgraph);
  });

  test("the file defaults of the allowlist, baseline and policy follow the output folder", () => {
    const merged = mergeDepgraphConfig({}, { out: "reports" });
    expect([merged.duplicateAllowlist, merged.duplicateBaseline, merged.coveragePolicy]).toEqual([
      "reports/duplicate-allowlist.json",
      "reports/duplicate-baseline.json",
      "reports/coverage-policy.json",
    ]);
  });

  const invalid: Array<[string, unknown, RegExp]> = [
    ["an unknown top-level key", { depgraf: {} }, /unknown key 'depgraf'/],
    ["an unknown depgraph key", { depgraph: { sources: [] } }, /unknown key 'depgraph.sources'/],
    [
      "an unknown apiSurface key",
      { depgraph: { apiSurface: { file: "x" } } },
      /unknown key 'depgraph.apiSurface.file'/,
    ],
    ["a boolean of the wrong type", { depgraph: { strictOrphans: "yes" } }, /strictOrphans/],
    ["a list of the wrong type", { depgraph: { tests: "tests" } }, /depgraph.tests/],
    ["a src value that is not auto", { depgraph: { src: "all" } }, /depgraph.src/],
    ["an empty list item", { depgraph: { exclude: [""] } }, /depgraph.exclude/],
    ["a null out", { depgraph: { out: null } }, /depgraph.out/],
    ["a file that is not an object", [], /JSON object/],
  ];
  for (const [label, value, message] of invalid) {
    test(`${label} is an error`, () => {
      expect(() => parseConfig(value, "<root>/x.json")).toThrow(message);
    });
  }

  const absolute: Array<[string, unknown]> = [
    ["out", { out: "/abs/out" }],
    ["src", { src: ["C:\\abs\\src"] }],
    ["tests", { tests: ["C:/abs/tests"] }],
    ["coveragePolicy", { coveragePolicy: "\\\\host\\share\\p.json" }],
    ["apiSurface.entry", { apiSurface: { entry: "/abs/index.ts" } }],
    ["apiSurface.out", { apiSurface: { out: "D:\\api.json" } }],
    ["extensions", { extensions: ["/abs/ext.mjs"] }],
  ];
  for (const [key, depgraph] of absolute) {
    test(`an absolute path in ${key} is rejected`, () => {
      expect(() => parseConfig({ depgraph }, "<root>/x.json")).toThrow(/absolute path/);
    });
  }
});

describe("config file: precedence", () => {
  test("a command-line value wins over the config file, which wins over the default", () => {
    const file = { out: "file-out", tests: ["file-tests"], verificationMarker: null };
    const cli = { out: "cli-out" };
    const merged = mergeDepgraphConfig(cli, file);
    expect(merged.out).toBe("cli-out");
    expect(merged.tests).toEqual(["file-tests"]);
    expect(merged.verificationMarker).toBeNull();
    expect(merged.exclude).toEqual(DEFAULTS.exclude);
    expect(merged.duplicateAllowlist).toBe("cli-out/duplicate-allowlist.json");
  });

  test("an apiSurface key merges key by key", () => {
    const merged = mergeDepgraphConfig(
      { apiSurface: { out: "cli.json" } },
      { apiSurface: { out: "file.json", entry: "lib/index.ts" } },
    );
    expect(merged.apiSurface).toEqual({
      out: "cli.json",
      entry: "lib/index.ts",
      stabilityTags: DEFAULTS.apiSurface.stabilityTags,
    });
  });
});

describe("config file: the run", () => {
  /** Runs depgraph on `root`, expects exit 1, no output folder and no absolute root in stderr. */
  async function expectFailure(root: string, flags: string[], message: RegExp): Promise<void> {
    const r = await runDepgraph(root, flags);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(message);
    expect(r.stderr).not.toContain(root);
    expect(r.stderr).not.toContain(root.replace(/\\/g, "/"));
    expect(existsSync(join(root, "docs"))).toBe(false);
  }

  test("an unknown key in repo-tools.config.json exits 1 and writes nothing", async () => {
    const root = pkg({ [CONFIG_FILE]: JSON.stringify({ depgraph: { sources: [] } }) });
    await expectFailure(root, [], /<root>\/repo-tools\.config\.json: unknown key/);
  });

  test("invalid JSON exits 1 and writes nothing", async () => {
    await expectFailure(pkg({ [CONFIG_FILE]: "{ depgraph: " }), [], /not valid JSON/);
  });

  test("an absolute path in the config exits 1 and writes nothing", async () => {
    const root = pkg({ [CONFIG_FILE]: JSON.stringify({ depgraph: { out: "/tmp/x" } }) });
    await expectFailure(root, [], /absolute path/);
  });

  test("--config names a file relative to the root, not to the current folder", async () => {
    const root = pkg({ "cfg/c.json": JSON.stringify({ depgraph: { sources: [] } }) });
    await expectFailure(root, ["--config=cfg/c.json"], /<root>\/cfg\/c\.json: unknown key/);
  });

  test("--config that names a missing file exits 1 and writes nothing", async () => {
    await expectFailure(
      pkg(),
      ["--config=missing.json"],
      /<root>\/missing\.json: .*cannot be read/,
    );
  });

  test("--config with an absolute path exits 1", async () => {
    const root = pkg();
    await expectFailure(root, [`--config=${join(root, CONFIG_FILE)}`], /absolute path/);
  });

  // Ruling (b) of D10a: the error text tells the user to pass a path relative to the root.
  const PASS_RELATIVE = "holds an absolute path; pass a path relative to the root";

  test("each path flag with an absolute path gives the pass-relative message", async () => {
    const root = pkg();
    const abs = join(root, "x");
    for (const flag of ["--config", "--src", "--tests", "--out", "--api-surface", "--api-entry"]) {
      const r = await runDepgraph(root, [`${flag}=${abs}`]);
      expect(r.code).toBe(1);
      expect(r.stderr).toBe(`repo-tools depgraph: flag ${flag} ${PASS_RELATIVE}\n`);
    }
    expect(existsSync(join(root, "docs"))).toBe(false);
  });

  test("a config path with an absolute path gives the pass-relative message", async () => {
    const root = pkg({ [CONFIG_FILE]: JSON.stringify({ depgraph: { out: "/tmp/x" } }) });
    const r = await runDepgraph(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe(
      `repo-tools depgraph: config <root>/${CONFIG_FILE}: 'depgraph.out' ${PASS_RELATIVE}\n`,
    );
  });

  test("a valid config file runs", async () => {
    const root = pkg({ [CONFIG_FILE]: JSON.stringify({ depgraph: { strictOrphans: false } }) });
    expect((await runDepgraph(root)).code).toBe(0);
  });
});
