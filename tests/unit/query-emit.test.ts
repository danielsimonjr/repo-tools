/**
 * `repo-tools query --emit` (design section 3.5): dependency-reverse.json and node-safety.json,
 * sorted, with LF line endings, one trailing LF and no timestamp.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { queryTree, runQuery } from "./query-fixture.ts";
import { removeTrees } from "./tree.ts";

afterAll(removeTrees);

let root = "";
beforeAll(async () => {
  root = await queryTree();
});

/** Reads a report of the default report folder as bytes. */
function bytes(name: string): Buffer {
  return readFileSync(join(root, "docs/architecture", name));
}

describe("query --emit", () => {
  test("writes the two reports and names them relative to the root", async () => {
    const r = await runQuery([`--root=${root}`, "--emit", "--node-runtime=packages/server"]);
    expect(r).toEqual({
      code: 0,
      out:
        "Written: docs/architecture/dependency-reverse.json (7 files)\n" +
        "Written: docs/architecture/node-safety.json (3 node files, 1 leak)\n",
      err: "",
    });
  });

  test("dependency-reverse.json holds the sorted reverse edges and no other field", () => {
    expect(JSON.parse(bytes("dependency-reverse.json").toString())).toEqual({
      dependents: {
        "packages/clean/src/math.ts": ["packages/clean/src/index.ts"],
        "packages/server/src/main.ts": ["packages/server/src/index.ts"],
        "packages/web/src/io.ts": ["packages/web/src/view.ts"],
        "packages/web/src/ping.ts": ["packages/web/src/pong.ts", "packages/web/src/view.ts"],
        "packages/web/src/pong.ts": ["packages/web/src/ping.ts"],
        "packages/web/src/util.ts": [
          "packages/web/src/cli.ts",
          "packages/web/src/index.ts",
          "packages/web/src/view.ts",
        ],
        "packages/web/src/view.ts": ["packages/web/src/index.ts"],
      },
    });
  });

  test("node-safety.json holds the packages, the node files and the leaks", () => {
    expect(JSON.parse(bytes("node-safety.json").toString())).toEqual({
      browserSafePackages: ["packages/clean", "packages/web"],
      nodeTaintedFiles: [
        "packages/server/src/index.ts",
        "packages/web/src/cli.ts",
        "packages/web/src/io.ts",
      ],
      leaks: { "packages/clean": [], "packages/web": ["packages/web/src/io.ts"] },
    });
  });

  test("two runs give byte-identical files with LF, one trailing LF and no date", async () => {
    const first = [bytes("dependency-reverse.json"), bytes("node-safety.json")];
    const r = await runQuery([`--root=${root}`, "--emit", "--node-runtime=packages/server"]);
    expect(r.code).toBe(0);
    const second = [bytes("dependency-reverse.json"), bytes("node-safety.json")];
    for (const [i, b] of second.entries()) {
      expect(b.equals(first[i] as Buffer)).toBe(true);
      const text = b.toString();
      expect(text).not.toContain("\r");
      expect(text.endsWith("}\n")).toBe(true);
      expect(text.endsWith("\n\n")).toBe(false);
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      expect(text).not.toContain("generated");
      expect(text).not.toContain(root.replace(/\\/g, "/"));
    }
  });

  test("the reports go to the report folder of --out", async () => {
    const tree = await queryTree();
    // The query reads and writes the report folder of --out only.
    const r1 = await runQuery([`--root=${tree}`, "--emit", "--out=docs/architecture"]);
    expect(r1.code).toBe(0);
    expect(r1.out).toContain("Written: docs/architecture/node-safety.json");
    const r2 = await runQuery([`--root=${tree}`, "--emit", "--out=elsewhere"]);
    expect(r2.code).toBe(1);
    expect(r2.err).toContain("<root>/elsewhere/dependency-graph.json does not exist");
  });
});
