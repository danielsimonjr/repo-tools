/**
 * The test cases of the source query tool (tools/query-dependency-graph), ported to bun:test and
 * the repo-tools modules. Each assertion keeps its meaning. The adaptations:
 * - `browserSafePackages` takes the Node runtimes as an argument; the source named one fixed
 *   runtime package. The case lists a runtime to keep the "runtime excluded" assertion.
 * - The source `resolveRoot` (default: two folders above the script) became the `--root` flag
 *   of the strict parser; the default root is the current directory.
 * - Design decision D8: the query reads the core graph, whose edges hold resolved targets and
 *   whose built-ins are plain names. The source `resolveSpec` case became "an edge whose target
 *   is not a file of the graph is dropped". A package comes from a `src/index.ts` file.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { CONFIG_FILE } from "../../src/config.ts";
import { parseQueryArgs } from "../../src/query/args.ts";
import { buildForward, type FilePair, invert } from "../../src/query/graph.ts";
import {
  browserSafePackages,
  computeTaint,
  findLeaks,
  reachableFrom,
} from "../../src/query/safety.ts";
import { runQuery } from "./query-fixture.ts";
import { makeTree, removeTrees } from "./tree.ts";

afterAll(removeTrees);

// The fixture copies a real scenario of the source repo:
//   plot/src/index.ts -> a, b            (public entry)
//   a -> c
//   b uses node:fs                       (a node file that index reaches: a LEAK)
//   node-only uses node:child_process; no file imports it (a subpath entry only)
const entries: FilePair[] = [
  [
    "plot/src/index.ts",
    {
      internalDependencies: [{ file: "plot/src/a.ts" }, { file: "plot/src/b.ts" }],
      nodeDependencies: [],
    },
  ],
  ["plot/src/a.ts", { internalDependencies: [{ file: "plot/src/c.ts" }], nodeDependencies: [] }],
  ["plot/src/b.ts", { internalDependencies: [], nodeDependencies: ["fs"] }],
  ["plot/src/c.ts", { internalDependencies: [], nodeDependencies: [] }],
  ["plot/src/node-only.ts", { internalDependencies: [], nodeDependencies: ["child_process"] }],
];
const allFiles = new Set(entries.map(([f]) => f));

describe("query: the source test cases", () => {
  test("an edge whose target is not a file of the graph is dropped", () => {
    const withMissing: FilePair[] = [
      ["plot/src/x.ts", { internalDependencies: [{ file: "plot/src/missing.ts" }] }],
    ];
    const forward = buildForward(withMissing, new Set(["plot/src/x.ts"]));
    expect([...(forward.get("plot/src/x.ts") ?? [])]).toEqual([]);
  });

  test("buildForward and invert give the correct reverse edges", () => {
    const forward = buildForward(entries, allFiles);
    expect([...(forward.get("plot/src/index.ts") ?? [])].sort()).toEqual([
      "plot/src/a.ts",
      "plot/src/b.ts",
    ]);
    const rev = invert(forward);
    expect(rev["plot/src/a.ts"]).toEqual(["plot/src/index.ts"]);
    expect(rev["plot/src/c.ts"]).toEqual(["plot/src/a.ts"]);
    expect(rev["plot/src/node-only.ts"]).toBeUndefined(); // no file imports it
  });

  test("computeTaint marks the direct and the transitive node: users", () => {
    const forward = buildForward(entries, allFiles);
    const { taint, direct } = computeTaint(forward, entries);
    expect(direct.get("plot/src/b.ts")).toBe(true);
    expect(direct.get("plot/src/a.ts")).toBe(false);
    expect(taint.get("plot/src/index.ts")).toBe(true); // imports b (node:)
    expect(taint.get("plot/src/a.ts")).toBe(false); // a -> c, neither uses node:
    expect(taint.get("plot/src/node-only.ts")).toBe(true);
  });

  test("reachableFrom the public entry leaves out the subpath-only node file", () => {
    const forward = buildForward(entries, allFiles);
    const reach = reachableFrom("plot/src/index.ts", forward);
    expect(reach.has("plot/src/c.ts")).toBe(true);
    expect(reach.has("plot/src/node-only.ts")).toBe(false); // index does not import it
  });

  test("findLeaks flags the node: files that . reaches, not the subpath-only ones", () => {
    const forward = buildForward(entries, allFiles);
    const { direct } = computeTaint(forward, entries);
    // b leaks; node-only.ts does not (. does not reach it).
    expect(findLeaks("plot", forward, direct)).toEqual(["plot/src/b.ts"]);
  });

  test("browserSafePackages = the src/index.ts packages less the Node runtimes", () => {
    const files = [
      "plot/src/index.ts",
      "core/src/index.ts",
      "server/src/index.ts",
      "packages/typed-function/src/index.ts",
      "plot/src/render-file.ts", // not a src/index.ts file: no package
    ];
    const bsp = browserSafePackages(files, ["server"]);
    expect(bsp).toContain("plot");
    expect(bsp).toContain("core");
    expect(bsp).toContain("packages/typed-function");
    expect(bsp).not.toContain("server"); // a Node runtime is left out
    expect(bsp).not.toContain("plot/src/render-file"); // a non-main entry is not a package
  });

  // The source defaulted the root to two folders above the script; --root pointed it at a
  // package folder elsewhere. The strict parser keeps --root and defaults to the current folder.
  test("the root defaults to the current directory", () => {
    expect(parseQueryArgs(["cycles"], "/repo").root).toBe("/repo");
  });

  test("--root=<path> overrides the default", () => {
    expect(parseQueryArgs(["--root=/elsewhere/pipeline", "cycles"], "/repo").root).toBe(
      "/elsewhere/pipeline",
    );
  });

  test("a relative --root is kept as given; the run resolves it against the current folder", () => {
    expect(parseQueryArgs(["--root=pipeline", "cycles"], "/repo").root).toBe("pipeline");
  });

  test("--root is consumed, not read as a command", () => {
    expect(parseQueryArgs(["--root=/x", "cycles"], "/repo").command).toEqual({ name: "cycles" });
  });
});

describe("query: the config key table", () => {
  test("an unknown query.* key exits 1 and names the key", async () => {
    const root = makeTree({ [CONFIG_FILE]: JSON.stringify({ query: { nodeRuntime: ["x"] } }) });
    const r = await runQuery([`--root=${root}`, "cycles"]);
    expect(r).toEqual({
      code: 1,
      out: "",
      err: `repo-tools query: config <root>/${CONFIG_FILE}: unknown key 'query.nodeRuntime'\n`,
    });
  });
});
