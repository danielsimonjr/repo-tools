/** The browser-safety model of `repo-tools query`: node taint, reach and leaks. */
import { describe, expect, test } from "bun:test";
import type { FilePair } from "../../src/query/graph.ts";
import { buildForward } from "../../src/query/graph.ts";
import { computeTaint } from "../../src/query/safety.ts";

describe("computeTaint", () => {
  test("a file on an import cycle is tainted when the cycle reaches a node: file", () => {
    // a -> b -> a, and a -> n (node:fs). The source walk marked b clean: it met a on the
    // visiting stack, took that as clean, and cached the value.
    const entries: FilePair[] = [
      ["src/a.ts", { internalDependencies: [{ file: "./b.js" }, { file: "./n.js" }] }],
      ["src/b.ts", { internalDependencies: [{ file: "./a.js" }] }],
      ["src/n.ts", { nodeDependencies: [{ module: "fs" }] }],
      ["src/c.ts", {}],
    ];
    const forward = buildForward(entries, new Set(entries.map(([f]) => f)));
    const { taint, direct } = computeTaint(forward, entries);
    expect(taint.get("src/a.ts")).toBe(true);
    expect(taint.get("src/b.ts")).toBe(true);
    expect(taint.get("src/n.ts")).toBe(true);
    expect(taint.get("src/c.ts")).toBe(false);
    expect(direct.get("src/b.ts")).toBe(false);
  });
});
