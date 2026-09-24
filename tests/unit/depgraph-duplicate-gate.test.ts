/**
 * The duplicate gate (D10b, design section 3.2): `--check-duplicates`, `--no-regen` and
 * `--write-duplicate-baseline`, with the baseline at `depgraph.duplicateBaseline` (default
 * `<out>/duplicate-baseline.json`).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE } from "../../src/config.ts";
import { parseDepgraphArgs } from "../../src/depgraph/args.ts";
import {
  asBaselineNames,
  type DupEntryTag,
  type DuplicateSymbolEntry,
  findNewDuplicates,
} from "../../src/depgraph/duplicates.ts";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

const OUT = "docs/architecture";
const PKG = JSON.stringify({ name: "gate", version: "1.0.0" });

/** A tree with one TRUE_DUPLICATE name, `VERSION`, in `src/a.ts` and `src/b.ts`. */
const DUP_TREE = {
  "package.json": PKG,
  "src/index.ts": "export { a } from './a.js';\nexport { b } from './b.js';\n",
  "src/a.ts": "/** A. */\nexport const VERSION = '1';\nexport const a = 1;\n",
  "src/b.ts": "/** B. */\nexport const VERSION = '2';\nexport const b = 1;\n",
};

/** The same tree with a second TRUE_DUPLICATE name, `LEVEL`. */
const TWO_DUP_TREE = {
  ...DUP_TREE,
  "src/a.ts":
    "/** A. */\nexport const VERSION = '1';\nexport const LEVEL = 1;\nexport const a = 1;\n",
  "src/b.ts":
    "/** B. */\nexport const VERSION = '2';\nexport const LEVEL = 2;\nexport const b = 1;\n",
};

/** A baseline that holds `names` as runtime TRUE_DUPLICATE names in `src/a.ts` and `src/b.ts`. */
function baseline(...names: string[]): string {
  const runtime = Object.fromEntries(names.map((n) => [n, ["src/a.ts", "src/b.ts"]]));
  return JSON.stringify({ runtime, types: {} });
}

