/**
 * `repo-tools query`: the input reports (design section 3.5, decision D8). The query reads the
 * core `dependency-graph.json` of `repo-tools map`, and `package-export-surfaces.json` for
 * `is-public` only. A missing, unreadable, invalid or 1.x report exits 1 and says to run map
 * first. Error text shows the root as `<root>`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../../src/cli.ts";
import { loadQueryInput } from "../../src/query/load.ts";
import { runMapOn } from "./query-fixture.ts";
import { makeTree, removeTrees } from "./tree.ts";

afterAll(removeTrees);

/** A small package with one import edge. */
function pkg(): string {
  return makeTree({
    "package.json": JSON.stringify({ name: "q", version: "1.0.0" }),
    "src/index.ts": "/** Entry. */\nexport { a } from './a.js';\n",
    "src/a.ts": "/** A. */\nexport const a = 1;\n",
  });
}

/** Runs `repo-tools query` with captured output streams. */
async function query(argv: string[]) {
  let out = "";
  let err = "";
  const code = await main(["query", ...argv], {
    stdout: (s) => {
      out += s;
    },
    stderr: (s) => {
      err += s;
    },
  });
  return { code, out, err };
}

/** Expects exit 1, `message` on standard error, and no absolute root in it. */
async function expectFailure(root: string, argv: string[], message: string): Promise<void> {
  const r = await query([`--root=${root}`, ...argv]);
  expect(r.code).toBe(1);
  expect(r.out).toBe("");
  expect(r.err).toContain(message);
  expect(r.err).not.toContain(root);
  expect(r.err).not.toContain(root.replace(/\\/g, "/"));
}

const GRAPH = "docs/architecture/dependency-graph.json";

describe("query: the input reports", () => {
  test("the loader reads the core graph of the report folder", async () => {
    const root = pkg();
    expect((await runMapOn(root)).code).toBe(0);
    const input = loadQueryInput(root, "docs/architecture");
    expect(input.language).toBe("typescript");
    expect(Object.keys(input.graph.modules)).toEqual(["src"]);
    expect(input.graph.modules.src?.["src/index.ts"]?.internalDependencies?.[0]?.file).toBe(
      "src/a.ts",
    );
    expect(input.warnings).toEqual([]);
  });

  test("a missing dependency graph exits 1 and says to run map first", async () => {
    await expectFailure(
      pkg(),
      ["cycles"],
      `the dependency graph <root>/${GRAPH} does not exist; run repo-tools map first`,
    );
  });

  test("the report folder comes from --out", async () => {
    await expectFailure(
      pkg(),
      ["cycles", "--out=reports"],
      "<root>/reports/dependency-graph.json does not exist",
    );
  });

  test("a 1.x graph is refused", async () => {
    const root = pkg();
    await runMapOn(root);
    const old = {
      metadata: { name: "q", schemaVersion: "1.0.0" },
      modules: { src: {} },
    };
    writeFileSync(join(root, GRAPH), JSON.stringify(old));
    await expectFailure(root, ["cycles"], "is not a 2.x graph (a 1.x report?); run repo-tools map");
  });

  test("a report that is not valid JSON exits 1", async () => {
    const root = pkg();
    await runMapOn(root);
    writeFileSync(join(root, GRAPH), "{ nope");
    await expectFailure(root, ["cycles"], "is not valid JSON; run repo-tools map first");
  });

  test("a report that cannot be read exits 1", async () => {
    const root = pkg();
    // A folder in place of the file cannot be read as a file.
    mkdirSync(join(root, GRAPH), { recursive: true });
    await expectFailure(root, ["cycles"], "cannot be read; run repo-tools map first");
  });

  test("a graph with no modules exits 1", async () => {
    const root = pkg();
    await runMapOn(root);
    writeFileSync(join(root, GRAPH), JSON.stringify({ metadata: { schemaVersion: "2.0.0" } }));
    await expectFailure(root, ["cycles"], "has an unknown shape; run repo-tools map first");
  });

  test("a graph with no schema version gives a warning and an answer", async () => {
    const root = pkg();
    await runMapOn(root);
    writeFileSync(join(root, GRAPH), JSON.stringify({ modules: { src: {} } }));
    const r = await query([`--root=${root}`, "cycles"]);
    expect(r.code).toBe(0);
    expect(r.err).toContain("Warning:");
    expect(r.err).toContain("schemaVersion is missing");
    expect(r.err).not.toContain(root);
  });

  test("the export surfaces load for is-public only", async () => {
    const root = pkg();
    await runMapOn(root);
    rmSync(join(root, "docs/architecture/package-export-surfaces.json"));
    expect((await query([`--root=${root}`, "cycles"])).code).toBe(0);
    await expectFailure(
      root,
      ["is-public", "entry", "a"],
      "<root>/docs/architecture/package-export-surfaces.json does not exist; run repo-tools map",
    );
  });

  test("an export-surfaces report of an unknown shape exits 1", async () => {
    const root = pkg();
    await runMapOn(root);
    writeFileSync(join(root, "docs/architecture/package-export-surfaces.json"), "[]");
    await expectFailure(root, ["is-public", "entry", "a"], "has an unknown shape");
  });

  test("a root that is not an existing directory exits 1", async () => {
    const root = join(pkg(), "missing");
    await expectFailure(root, ["cycles"], "the root <root> is not an existing directory");
  });
});
