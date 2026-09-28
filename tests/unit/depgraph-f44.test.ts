/**
 * Fix F44: the 1.x unused-file list omitted a `.d.ts` file. The 2.0.0 core graph keeps it in
 * `noImporterFiles`, matching repo_map: a declaration file with no importer is listed, and an
 * orphan `.ts` file is listed too.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

/** The text of one `## <title>` section. */
function section(report: string, title: string): string {
  const body = report.split(`\n## ${title}\n`)[1];
  if (body === undefined) throw new Error(`no section: ${title}`);
  return body.split("\n## ")[0] ?? "";
}

describe("F44: .d.ts files stay in the core no-importer list", () => {
  test("an ambient .d.ts file and an orphan .ts file are both listed", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f44", "version": "1.0.0" }',
      "src/index.ts": "/** Entry. */\nexport const main = BUILD_ID;\n",
      "src/ambient.d.ts": "declare const BUILD_ID: string;\n",
      "src/orphan.ts": "/** Orphan. */\nexport const orphan = 1;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const report = result.report("unused-analysis.md");
    const noImporter = section(report, "Files with no in-repo importer");
    expect(noImporter).toContain("`src/ambient.d.ts`");
    expect(noImporter).toContain("`src/orphan.ts`");
    expect(section(report, "Dormant files: orphaned")).toContain("`src/orphan.ts`");
  });
});
