/**
 * `repo-tools query`: the input reports (design section 3.5). A missing, unreadable or invalid
 * report exits 1 and says to run depgraph first. Error text shows the root as `<root>`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../../src/cli.ts";
import { loadQueryInput } from "../../src/query/load.ts";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

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

describe("query: the input reports", () => {
  test("the loader reads the graph and the export surfaces of the report folder", async () => {
    const root = pkg();
    expect((await runDepgraph(root)).code).toBe(0);
    const input = loadQueryInput(root, "docs/architecture");
    expect(Object.keys(input.graph.modules).length).toBeGreaterThan(0);
    expect(input.graph.entryPoints.map((e) => e.file)).toEqual(["src/index.ts"]);
    expect(input.graph.dependencyGraph.cyclicComponents).toEqual({ runtime: [], typeOnly: [] });
    expect(Object.values(input.surfaces).flat()).toContain("a");
  });

  test("a missing dependency graph exits 1 and says to run depgraph first", async () => {
    await expectFailure(
      pkg(),
      ["cycles"],
      "the dependency graph <root>/docs/architecture/dependency-graph.json does not exist; " +
        "run repo-tools depgraph first",
    );
  });

  test("the report folder comes from --out", async () => {
    await expectFailure(
      pkg(),
      ["cycles", "--out=reports"],
      "<root>/reports/dependency-graph.json does not exist",
    );
  });

  test("a missing export-surfaces report exits 1 and says to run depgraph first", async () => {
    const root = pkg();
    await runDepgraph(root);
    rmSync(join(root, "docs/architecture/package-export-surfaces.json"));
    await expectFailure(
      root,
      ["cycles"],
      "<root>/docs/architecture/package-export-surfaces.json does not exist; " +
        "run repo-tools depgraph first",
    );
  });

  test("a report that is not valid JSON exits 1", async () => {
    const root = pkg();
    await runDepgraph(root);
    writeFileSync(join(root, "docs/architecture/dependency-graph.json"), "{ nope");
    await expectFailure(root, ["cycles"], "is not valid JSON; run repo-tools depgraph first");
  });

  test("a report that cannot be read exits 1", async () => {
    const root = pkg();
    // A folder in place of the file cannot be read as a file.
    mkdirSync(join(root, "docs/architecture/dependency-graph.json"), { recursive: true });
    await expectFailure(root, ["cycles"], "cannot be read; run repo-tools depgraph first");
  });

  test("a graph of an older shape (no cyclicComponents) exits 1", async () => {
    const root = pkg();
    await runDepgraph(root);
    const old = { entryPoints: [], modules: {}, dependencyGraph: { circularDependencies: [] } };
    writeFileSync(join(root, "docs/architecture/dependency-graph.json"), JSON.stringify(old));
    await expectFailure(root, ["cycles"], "has an unknown shape; run repo-tools depgraph first");
  });

  test("an export-surfaces report of an unknown shape exits 1", async () => {
    const root = pkg();
    await runDepgraph(root);
    writeFileSync(join(root, "docs/architecture/package-export-surfaces.json"), "[]");
    await expectFailure(root, ["cycles"], "package-export-surfaces.json has an unknown shape");
  });

  test("a root that is not an existing directory exits 1", async () => {
    const root = join(pkg(), "missing");
    await expectFailure(root, ["cycles"], "the root <root> is not an existing directory");
  });
});
