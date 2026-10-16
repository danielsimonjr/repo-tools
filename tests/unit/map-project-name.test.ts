/**
 * The name of a project in the generated reports.
 *
 * One repository has two names: the name of the folder that holds the checkout, and the `name` field of
 * `package.json`. `dependency-graph.json` and `dependency-graph.yaml` write the folder name. The other reports write
 * the package name. The same repository therefore gets a different `dependency-graph.json` in a folder with a
 * different name.
 *
 * These tests pin that state. A change of the rule changes the expectations marked PIN and no others.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { basename } from "node:path";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

const PACKAGE_NAME = "@scope/pkg-name";

const TREE = {
  "package.json": JSON.stringify({ name: PACKAGE_NAME, version: "1.2.3" }),
  "src/index.ts": "export const one = 1;\n",
};

describe("project name in reports", () => {
  test("graph files use the folder name, other reports the package name", async () => {
    const root = makeTree(TREE);
    const folder = basename(root);
    const run = await runDepgraph(root);
    expect(run.code).toBe(0);
    expect(folder).not.toBe(PACKAGE_NAME);

    // PIN: the graph and its YAML copy carry the name of the folder.
    const graph = JSON.parse(run.report("dependency-graph.json")) as { metadata: { name: string } };
    expect(graph.metadata.name).toBe(folder);
    expect(run.report("dependency-graph.yaml")).toContain(`\n  name: ${folder}\n`);

    // PIN: the other reports carry the package name.
    expect(run.report("dependency-summary.compact.json")).toContain(`"n":"${PACKAGE_NAME}"`);
    expect(run.report("DEPENDENCY_GRAPH.md")).toContain(`# ${PACKAGE_NAME} - Dependency Graph`);
    expect(run.report("dependency-layers.json")).toContain(`"name": "${PACKAGE_NAME}"`);
  });

  test("two checkouts of one repository give graphs with two names", async () => {
    const first = await runDepgraph(makeTree(TREE));
    const second = await runDepgraph(makeTree(TREE));
    const name = (run: typeof first): string =>
      (JSON.parse(run.report("dependency-graph.json")) as { metadata: { name: string } }).metadata
        .name;
    // PIN: the name follows the folder, so two checkouts of one repository disagree.
    expect(name(first)).not.toBe(name(second));
    // The compact summary follows the package, so it agrees with itself.
    expect(first.report("dependency-summary.compact.json")).toBe(
      second.report("dependency-summary.compact.json"),
    );
  });

  test("without a package name the folder name is the fallback", async () => {
    const root = makeTree({ ...TREE, "package.json": JSON.stringify({ version: "1.2.3" }) });
    const run = await runDepgraph(root);
    expect(run.code).toBe(0);
    // PIN: the fallback of the package name is the folder name.
    expect(run.report("DEPENDENCY_GRAPH.md")).toContain(`# ${basename(root)} - Dependency Graph`);
  });
});
