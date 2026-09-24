/**
 * The per-export facts report (design section 6.2): `--api-surface=<file>`, `--api-entry=<path>`,
 * `--stability-tags=<a,b>` and the config keys `depgraph.apiSurface.out`, `.entry` and
 * `.stabilityTags`. The report is deterministic, has `schemaVersion` 1 and equals its golden.
 * Without the flag, no other output changes.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maskGolden } from "../../scripts/update-depgraph-goldens.ts";
import { CONFIG_FILE } from "../../src/config.ts";
import { parseDepgraphArgs } from "../../src/depgraph/index.ts";
import { sortCodeUnits } from "../../src/sort.ts";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

const repo = join(import.meta.dir, "../..");
const work = mkdtempSync(join(tmpdir(), "repo-tools-api-"));
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
  removeTrees();
});

/** Copies the mini-repo fixture into a new folder under `work` and returns the folder. */
let copies = 0;
function miniRepo(): string {
  const root = join(work, `mini-${copies++}`);
  cpSync(join(repo, "tests/fixtures/depgraph/mini-repo"), root, { recursive: true });
  return root;
}

/** The text of every file in the output folder of `root`, by name. */
function outputs(root: string): Record<string, string> {
  const dir = join(root, "docs/architecture");
  const texts: Record<string, string> = {};
  for (const name of sortCodeUnits(readdirSync(dir))) {
    texts[name] = maskGolden(readFileSync(join(dir, name), "utf8"), root);
  }
  return texts;
}

describe("--api-surface flags", () => {
  test("the three flags parse into the apiSurface settings", () => {
    const o = parseDepgraphArgs(
      ["--api-surface=api.json", "--api-entry=lib/index.ts", "--stability-tags=stable,beta"],
      "cwd",
    );
    expect(o.settings.apiSurface).toEqual({
      out: "api.json",
      entry: "lib/index.ts",
      stabilityTags: ["stable", "beta"],
    });
  });

  test("an absolute path and an empty tag are invalid values", () => {
    expect(() => parseDepgraphArgs(["--api-surface=/a.json"], "cwd")).toThrow(/absolute path/);
    expect(() => parseDepgraphArgs(["--api-entry=C:\\i.ts"], "cwd")).toThrow(/absolute path/);
    expect(() => parseDepgraphArgs(["--stability-tags=a,"], "cwd")).toThrow(/empty item/);
  });
});

describe("the API-surface report on the mini-repo fixture", () => {
  test("equals its golden, has schemaVersion 1, and two runs give the same bytes", async () => {
    const root = miniRepo();
    const first = await runDepgraph(root, ["--api-surface=api-surface.json"]);
    expect(first.code).toBe(0);
    const one = readFileSync(join(root, "api-surface.json"), "utf8");
    expect(first.stdout).toMatch(
      /Written: api-surface\.json \(\d+ surface symbols, \d+ unresolved\)/,
    );
    expect(first.stdout).not.toContain(root);
    await runDepgraph(root, ["--api-surface=api-surface.json"]);
    expect(readFileSync(join(root, "api-surface.json"), "utf8")).toBe(one);
    expect(JSON.parse(one).schemaVersion).toBe(1);
    expect(maskGolden(one, root)).toBe(
      readFileSync(join(repo, "tests/golden/depgraph/mini-repo/api-surface.json"), "utf8"),
    );
  });

  test("without the flag, no other output changes", async () => {
    const plain = miniRepo();
    const withReport = miniRepo();
    await runDepgraph(plain);
    const r = await runDepgraph(withReport, ["--api-surface=api-surface.json"]);
    expect(r.code).toBe(0);
    expect(outputs(withReport)).toEqual(outputs(plain));
    expect(existsSync(join(plain, "api-surface.json"))).toBe(false);
  });
});

describe("the API-surface report: entry, tags and config", () => {
  const tree = {
    "package.json": JSON.stringify({ name: "api", version: "1.0.0" }),
    "src/index.ts": "export { load } from './load.js';\n",
    "src/load.ts":
      "/**\n * Loads.\n * @stable\n */\nexport async function load(p: string): Promise<void> {}\n",
    "lib/main.ts": "/** Main. */\nexport const main = 1;\n",
  };

  test("--stability-tags sets the tags, and --api-entry sets the entry", async () => {
    const root = makeTree(tree);
    await runDepgraph(root, ["--api-surface=a.json", "--stability-tags=stable"]);
    const report = JSON.parse(readFileSync(join(root, "a.json"), "utf8"));
    expect(report.entry).toBe("src/index.ts");
    expect(report.stabilityTags).toEqual(["stable"]);
    expect(report.symbols).toEqual([
      expect.objectContaining({ name: "load", async: true, stability: "stable" }),
    ]);
    await runDepgraph(root, ["--api-surface=b.json", "--api-entry=src/load.ts"]);
    expect(JSON.parse(readFileSync(join(root, "b.json"), "utf8")).entry).toBe("src/load.ts");
  });

  test("the config keys write the report, and the flags win over them", async () => {
    const root = makeTree({
      ...tree,
      [CONFIG_FILE]: JSON.stringify({
        depgraph: { apiSurface: { out: "cfg.json", entry: "src/load.ts", stabilityTags: ["x"] } },
      }),
    });
    await runDepgraph(root);
    const cfg = JSON.parse(readFileSync(join(root, "cfg.json"), "utf8"));
    expect([cfg.entry, cfg.stabilityTags]).toEqual(["src/load.ts", ["x"]]);
    await runDepgraph(root, ["--api-surface=flag.json", "--api-entry=src/index.ts"]);
    const flag = JSON.parse(readFileSync(join(root, "flag.json"), "utf8"));
    expect([flag.entry, flag.stabilityTags]).toEqual(["src/index.ts", ["x"]]);
  });

  test("a missing entry file exits 1 before any write", async () => {
    const root = makeTree(tree);
    const r = await runDepgraph(root, ["--api-surface=a.json", "--api-entry=src/nope.ts"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("<root>/src/nope.ts");
    expect(r.stderr).not.toContain(root);
    expect(existsSync(join(root, "docs"))).toBe(false);
    expect(existsSync(join(root, "a.json"))).toBe(false);
  });

  test("a missing entry without the report is not an error", async () => {
    const root = makeTree(tree);
    expect((await runDepgraph(root, ["--api-entry=src/nope.ts"])).code).toBe(0);
  });
});
