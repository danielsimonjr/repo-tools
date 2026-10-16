/**
 * The map engine reads a `.tsx` or `.jsx` file with the TSX grammar.
 *
 * The TypeScript grammar cannot read JSX. It gives ERROR nodes for the JSX, and the export
 * statements that survive the error recovery depend on the text of the file. The same file then
 * has a different export list with and without doc comments. TSX is the grammar for a file that
 * has JSX.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { grammarFor, loadGrammar } from "../../src/map/grammars.ts";
import { parseTs } from "../../src/map/parsing.ts";
import { graphFile, makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

// A component file with two exports and no comment. With the TypeScript grammar the reader found
// only `Skeleton`. The reader found both names after the file had doc comments.
const SKELETON = `import { cn } from '@utils/cn';

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  rounded?: boolean;
}

export function Skeleton({ className, width, height, rounded = false }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse bg-gray-200 dark:bg-gray-700',
        rounded ? 'rounded-full' : 'rounded',
        className
      )}
      style={{ width, height }}
      role="status"
      aria-label="Loading"
    />
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} role="status" aria-label="Loading text">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className="h-4"
          width={i === lines - 1 ? '60%' : '100%'}
        />
      ))}
    </div>
  );
}
`;

const DOCUMENTED = SKELETON.replace(
  "export function Skeleton(",
  "/**\n * An animated placeholder block.\n *\n * @param props The block size.\n */\nexport function Skeleton(",
).replace(
  "export function SkeletonText(",
  "/**\n * A placeholder for lines of text.\n *\n * @param props The line count.\n */\nexport function SkeletonText(",
);

// The same component file with its types removed, as a `.jsx` file holds it.
const untyped = (text: string): string =>
  text
    .replace(": SkeletonProps", "")
    .replace(/interface SkeletonProps \{[^}]*\}\n\n/, "")
    .replace(": { lines?: number; className?: string }", "");
const JSX_SOURCE = untyped(SKELETON);
const JSX_DOCUMENTED = untyped(DOCUMENTED);

// A `.js`, `.mjs` or `.cjs` file can hold JSX too. Each suffix needs the same grammar as `.jsx`.
const JS_SUFFIXES = ["js", "mjs", "cjs"];

const SKELETON_EXPORTS = ["Skeleton", "SkeletonText"];

describe("a graph of a repository that has JSX files", () => {
  const PACKAGE = JSON.stringify({ name: "jsx", version: "1.0.0" });

  test("every export of a .tsx file is in the graph, with and without doc comments", async () => {
    const plain = await runDepgraph(
      makeTree({ "package.json": PACKAGE, "src/Skeleton.tsx": SKELETON }),
    );
    const commented = await runDepgraph(
      makeTree({ "package.json": PACKAGE, "src/Skeleton.tsx": DOCUMENTED }),
    );
    expect(plain.code).toBe(0);
    expect(commented.code).toBe(0);
    expect(graphFile(plain.graph(), "src/Skeleton.tsx")?.exports).toEqual(SKELETON_EXPORTS);
    expect(graphFile(commented.graph(), "src/Skeleton.tsx")?.exports).toEqual(SKELETON_EXPORTS);
    expect(plain.graph().metadata.totalExports).toBe(2);
    expect(commented.graph().metadata.totalExports).toBe(2);
  });

  test("every export of a .jsx file is in the graph", async () => {
    const run = await runDepgraph(
      makeTree({ "package.json": PACKAGE, "src/Skeleton.jsx": JSX_SOURCE }),
    );
    expect(run.code).toBe(0);
    expect(graphFile(run.graph(), "src/Skeleton.jsx")?.exports).toEqual(SKELETON_EXPORTS);
  });

  test.each(JS_SUFFIXES)(
    "every export of a .%s file that holds JSX is in the graph, with and without doc comments",
    async (suffix) => {
      const file = `src/Skeleton.${suffix}`;
      const plain = await runDepgraph(makeTree({ "package.json": PACKAGE, [file]: JSX_SOURCE }));
      const commented = await runDepgraph(
        makeTree({ "package.json": PACKAGE, [file]: JSX_DOCUMENTED }),
      );
      expect(plain.code).toBe(0);
      expect(commented.code).toBe(0);
      expect(graphFile(plain.graph(), file)?.exports).toEqual(SKELETON_EXPORTS);
      expect(graphFile(commented.graph(), file)?.exports).toEqual(SKELETON_EXPORTS);
    },
  );
});

describe("grammarFor: the grammar follows the extension", () => {
  test.each([
    ["src/a.tsx", "tsx"],
    ["a.jsx", "tsx"],
    ["a.js", "tsx"],
    ["a.mjs", "tsx"],
    ["a.cjs", "tsx"],
    ["a.ts", "typescript"],
    ["a.d.ts", "typescript"],
    ["a.tsx.ts", "typescript"],
    ["a.jsx.ts", "typescript"],
    ["", "typescript"],
  ] as const)("%j gives the %s grammar", (path, grammar) => {
    expect(grammarFor(path)).toBe(grammar);
  });
});

describe("parseTs: the grammar follows the file extension", () => {
  beforeAll(async () => {
    await loadGrammar("typescript");
    await loadGrammar("tsx");
  });

  test("a .tsx file gives every export, with no comment in the file", () => {
    expect(parseTs(SKELETON, "src/Skeleton.tsx").exports).toEqual(SKELETON_EXPORTS);
  });

  test("a .tsx file gives the same exports with doc comments in the file", () => {
    expect(parseTs(DOCUMENTED, "src/Skeleton.tsx").exports).toEqual(SKELETON_EXPORTS);
  });

  test("a .jsx file gives every export", () => {
    expect(parseTs(JSX_SOURCE, "src/Skeleton.jsx").exports).toEqual(SKELETON_EXPORTS);
  });

  test.each(JS_SUFFIXES)("a .%s file that holds JSX gives every export", (suffix) => {
    expect(parseTs(JSX_SOURCE, `src/Skeleton.${suffix}`).exports).toEqual(SKELETON_EXPORTS);
    expect(parseTs(JSX_DOCUMENTED, `src/Skeleton.${suffix}`).exports).toEqual(SKELETON_EXPORTS);
  });

  // This test is a guard, not a red test. Plain JavaScript can use `<` and `>` as comparison
  // operators. The TSX grammar must read these files as before, because a `.js` file now uses it.
  const COMPARISONS =
    "export const lt = (a, b) => a < b;\nexport const gt = (a, b) => a > b;\n" +
    "export const inside = (x) => x > 0 && x < 1;\n" +
    "export const call = (f, a, b, c) => f(a < b, c > (1));\n";

  test.each(JS_SUFFIXES)("a .%s file with comparison operators gives every export", (suffix) => {
    expect(parseTs(COMPARISONS, `src/c.${suffix}`).exports).toEqual(["lt", "gt", "inside", "call"]);
  });

  // An angle-bracket type assertion is valid TypeScript, but TSX reads it as a JSX element.
  const ASSERTIONS = "export const one = <number>1;\nexport const two = <number>2;\n";

  test("a .ts file keeps the TypeScript grammar and reads an angle-bracket assertion", () => {
    expect(parseTs(ASSERTIONS, "src/n.ts").exports).toEqual(["one", "two"]);
  });

  test("a call without a path keeps the TypeScript grammar", () => {
    expect(parseTs(ASSERTIONS).exports).toEqual(["one", "two"]);
  });
});
