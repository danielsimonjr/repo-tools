/**
 * The extension loader (D10b, design section 5.2): `depgraph.extensions` names root-relative
 * `.mjs` modules. They load in config order. `preflight(ctx)` runs before the first write and
 * `report(ctx)` after the analysis. A throw or a rejected promise exits 1 with the extension
 * name. `--no-extensions` loads none. `--check-census` and `--check-duplicates --no-regen` skip
 * `preflight`.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE } from "../../src/config.ts";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

/** The calls that the fixture extensions record in this process. */
type Log = string[];
const scope = globalThis as unknown as { __rtExtLog?: Log };
beforeEach(() => {
  scope.__rtExtLog = [];
});
const log = (): Log => scope.__rtExtLog ?? [];

const OUT = "docs/architecture";
const BASE = {
  "package.json": JSON.stringify({ name: "ext", version: "1.0.0" }),
  "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
};

/** A fixture extension named `name` that records each hook call in the shared log. */
function recorder(name: string): string {
  return `export default {
  name: ${JSON.stringify(name)},
  preflight(ctx) {
    globalThis.__rtExtLog.push(${JSON.stringify(name)} + ":preflight:" +
      (require_exists(ctx.root) ? "out-exists" : "no-out"));
  },
  async report(ctx) {
    globalThis.__rtExtLog.push(${JSON.stringify(name)} + ":report");
  },
};
import { existsSync } from "node:fs";
import { join } from "node:path";
function require_exists(root) { return existsSync(join(root, "docs")); }
`;
}

/** The config file text that loads `paths`. */
function config(paths: string[], more: object = {}): string {
  return JSON.stringify({ depgraph: { extensions: paths, ...more } });
}

describe("loading and order", () => {
  test("the hooks run in config order, preflight before the first write", async () => {
    const root = makeTree({
      ...BASE,
      "ext/b.mjs": recorder("bravo"),
      "ext/a.mjs": recorder("alpha"),
      [CONFIG_FILE]: config(["ext/b.mjs", "ext/a.mjs"]),
    });
    const r = await runDepgraph(root);
    expect(r.code).toBe(0);
    expect(log()).toEqual([
      "bravo:preflight:no-out",
      "alpha:preflight:no-out",
      "bravo:report",
      "alpha:report",
    ]);
  });

  test("--no-extensions loads none, not even a module that does not exist", async () => {
    const root = makeTree({
      ...BASE,
      "ext/a.mjs": recorder("alpha"),
      [CONFIG_FILE]: config(["ext/a.mjs", "ext/missing.mjs"]),
    });
    const r = await runDepgraph(root, ["--no-extensions"]);
    expect(r.code).toBe(0);
    expect(log()).toEqual([]);
  });

  const bad: Array<[string, Record<string, string>, string]> = [
    ["a missing module", {}, "extension ext/x.mjs: the module does not exist"],
    ["a module that is not .mjs", { "ext/x.js": "export default {}" }, ".mjs"],
    ["a module without a default export", { "ext/x.mjs": "export const a = 1;" }, "name"],
    [
      "a hook that is not a function",
      { "ext/x.mjs": "export default { name: 'x', report: 1 }" },
      "report",
    ],
    ["a module that throws on load", { "ext/x.mjs": "throw new Error('boom');" }, "boom"],
  ];
  for (const [label, files, message] of bad) {
    test(`${label} exits 1 before any write`, async () => {
      const path = Object.keys(files)[0] ?? "ext/x.mjs";
      const root = makeTree({ ...BASE, ...files, [CONFIG_FILE]: config([path]) });
      const r = await runDepgraph(root);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain(message);
      expect(r.stderr).not.toContain(root);
      expect(existsSync(join(root, "docs"))).toBe(false);
    });
  }
});

