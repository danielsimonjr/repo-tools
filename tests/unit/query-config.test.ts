/** `repo-tools query --config=<path>`: the same config path rule as `depgraph --config`. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseQueryArgs } from "../../src/query/args.ts";
import { queryTree, runQuery } from "./query-fixture.ts";
import { removeTrees } from "./tree.ts";

afterAll(removeTrees);

let root = "";
beforeAll(async () => {
  root = await queryTree();
  // The default config file points the query at a folder with no reports; the named file at the
  // real one. So the answer shows which file the run read.
  writeFileSync(join(root, "repo-tools.config.json"), JSON.stringify({ query: { out: "none" } }));
  writeFileSync(
    join(root, "alt.json"),
    JSON.stringify({ query: { out: "docs/architecture", nodeRuntimes: ["packages/server"] } }),
  );
});

describe("query --config", () => {
  test("parseQueryArgs keeps the config path", () => {
    expect(parseQueryArgs(["cycles", "--config=alt.json"], "/r").config).toBe("alt.json");
    expect(parseQueryArgs(["cycles"], "/r")).not.toHaveProperty("config");
  });

  test("without --config, the run reads repo-tools.config.json (control)", async () => {
    const r = await runQuery([`--root=${root}`, "cycles"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("run repo-tools map first");
  });

  test("--config reads the named file instead", async () => {
    const r = await runQuery([`--root=${root}`, "--config=alt.json", "--check-browser-safety"]);
    // The named file sets the report folder and makes packages/server a Node runtime, so two
    // packages are browser-safe, and the web leak of the fixture fails the gate.
    expect(r.code).toBe(1);
    expect(r.err).toContain("1 of 2 browser-safe packages");
    expect(r.err).toContain("packages/web: packages/web/src/io.ts");
    const clean = await runQuery([`--root=${root}`, "--config=alt.json", "cycles"]);
    expect(clean.code).toBe(0);
  });

  test("a missing named file exits 1", async () => {
    const r = await runQuery([`--root=${root}`, "--config=absent.json", "cycles"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("absent.json");
  });

  test("an absolute path exits 1 and names the flag, not the path", async () => {
    const abs = join(root, "alt.json");
    const r = await runQuery([`--root=${root}`, `--config=${abs}`, "cycles"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("flag --config holds an absolute path");
    expect(r.err).not.toContain(abs);
  });

  test("--help names --config", async () => {
    const r = await runQuery(["--help"]);
    expect(r.out).toContain("--config=<path>");
  });
});
