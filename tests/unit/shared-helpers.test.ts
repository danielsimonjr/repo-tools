import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { summaryRowsOf } from "../../src/depgraph/reporters/markdown.ts";
import type { Statistics } from "../../src/depgraph/types.ts";
import { realPath } from "../../src/io.ts";
import { rglobParts } from "../../src/map/discovery.ts";
import { makeTempDir } from "./temp.ts";

const work = makeTempDir("shared-helpers");
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("realPath", () => {
  test("adds the missing names to the real path of the nearest existing folder", () => {
    mkdirSync(join(work, "real"), { recursive: true });
    expect(realPath(join(work, "real", "new", "deep.txt"))).toBe(
      join(realpathSync.native(join(work, "real")), "new", "deep.txt"),
    );
  });

  test("follows a link that resolves", () => {
    mkdirSync(join(work, "target"), { recursive: true });
    try {
      symlinkSync(join(work, "target"), join(work, "link"), "junction");
    } catch {
      return; // the platform refuses links: nothing to follow
    }
    expect(realPath(join(work, "link", "x"))).toBe(
      join(realpathSync.native(join(work, "target")), "x"),
    );
  });
});

describe("rglobParts", () => {
  test("lists the files with the suffix as path parts, in code-unit order", () => {
    const root = join(work, "glob");
    mkdirSync(join(root, "b"), { recursive: true });
    mkdirSync(join(root, "a"), { recursive: true });
    writeFileSync(join(root, "b", "two.csproj"), "");
    writeFileSync(join(root, "a", "one.csproj"), "");
    writeFileSync(join(root, "a", "skip.txt"), "");
    expect(rglobParts(root, ".csproj")).toEqual([
      ["a", "one.csproj"],
      ["b", "two.csproj"],
    ]);
  });

  test("gives an empty list for a folder that does not exist", () => {
    expect(rglobParts(join(work, "missing"), ".csproj")).toEqual([]);
  });
});

describe("summaryRowsOf", () => {
  const stats = { totalTypeScriptFiles: 3, totalModules: 2, totalLinesOfCode: 10 } as Statistics;

  test("uses the depgraph 1.x labels by default and drops a count that is absent", () => {
    expect(summaryRowsOf(stats)).toEqual([
      ["Total TypeScript Files", 3],
      ["Total Modules", 2],
      ["Total Lines of Code", 10],
    ]);
  });

  test("takes the two labels that differ from the caller", () => {
    expect(summaryRowsOf(stats, { files: "Total Source Files", modules: "Subsystems" })).toEqual([
      ["Total Source Files", 3],
      ["Subsystems", 2],
      ["Total Lines of Code", 10],
    ]);
  });
});
