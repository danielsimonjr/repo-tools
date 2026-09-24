/**
 * Fix F6: a comment inside a multi-line `{ }` import or export block is not part of a symbol
 * name. No report row holds comment text.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { graphFile, makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

const LIB = `/** Library. */
export const alpha = 1;
export const bravo = 2;
export const charlie = 3;
export type Delta = string;
`;

const INDEX = `/** Entry. */
import {
  alpha, // NOTE-A line comment after a name
  /* NOTE-B block comment before a name */ bravo,
} from './lib.js';

export {
  alpha, // NOTE-C line comment in an export list
  /* NOTE-D block comment
     over two lines */ bravo,
};

export {
  charlie, // NOTE-E line comment in a re-export list
} from './lib.js';

export type {
  // NOTE-F comment line in a type re-export list
  Delta,
} from './lib.js';
`;

describe("F6: comments inside { } import and export blocks", () => {
  test("no symbol in any report holds comment text", async () => {
    const root = makeTree({
      "package.json": '{ "name": "f6", "version": "1.0.0" }',
      "src/lib.ts": LIB,
      "src/index.ts": INDEX,
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const index = graphFile(result.graph(), "src/index.ts");
    expect(index?.exports).toEqual(["alpha", "bravo", "charlie", "Delta"]);
    const imported = (index?.internalDependencies ?? []).flatMap((d) => d.imports);
    expect(imported).toContain("alpha");
    expect(imported).toContain("bravo");
    for (const name of [
      "dependency-graph.json",
      "dependency-graph.yaml",
      "dependency-summary.compact.json",
      "DEPENDENCY_GRAPH.md",
      "unused-analysis.md",
      "duplicate-symbols.json",
      "package-export-surfaces.json",
    ]) {
      expect({ name, notes: result.report(name).match(/NOTE-[A-F]/g) }).toEqual({
        name,
        notes: null,
      });
    }
  });
});
