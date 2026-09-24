import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { sortCodeUnits } from "../../src/sort.ts";

const root = join(import.meta.dir, "../..");
const golden = join(root, "tests/golden/depgraph");
const sets = ["mini-repo/default", "mini-repo/all", "mono-repo/default", "mono-repo/all"];

describe("depgraph characterization goldens (D0)", () => {
  for (const set of sets) {
    test(`${set} holds the ten reports and an exit code`, () => {
      const files = readdirSync(join(golden, set));
      for (const f of [
        "DEPENDENCY_GRAPH.md",
        "dependency-graph.json",
        "dependency-graph.yaml",
        "dependency-summary.compact.json",
        "unused-analysis.md",
        "duplicate-symbols.md",
        "duplicate-symbols.json",
        "package-export-surfaces.json",
        "_exit-code.txt",
      ]) {
        expect(files).toContain(f);
      }
    });

    test(`${set} holds no unmasked date and no root path`, () => {
      for (const f of readdirSync(join(golden, set))) {
        const text = readFileSync(join(golden, set, f), "utf8");
        expect(text).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
        expect(text).not.toMatch(/[A-Za-z]:[\/]/);
      }
    });
  }

  test("mini-repo names differ between code-unit order and case-insensitive order", () => {
    const names = readdirSync(join(root, "tests/fixtures/depgraph/mini-repo/src")).filter((n) =>
      statSync(join(root, "tests/fixtures/depgraph/mini-repo/src", n)).isFile(),
    );
    const caseless = [...names].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
    expect(sortCodeUnits(names)).not.toEqual(caseless);
  });

  test("the census gate fails on the tsup second-entry orphan before fix F14", () => {
    expect(readFileSync(join(golden, "mono-repo/default/_exit-code.txt"), "utf8")).toBe("1\n");
  });
});
