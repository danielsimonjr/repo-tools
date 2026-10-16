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
const JSX_SOURCE = SKELETON.replace(": SkeletonProps", "")
  .replace(/interface SkeletonProps \{[^}]*\}\n\n/, "")
  .replace(": { lines?: number; className?: string }", "");

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
});

describe("grammarFor: the grammar follows the extension", () => {
  test.each([
    ["src/a.tsx", "tsx"],
    ["a.jsx", "tsx"],
    ["a.ts", "typescript"],
    ["a.js", "typescript"],
    ["a.mjs", "typescript"],
    ["a.tsx.ts", "typescript"],
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

  // An angle-bracket type assertion is valid TypeScript, but TSX reads it as a JSX element.
  const ASSERTIONS = "export const one = <number>1;\nexport const two = <number>2;\n";

  test("a .ts file keeps the TypeScript grammar and reads an angle-bracket assertion", () => {
    expect(parseTs(ASSERTIONS, "src/n.ts").exports).toEqual(["one", "two"]);
  });

  test("a call without a path keeps the TypeScript grammar", () => {
    expect(parseTs(ASSERTIONS).exports).toEqual(["one", "two"]);
  });
});
