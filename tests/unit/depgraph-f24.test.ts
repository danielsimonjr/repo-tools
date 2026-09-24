/**
 * Fix F24: the in-file reference count of an unused export reads the source without comments.
 * A name in its own JSDoc or in a `//` comment is not a use, so the export stays a deletion
 * candidate. A use in code still counts.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

/** The text of one `## <title>` section of `unused-analysis.md`. */
function section(report: string, title: string): string {
  const body = report.split(`\n## ${title}\n`)[1];
  if (body === undefined) throw new Error(`no section: ${title}`);
  return body.split("\n## ")[0] ?? "";
}

describe("F24: in-file references ignore comments", () => {
  test("an export named only in comments stays a deletion candidate", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f24", "version": "1.0.0" }',
      "src/index.ts":
        "/** Entry. */\nimport { used } from './lib.js';\nexport const main = used;\n",
      "src/lib.ts":
        "/** Lib. */\nexport const used = 1;\n\n" +
        "/**\n * `commentOnly` returns 2. See also {@link commentOnly}.\n */\n" +
        "export function commentOnly(): number {\n  return 2; // commentOnly: no use here\n}\n\n" +
        "/* codeUse is the control: code below uses it. */\n" +
        "export function codeUse(): number {\n  return 3;\n}\nconst keep = codeUse();\nkeep;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const report = result.report("unused-analysis.md");
    const dead = section(report, "Unreferenced Anywhere (deletion candidates)");
    const referenced = section(
      report,
      "Referenced In-Module (type contracts / helpers backing live exports)",
    );
    expect(dead).toContain("`commentOnly` (function)");
    expect(referenced).not.toContain("commentOnly");
    expect(referenced).toContain("`codeUse` (function) — 1 in-file ref\n");
  });
});
