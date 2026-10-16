/**
 * The TypeScript reader of the map engine reads a `.tsx` or `.jsx` file with the TSX grammar.
 *
 * The TypeScript grammar cannot read JSX. It gives ERROR nodes for the JSX, and the export
 * statements that survive the error recovery depend on the text of the file. The same file then
 * has a different export list with and without doc comments. TSX is the grammar for a file that
 * has JSX.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { loadGrammar } from "../../src/map/grammars.ts";
import { parseTs } from "../../src/map/parsing.ts";

beforeAll(async () => {
  await loadGrammar("typescript");
  await loadGrammar("tsx");
});

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

describe("parseTs: the grammar follows the file extension", () => {
  test("a .tsx file gives every export, with no comment in the file", () => {
    expect(parseTs(SKELETON, "src/Skeleton.tsx").exports).toEqual(["Skeleton", "SkeletonText"]);
  });

  test("a .tsx file gives the same exports with doc comments in the file", () => {
    expect(parseTs(DOCUMENTED, "src/Skeleton.tsx").exports).toEqual(["Skeleton", "SkeletonText"]);
  });

  test("a .jsx file gives every export", () => {
    const jsx = SKELETON.replace(/: SkeletonProps/, "")
      .replace(/interface SkeletonProps \{[^}]*\}\n\n/, "")
      .replace(": { lines?: number; className?: string }", "");
    expect(parseTs(jsx, "src/Skeleton.jsx").exports).toEqual(["Skeleton", "SkeletonText"]);
  });

  test("a .ts file keeps the TypeScript grammar and reads an angle-bracket assertion", () => {
    const mod = parseTs(
      "export const one = <number>1;\nexport const two = <number>2;\n",
      "src/n.ts",
    );
    expect(mod.exports).toEqual(["one", "two"]);
  });

  test("a call without a path keeps the TypeScript grammar", () => {
    const mod = parseTs("export const one = <number>1;\n");
    expect(mod.exports).toEqual(["one"]);
  });
});
