/**
 * `repo-tools query node-safety` and `--check-browser-safety` (design section 3.5): the Node
 * runtimes come from `--node-runtime` or `query.nodeRuntimes`, not from a fixed package name.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE } from "../../src/config.ts";
import { QUERY_TREE, queryTree, runQuery } from "./query-fixture.ts";
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

const WEB_LEAK =
  "packages/web: 1 node: file reachable from the . entry:\n  packages/web/src/io.ts\n";
const SERVER_LEAK =
  "packages/server: 1 node: file reachable from the . entry:\n  packages/server/src/index.ts\n";
const CLEAN = "packages/clean: clean (the . entry reaches no node: code)\n";

describe("query node-safety", () => {
  test("with no runtime, each package with a src/index.ts entry is browser-safe", async () => {
    const r = await q("node-safety");
    // cli.ts imports node:path, but no file of the web entry reaches it.
    expect(r).toEqual({ code: 0, out: CLEAN + SERVER_LEAK + WEB_LEAK, err: "" });
  });

  test("a listed Node runtime is left out", async () => {
    const r = await q("node-safety", "--node-runtime=packages/server");
    expect(r).toEqual({ code: 0, out: CLEAN + WEB_LEAK, err: "" });
  });

  test("[pkg] checks one package, also a runtime", async () => {
    expect(await q("node-safety", "packages/web")).toEqual({ code: 0, out: WEB_LEAK, err: "" });
    const server = await q("node-safety", "packages/server", "--node-runtime=packages/server");
    expect(server.out).toBe(SERVER_LEAK);
  });

  test("an unknown package exits 1 and lists the packages", async () => {
    const r = await q("node-safety", "web");
    expect(r.code).toBe(1);
    expect(r.err).toBe(
      "repo-tools query: unknown package 'web'; the packages with a src/index.ts entry are: " +
        "packages/clean, packages/server, packages/web\n",
    );
  });

  test("a runtime that is not a package exits 1", async () => {
    const r = await q("node-safety", "--node-runtime=packages/nope");
    expect(r.code).toBe(1);
    expect(r.err).toContain("Node runtime 'packages/nope' is not a package with a src/index.ts");
  });
});

describe("query --check-browser-safety", () => {
  test("a leak exits 1 and names each leaking package on standard error", async () => {
    const r = await q("--check-browser-safety", "--node-runtime=packages/server");
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toBe(
      "browser-safety check FAILED: 1 of 2 browser-safe packages reach node: code from the . entry:\n" +
        "  packages/web: packages/web/src/io.ts\n",
    );
  });

  test("a leak in a package that is not a listed runtime exits 1", async () => {
    const r = await q("--check-browser-safety");
    expect(r.code).toBe(1);
    expect(r.err).toContain("2 of 3 browser-safe packages");
    expect(r.err).toContain("  packages/server: packages/server/src/index.ts\n");
  });

  test("a clean graph exits 0", async () => {
    const clean = makeTree({
      "package.json": QUERY_TREE["package.json"] as string,
      "packages/clean/package.json": QUERY_TREE["packages/clean/package.json"] as string,
      "packages/clean/src/index.ts": QUERY_TREE["packages/clean/src/index.ts"] as string,
      "packages/clean/src/math.ts": QUERY_TREE["packages/clean/src/math.ts"] as string,
    });
    expect((await runDepgraph(clean)).code).toBe(0);
    const r = await runQuery([`--root=${clean}`, "--check-browser-safety"]);
    expect(r).toEqual({
      code: 0,
      out: "browser-safety check passed: the . entries of 1 browser-safe package reach no node: code.\n",
      err: "",
    });
  });

  test("listed Node runtimes are allowed: the check exits 0", async () => {
    const r = await q("--check-browser-safety", "--node-runtime=packages/server,packages/web");
    expect(r.code).toBe(0);
    expect(r.out).toContain("the . entries of 1 browser-safe package reach no node: code");
  });

  test("query.nodeRuntimes lists the runtimes; --node-runtime wins over it", async () => {
    const tree = await queryTree({
      [CONFIG_FILE]: JSON.stringify({
        query: { nodeRuntimes: ["packages/server", "packages/web"] },
      }),
    });
    expect((await runQuery([`--root=${tree}`, "--check-browser-safety"])).code).toBe(0);
    const cli = await runQuery([
      `--root=${tree}`,
      "--check-browser-safety",
      "--node-runtime=packages/server",
    ]);
    expect(cli.code).toBe(1);
  });

  test("the package of a root src/index.ts is '.'", async () => {
    const single = makeTree({
      "package.json": JSON.stringify({ name: "s", version: "1.0.0" }),
      "src/index.ts": "/** Entry. */\nexport { load } from './io.js';\n",
      "src/io.ts":
        "/** IO. */\nimport { readFileSync } from 'node:fs';\nexport const load = readFileSync;\n",
    });
    expect((await runDepgraph(single)).code).toBe(0);
    const leak = await runQuery([`--root=${single}`, "node-safety"]);
    expect(leak.out).toBe(".: 1 node: file reachable from the . entry:\n  src/io.ts\n");
    const allowed = await runQuery([
      `--root=${single}`,
      "--check-browser-safety",
      "--node-runtime=.",
    ]);
    expect(allowed.code).toBe(0);
    writeFileSync(join(single, CONFIG_FILE), JSON.stringify({ query: { nodeRuntimes: ["."] } }));
    expect((await runQuery([`--root=${single}`, "--check-browser-safety"])).code).toBe(0);
  });
});
