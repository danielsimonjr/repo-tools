/**
 * The 1.x depgraph goldens are gone. This check stays because the mini-repo fixture is what
 * makes a code-unit sort differ from a case-insensitive sort, which the map goldens rely on.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { sortCodeUnits } from "../../src/sort.ts";

const root = join(import.meta.dir, "../..");

describe("mini-repo fixture order", () => {
  test("src names differ between code-unit order and case-insensitive order", () => {
    const names = readdirSync(join(root, "tests/fixtures/depgraph/mini-repo/src")).filter((n) =>
      statSync(join(root, "tests/fixtures/depgraph/mini-repo/src", n)).isFile(),
    );
    const caseless = [...names].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
    expect(sortCodeUnits(names)).not.toEqual(caseless);
  });
});
