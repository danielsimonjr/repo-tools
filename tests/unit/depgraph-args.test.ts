/**
 * Strict flag parsing of `repo-tools depgraph` (design section 3.2, exit-code table): an unknown
 * flag, a flag without its value and an invalid value exit 1 with a message on standard error,
 * and the run writes nothing.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseDepgraphArgs } from "../../src/depgraph/index.ts";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

/** A small valid package. */
function pkg(): string {
  return makeTree({
    "package.json": JSON.stringify({ name: "args", version: "1.0.0" }),
    "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
  });
}

describe("strict depgraph flags", () => {
  const bad: Array<[string, string[], RegExp]> = [
    ["an unknown long flag", ["--zz"], /unknown flag '--zz'/],
    ["an unknown short flag", ["-x"], /unknown flag '-x'/],
    ["an unknown flag with a value", ["--zz=1"], /unknown flag '--zz'/],
    ["a value flag without its value", ["--root"], /--root needs a value/],
    ["a value flag with an empty value", ["--root="], /--root needs a value/],
    ["a boolean flag with a value", ["--all=yes"], /--all takes no value/],
    ["a short boolean flag with a value", ["-a=1"], /-a takes no value/],
  ];
  for (const [label, flags, message] of bad) {
    test(`${label} exits 1, names the problem and writes nothing`, async () => {
      const root = pkg();
      const r = await runDepgraph(root, flags);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(message);
      expect(r.stdout).toBe("");
      expect(existsSync(join(root, "docs"))).toBe(false);
    });
  }

  test("a second root (two positional arguments, or --root and a positional) exits 1", () => {
    expect(() => parseDepgraphArgs(["a", "b"], "cwd")).toThrow(/root is set twice/);
    expect(() => parseDepgraphArgs(["--root=a", "b"], "cwd")).toThrow(/root is set twice/);
  });

  test("the kept short forms and the positional root parse", () => {
    const o = parseDepgraphArgs(["-a", "-t", "-h", "some/root"], "cwd");
    expect([o.all, o.includeTests, o.help, o.root]).toEqual([true, true, true, "some/root"]);
  });

  test("-t stays a no-op with a note", async () => {
    const r = await runDepgraph(pkg(), ["-t"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("--include-tests is a no-op");
  });

  test("--help wins over an unknown flag", async () => {
    const r = await runDepgraph(pkg(), ["--zz", "--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Usage: repo-tools depgraph");
  });
});
