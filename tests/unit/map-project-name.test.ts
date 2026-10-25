/**
 * The name of a project in the generated reports.
 *
 * One repository has two names: the name of the folder that holds the checkout, and the `name` field of
 * `package.json`. Every report writes the package name. A report writes the folder name only when
 * `package.json` has no name. Two checkouts of one repository therefore give the same reports.
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
  test("every report carries the package name", async () => {
    const root = makeTree(TREE);
    const run = await runDepgraph(root);
    expect(run.code).toBe(0);
    expect(basename(root)).not.toBe(PACKAGE_NAME);

    const graph = JSON.parse(run.report("dependency-graph.json")) as { metadata: { name: string } };
    expect(graph.metadata.name).toBe(PACKAGE_NAME);
    // YAML quotes a scalar that starts with "@".
    expect(run.report("dependency-graph.yaml")).toContain(`\n  name: '${PACKAGE_NAME}'\n`);
    expect(run.report("dependency-summary.compact.json")).toContain(`"n":"${PACKAGE_NAME}"`);
    expect(run.report("DEPENDENCY_GRAPH.md")).toContain(`# ${PACKAGE_NAME} - Dependency Graph`);
    expect(run.report("dependency-layers.json")).toContain(`"name": "${PACKAGE_NAME}"`);
  });

  test("two checkouts of one repository give graphs with one name", async () => {
    const first = await runDepgraph(makeTree(TREE));
    const second = await runDepgraph(makeTree(TREE));
    const name = (run: typeof first): string =>
      (JSON.parse(run.report("dependency-graph.json")) as { metadata: { name: string } }).metadata
        .name;
    expect(name(first)).toBe(name(second));
    expect(first.report("dependency-summary.compact.json")).toBe(
      second.report("dependency-summary.compact.json"),
    );
  });

  test("without a package name every report uses the folder name", async () => {
    const root = makeTree({ ...TREE, "package.json": JSON.stringify({ version: "1.2.3" }) });
    const folder = basename(root);
    const run = await runDepgraph(root);
    expect(run.code).toBe(0);
    const graph = JSON.parse(run.report("dependency-graph.json")) as { metadata: { name: string } };
    expect(graph.metadata.name).toBe(folder);
    expect(run.report("DEPENDENCY_GRAPH.md")).toContain(`# ${folder} - Dependency Graph`);
  });

  test("an empty or non-string package name falls back to the folder name", async () => {
    for (const name of ["", 42, null]) {
      const root = makeTree({
        ...TREE,
        "package.json": JSON.stringify({ name, version: "1.2.3" }),
      });
      const run = await runDepgraph(root);
      expect(run.code).toBe(0);
      const graph = JSON.parse(run.report("dependency-graph.json")) as {
        metadata: { name: string };
      };
      expect(graph.metadata.name).toBe(basename(root));
    }
  });
});
