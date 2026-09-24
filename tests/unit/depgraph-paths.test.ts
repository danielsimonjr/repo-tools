import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  OUTPUT_SUBDIR,
  outputDirOf,
  relativePosix,
  srcDirOf,
  toPosix,
} from "../../src/depgraph/paths.ts";

describe("depgraph paths", () => {
  test("toPosix replaces backslashes", () => {
    expect(toPosix("a\\b\\c.ts")).toBe("a/b/c.ts");
    expect(toPosix("a/b")).toBe("a/b");
  });

  test("relativePosix gives a forward-slash path relative to the root", () => {
    const root = join("r", "oot");
    expect(relativePosix(root, join(root, "src", "a.ts"))).toBe("src/a.ts");
  });

  test("srcDirOf and outputDirOf join under the root", () => {
    expect(srcDirOf("R")).toBe(join("R", "src"));
    expect(outputDirOf("R")).toBe(join("R", "docs", "architecture"));
    expect(toPosix(outputDirOf("R"))).toBe(`R/${OUTPUT_SUBDIR}`);
  });
});
