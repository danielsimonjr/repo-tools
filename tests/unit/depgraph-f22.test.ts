/**
 * Fix F22: every depgraph sort uses UTF-16 code-unit order, never `localeCompare`, so the order
 * does not depend on the ICU data of the runtime.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildPackageExportSurfaces } from "../../src/depgraph/reporters/surfaces.ts";
import type { ModuleMap } from "../../src/depgraph/types.ts";

const src = join(import.meta.dir, "../../src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("F22: code-unit order", () => {
  test("no source file calls localeCompare", () => {
    const callers = sourceFiles(src).filter((f) =>
      /\.localeCompare\(/.test(readFileSync(f, "utf8")),
    );
    expect(callers).toEqual([]);
  });

  test("export surfaces list names in code-unit order: upper case, '_', then lower case", () => {
    const modules = {
      root: {
        "src/a.ts": { exports: { named: ["b", "B", "_a", "a", "Z", "z"] } },
      },
    } as unknown as ModuleMap;
    expect(buildPackageExportSurfaces(modules).root).toEqual(["B", "Z", "_a", "a", "b", "z"]);
  });
});
