/**
 * Fix F42: a census gap (a source file on disk that the git census does not list) gives a
 * warning and exit 0 by default. `--strict-census` makes it fail. `--check-census` compares the
 * committed inventory to the census and fails when they differ.
 *
 * In 2.0.0 the census is `git ls-files` (a pruned walk outside a work tree). A file outside
 * `src/` is still in the census when git tracks it. The gap is an untracked source file.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

/** Runs git in `root`. A commit does not sign. */
function git(root: string, args: string[]): void {
  const result = spawnSync(
    "git",
    [
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test",
      ...args,
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
}

/** A git work tree whose `lib/extra.ts` is on disk and untracked. */
function withGap(): string {
  const root = makeTree({
    "package.json": JSON.stringify({ name: "f42", version: "1.0.0" }),
    "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
    "lib/extra.ts": "/** Untracked source. */\nexport const extra = 1;\n",
  });
  git(root, ["init"]);
  git(root, ["add", "package.json", "src/index.ts"]);
  git(root, ["commit", "-m", "init"]);
  return root;
}

describe("F42: a census gap warns unless --strict-census", () => {
  test("by default the gap is a warning and the run exits 0", async () => {
    const result = await runDepgraph(withGap());
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("Warning");
    expect(result.stderr).toContain("not in the census");
    expect(result.stderr).toContain("lib/extra.ts");
  });

  test("--strict-census makes the gap fail the run", async () => {
    const result = await runDepgraph(withGap(), ["--strict-census"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("census FAILED (--strict-census)");
    expect(result.stderr).toContain("lib/extra.ts");
  });

  test("--check-census fails when the committed inventory differs from the census", async () => {
    const root = withGap();
    await runDepgraph(root);
    const path = join(root, "docs/architecture/file-inventory.json");
    const inventory = JSON.parse(readFileSync(path, "utf8")) as { files: { file: string }[] };
    inventory.files = inventory.files.filter((f) => f.file !== "src/index.ts");
    writeFileSync(path, JSON.stringify(inventory));
    const check = await runDepgraph(root, ["--check-census"]);
    expect(check.code).toBe(1);
    expect(check.stderr).toContain("file-census check FAILED");
    expect(check.stderr).toContain("src/index.ts");
  });
});