describe("the context", () => {
  test("preflight gets root, config and mask; report adds a read-only graph and write", async () => {
    const ext = `export default {
  name: "ctx",
  preflight(ctx) {
    globalThis.__rtExtLog.push(JSON.stringify({
      keys: Object.keys(ctx).sort(),
      frozen: Object.isFrozen(ctx.config) && Object.isFrozen(ctx.config.tests),
      out: ctx.config.out,
      masked: ctx.mask.stripComments("a // c").trim(),
      blank: ctx.mask.blankCommentsAndStrings("'s' + 1").length,
    }));
  },
  report(ctx) {
    let mutated = "no";
    try { ctx.graph.metadata.totalFiles = 99; mutated = "yes"; } catch { mutated = "threw"; }
    globalThis.__rtExtLog.push(JSON.stringify({
      keys: Object.keys(ctx).sort(),
      files: ctx.graph.metadata.totalFiles,
      mutated,
      rootIsAbsolute: ctx.root.length > 0 && !ctx.root.startsWith("."),
    }));
    ctx.write("ext/notes.md", "line one\\r\\nline two\\n\\n\\n");
  },
};
`;
    const root = makeTree({ ...BASE, "ext/c.mjs": ext, [CONFIG_FILE]: config(["ext/c.mjs"]) });
    const r = await runDepgraph(root);
    expect(r.code).toBe(0);
    const [pre, rep] = log().map((line) => JSON.parse(line));
    expect(pre).toEqual({
      keys: ["config", "mask", "root"],
      frozen: true,
      out: OUT,
      masked: "a",
      blank: 7,
    });
    expect(rep).toEqual({
      keys: ["config", "graph", "mask", "root", "write"],
      files: 1,
      mutated: "threw",
      rootIsAbsolute: true,
    });
    // The write keeps the output rules: LF line endings and one trailing LF.
    expect(readFileSync(join(root, OUT, "ext/notes.md"), "utf8")).toBe("line one\nline two\n");
    // The graph copy is read-only: the core report keeps its value.
    expect(r.graph()).toMatchObject({ metadata: { totalFiles: 1 } });
  });

  test("write refuses a path that leaves the output folder", async () => {
    const ext = `export default {
  name: "escape",
  report(ctx) {
    for (const p of ["../x.txt", "a/../../x.txt", "/abs.txt", "C:/abs.txt", ""]) {
      try { ctx.write(p, "x"); globalThis.__rtExtLog.push("wrote " + p); }
      catch (e) { globalThis.__rtExtLog.push("refused " + p); }
    }
  },
};
`;
    const root = makeTree({ ...BASE, "ext/e.mjs": ext, [CONFIG_FILE]: config(["ext/e.mjs"]) });
    expect((await runDepgraph(root)).code).toBe(0);
    expect(log()).toEqual([
      "refused ../x.txt",
      "refused a/../../x.txt",
      "refused /abs.txt",
      "refused C:/abs.txt",
      "refused ",
    ]);
    expect(existsSync(join(root, "docs/x.txt"))).toBe(false);
  });
});

describe("failures", () => {
  test("a throw in preflight exits 1 with the extension name and writes nothing", async () => {
    const ext =
      "export default { name: 'wasm-gate', preflight() { throw new Error('no build'); } };";
    const root = makeTree({ ...BASE, "ext/w.mjs": ext, [CONFIG_FILE]: config(["ext/w.mjs"]) });
    const r = await runDepgraph(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("extension wasm-gate failed in preflight: no build");
    expect(existsSync(join(root, "docs"))).toBe(false);
  });

  test("a rejected promise in report exits 1 with the extension name", async () => {
    const ext =
      "export default { name: 'pairing', report() { return Promise.reject(new Error('bad pair')); } };";
    const root = makeTree({ ...BASE, "ext/p.mjs": ext, [CONFIG_FILE]: config(["ext/p.mjs"]) });
    const r = await runDepgraph(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("extension pairing failed in report: bad pair");
  });
});

describe("the modes that skip preflight", () => {
  const THROWING = "export default { name: 'gate', preflight() { throw new Error('ran'); } };";

  test("--check-census skips preflight", async () => {
    const root = makeTree({ ...BASE, "ext/g.mjs": THROWING, [CONFIG_FILE]: config(["ext/g.mjs"]) });
    expect((await runDepgraph(root, ["--no-extensions"])).code).toBe(0);
    const r = await runDepgraph(root, ["--check-census"]);
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain("ran");
  });

  test("--check-duplicates --no-regen skips preflight; --check-duplicates runs it", async () => {
    const root = makeTree({
      ...BASE,
      "ext/g.mjs": THROWING,
      [`${OUT}/duplicate-baseline.json`]: JSON.stringify({ runtime: {}, types: {} }),
      [CONFIG_FILE]: config(["ext/g.mjs"]),
    });
    expect((await runDepgraph(root, ["--no-extensions"])).code).toBe(0);
    expect((await runDepgraph(root, ["--check-duplicates", "--no-regen"])).code).toBe(0);
    const r = await runDepgraph(root, ["--check-duplicates"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("extension gate failed in preflight: ran");
  });
});