describe("the flags parse", () => {
  test("the three flags set their options", () => {
    const o = parseDepgraphArgs(["--check-duplicates", "--no-regen"], "cwd");
    expect(o.checkDuplicates).toBe(true);
    expect(o.noRegen).toBe(true);
    expect(parseDepgraphArgs(["--write-duplicate-baseline"], "cwd").writeDuplicateBaseline).toBe(
      true,
    );
  });

  test("--no-regen without --check-duplicates is an error", async () => {
    const root = makeTree(DUP_TREE);
    const r = await runDepgraph(root, ["--no-regen"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("--no-regen applies with --check-duplicates only");
    expect(existsSync(join(root, "docs"))).toBe(false);
  });

  test("two modes in one run are an error", async () => {
    const root = makeTree(DUP_TREE);
    for (const flags of [
      ["--check-duplicates", "--write-duplicate-baseline"],
      ["--check-duplicates", "--check-census"],
      ["--write-duplicate-baseline", "--check-census"],
    ]) {
      const r = await runDepgraph(root, flags);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("use one of");
    }
    expect(existsSync(join(root, "docs"))).toBe(false);
  });
});

describe("--check-duplicates", () => {
  test("a new TRUE_DUPLICATE name that the baseline does not hold exits 1", async () => {
    const root = makeTree({
      ...TWO_DUP_TREE,
      [`${OUT}/duplicate-baseline.json`]: baseline("VERSION"),
    });
    const r = await runDepgraph(root, ["--check-duplicates"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("1 new TRUE_DUPLICATE name not in <root>/");
    expect(r.stderr).toContain("  [runtime] LEVEL\n    - src/a.ts\n    - src/b.ts\n");
    expect(r.stderr).not.toContain("[runtime] VERSION");
    expect(r.stderr).not.toContain(root);
    // The run regenerated the reports in process.
    expect(existsSync(join(root, OUT, "duplicate-symbols.json"))).toBe(true);
  });

  test("a baselined TRUE_DUPLICATE name exits 0", async () => {
    const root = makeTree({ ...DUP_TREE, [`${OUT}/duplicate-baseline.json`]: baseline("VERSION") });
    const r = await runDepgraph(root, ["--check-duplicates"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      "duplicate check passed: 1 TRUE_DUPLICATE name, 1 in the baseline, 0 new.",
    );
  });

  test("a missing baseline exits 1 and names the flag that writes it", async () => {
    const root = makeTree(DUP_TREE);
    const r = await runDepgraph(root, ["--check-duplicates"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      "the duplicate baseline <root>/docs/architecture/duplicate-baseline.json does not exist",
    );
    expect(r.stderr).toContain("--write-duplicate-baseline");
  });

  test("a baseline that is not valid JSON exits 1", async () => {
    const root = makeTree({ ...DUP_TREE, [`${OUT}/duplicate-baseline.json`]: "{ nope" });
    const r = await runDepgraph(root, ["--check-duplicates"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("is not valid JSON");
  });

  test("depgraph.duplicateBaseline names the baseline", async () => {
    const root = makeTree({
      ...DUP_TREE,
      "cfg/base.json": baseline("VERSION"),
      [CONFIG_FILE]: JSON.stringify({ depgraph: { duplicateBaseline: "cfg/base.json" } }),
    });
    expect((await runDepgraph(root, ["--check-duplicates"])).code).toBe(0);
  });
});

describe("--check-duplicates --no-regen", () => {
  test("reads the committed report and writes nothing", async () => {
    const root = makeTree({ ...TWO_DUP_TREE, [`${OUT}/duplicate-baseline.json`]: baseline() });
    // Commit a report with one TRUE_DUPLICATE name, then add a second name to the source.
    expect((await runDepgraph(root)).code).toBe(0);
    writeFileSync(join(root, OUT, "duplicate-baseline.json"), baseline("VERSION", "LEVEL"));
    const report = join(root, OUT, "duplicate-symbols.json");
    const before = readFileSync(report, "utf8");
    const mtime = statSync(report).mtimeMs;
    writeFileSync(
      join(root, "src/c.ts"),
      "/** C. */\nexport const MODE = 1;\nexport const LIMIT = 1;\n",
    );
    writeFileSync(join(root, "src/d.ts"), "/** D. */\nexport const MODE = 2;\n");
    const r = await runDepgraph(root, ["--check-duplicates", "--no-regen"]);
    expect(r.code).toBe(0);
    expect(readFileSync(report, "utf8")).toBe(before);
    expect(statSync(report).mtimeMs).toBe(mtime);
    expect(r.stdout).toBe(
      "duplicate check passed: 2 TRUE_DUPLICATE names, 2 in the baseline, 0 new.\n",
    );
    // Without --no-regen the new name MODE fails the gate.
    expect((await runDepgraph(root, ["--check-duplicates"])).code).toBe(1);
  });

  test("a missing committed report exits 1 and says to run depgraph first", async () => {
    const root = makeTree({ ...DUP_TREE, [`${OUT}/duplicate-baseline.json`]: baseline() });
    const r = await runDepgraph(root, ["--check-duplicates", "--no-regen"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("run repo-tools depgraph first");
    expect(existsSync(join(root, OUT, "dependency-graph.json"))).toBe(false);
  });
});

describe("findNewDuplicates", () => {
  const entry = (name: string, tag: DupEntryTag): DuplicateSymbolEntry => ({
    name,
    category: "constants",
    definers: [
      { file: "src/b.ts", package: "p", public: true, tag: "PLAIN" },
      { file: "src/a.ts", package: "p", public: true, tag: "PLAIN" },
    ],
    canonicalHint: "AMBIGUOUS",
    tag,
  });

  test("a name counts per kind, and only TRUE_DUPLICATE entries count", () => {
    const report = {
      runtime: [entry("X", "TRUE_DUPLICATE"), entry("Y", "ALLOWLISTED")],
      types: [entry("X", "TRUE_DUPLICATE")],
    };
    expect(findNewDuplicates(report, { runtime: { X: [] }, types: {} })).toEqual([
      { kind: "types", name: "X", files: ["src/a.ts", "src/b.ts"] },
    ]);
  });

  test("a baseline without a kind holds no name of that kind; other keys are ignored", () => {
    expect(asBaselineNames({ generated: "x", runtime: { X: [] } })).toEqual({
      runtime: { X: [] },
      types: {},
    });
    expect(asBaselineNames([])).toBeNull();
    expect(asBaselineNames({ runtime: [] })).toBeNull();
  });
});

describe("--write-duplicate-baseline", () => {
  test("the baseline round trip: write, then the gate passes, then a new name fails", async () => {
    const root = makeTree(TWO_DUP_TREE);
    expect((await runDepgraph(root)).code).toBe(0);
    const w = await runDepgraph(root, ["--write-duplicate-baseline"]);
    expect(w.code).toBe(0);
    expect(w.stdout).toBe(
      "Written: docs/architecture/duplicate-baseline.json (2 runtime, 0 type TRUE_DUPLICATE names)\n",
    );
    const text = readFileSync(join(root, OUT, "duplicate-baseline.json"), "utf8");
    const written = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(written)).toEqual(["note", "runtime", "types"]);
    expect(written.runtime).toEqual({
      LEVEL: ["src/a.ts", "src/b.ts"],
      VERSION: ["src/a.ts", "src/b.ts"],
    });
    expect(written.types).toEqual({});
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text.endsWith("}\n")).toBe(true);
    expect((await runDepgraph(root, ["--check-duplicates"])).code).toBe(0);
    writeFileSync(join(root, "src/c.ts"), "/** C. */\nexport const a = 3;\n");
    const r = await runDepgraph(root, ["--check-duplicates"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("[runtime] a\n");
    // A second write gives the same bytes when the report is the same.
    const again = makeTree(TWO_DUP_TREE);
    await runDepgraph(again);
    await runDepgraph(again, ["--write-duplicate-baseline"]);
    expect(readFileSync(join(again, OUT, "duplicate-baseline.json"), "utf8")).toBe(text);
  });

  test("the baseline goes to depgraph.duplicateBaseline", async () => {
    const root = makeTree({
      ...DUP_TREE,
      [CONFIG_FILE]: JSON.stringify({ depgraph: { duplicateBaseline: "cfg/base.json" } }),
    });
    await runDepgraph(root);
    expect((await runDepgraph(root, ["--write-duplicate-baseline"])).code).toBe(0);
    expect(existsSync(join(root, "cfg/base.json"))).toBe(true);
  });

  test("without a report it exits 1 and writes nothing", async () => {
    const root = makeTree(DUP_TREE);
    const r = await runDepgraph(root, ["--write-duplicate-baseline"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("run repo-tools depgraph first");
    expect(existsSync(join(root, "docs"))).toBe(false);
  });
});
