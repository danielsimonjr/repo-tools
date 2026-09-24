/**
 * Fix F42: a census gap (a `.ts` file on disk that the census does not list, or a census entry
 * that is not on disk) gives a warning and exit 0 by default. `--strict-census` makes it fail.
 * `--check-census` stays a strict gate.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

/** A single package with a source folder that the census does not list. */
function withGap(): string {
  return makeTree({
    "package.json": JSON.stringify({ name: "f42", version: "1.0.0" }),
    "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
    "lib/extra.ts": "/** Outside src/ and the census folders. */\nexport const extra = 1;\n",
  });
}

describe("F42: a census gap warns unless --strict-census", () => {
  test("by default the gap is a warning and the run exits 0", async () => {
    const result = await runDepgraph(withGap());
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("Warning");
    expect(result.stderr).toContain("lib/extra.ts");
  });

  test("--strict-census makes the gap fail the run", async () => {
    const result = await runDepgraph(withGap(), ["--strict-census"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ABSENT");
  });

  test("--check-census stays strict on a gap", async () => {
    const root = withGap();
    await runDepgraph(root);
    const check = await runDepgraph(root, ["--check-census"]);
    expect(check.code).toBe(1);
  });
});
