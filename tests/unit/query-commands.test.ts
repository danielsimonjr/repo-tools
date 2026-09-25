/**
 * `repo-tools query`: the commands `dependents`, `symbol-users`, `is-public` and `cycles` on a
 * fixture graph that depgraph writes (design section 3.5).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CONFIG_FILE } from "../../src/config.ts";
import { queryTree, runQuery } from "./query-fixture.ts";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

let root = "";
beforeAll(async () => {
  root = await queryTree();
});

/** Runs a query on the fixture root. */
function q(...argv: string[]) {
  return runQuery([`--root=${root}`, ...argv]);
}

describe("query dependents", () => {
  test("lists the files that import the file, one per line, sorted", async () => {
    const r = await q("dependents", "packages/web/src/util.ts");
    expect(r).toEqual({
      code: 0,
      out: "packages/web/src/cli.ts\npackages/web/src/index.ts\npackages/web/src/view.ts\n",
      err: "",
    });
  });

  test("a backslash path gives the same answer", async () => {
    const r = await q("dependents", "packages\\web\\src\\util.ts");
    expect(r.out).toContain("packages/web/src/view.ts\n");
  });

  test("a file that no file imports gives a note, and exit 0", async () => {
    const r = await q("dependents", "packages/web/src/cli.ts");
    expect(r).toEqual({
      code: 0,
      out: "(no intra-package importers of packages/web/src/cli.ts)\n",
      err: "",
    });
  });

  test("an absolute file path exits 1, and the path is not shown", async () => {
    const abs = `${root}/packages/web/src/util.ts`;
    const r = await q("dependents", abs);
    expect(r.code).toBe(1);
    expect(r.err).toContain("dependents <file> holds an absolute path");
    expect(r.err).not.toContain(root);
  });
});

describe("query symbol-users", () => {
  test("lists each importer with the kind of the edge, internal and workspace", async () => {
    const r = await q("symbol-users", "helper");
    expect(r).toEqual({
      code: 0,
      out:
        "packages/server/src/main.ts  [@fx/web]\n" +
        "packages/web/src/cli.ts  [internal]\n" +
        "packages/web/src/index.ts  [internal]\n" +
        "packages/web/src/view.ts  [internal]\n",
      err: "",
    });
  });

  test("a symbol that no file imports gives a note, and exit 0", async () => {
    const r = await q("symbol-users", "nothing");
    expect(r).toEqual({ code: 0, out: "(no importers of symbol nothing)\n", err: "" });
  });
});

describe("query is-public", () => {
  test("a name of the export surface is PUBLIC", async () => {
    const r = await q("is-public", "packages/web", "helper");
    expect(r).toEqual({
      code: 0,
      out: "PUBLIC: helper is exported from packages/web\n",
      err: "",
    });
  });

  test("a name outside the export surface is INTERNAL", async () => {
    const r = await q("is-public", "packages/web", "load");
    expect(r).toEqual({
      code: 0,
      out: "INTERNAL: load is not in the public export surface of packages/web\n",
      err: "",
    });
  });

  test("an unknown package exits 1 and lists the known packages", async () => {
    const r = await q("is-public", "web", "helper");
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toBe(
      "repo-tools query: unknown package 'web'; the packages of " +
        "package-export-surfaces.json are: packages/clean, packages/server, packages/web\n",
    );
  });
});

describe("query cycles", () => {
  test("prints the runtime and the type-only cyclic components", async () => {
    const r = await q("cycles");
    expect(r).toEqual({
      code: 0,
      out:
        "runtime: 1 cyclic component\n" +
        "  members: packages/web/src/ping.ts, packages/web/src/pong.ts\n" +
        "  cycle: packages/web/src/ping.ts -> packages/web/src/pong.ts -> packages/web/src/ping.ts\n" +
        "type-only: 0 cyclic components\n",
      err: "",
    });
  });

  test("a graph with no cycle says so for both kinds", async () => {
    const clean = makeTree({
      "package.json": JSON.stringify({ name: "c", version: "1.0.0" }),
      "src/index.ts": "/** Entry. */\nexport const a = 1;\n",
    });
    await runDepgraph(clean);
    const r = await runQuery([`--root=${clean}`, "cycles"]);
    expect(r).toEqual({
      code: 0,
      out: "runtime: 0 cyclic components\ntype-only: 0 cyclic components\n",
      err: "",
    });
  });
});

describe("query: the report folder of the config file", () => {
  test("query.out names the report folder", async () => {
    const tree = makeTree({
      "package.json": JSON.stringify({ name: "c", version: "1.0.0" }),
      "src/index.ts": "/** Entry. */\nexport const a = 1;\n",
      [CONFIG_FILE]: JSON.stringify({ query: { out: "reports" } }),
    });
    expect((await runDepgraph(tree, ["--out=reports"])).code).toBe(0);
    expect((await runQuery([`--root=${tree}`, "cycles"])).code).toBe(0);
  });

  test("depgraph.out names the report folder when query.out is absent", async () => {
    const tree = makeTree({
      "package.json": JSON.stringify({ name: "c", version: "1.0.0" }),
      "src/index.ts": "/** Entry. */\nexport const a = 1;\n",
      [CONFIG_FILE]: JSON.stringify({ depgraph: { out: "reports" } }),
    });
    expect((await runDepgraph(tree)).code).toBe(0);
    expect((await runQuery([`--root=${tree}`, "cycles"])).code).toBe(0);
  });
});
