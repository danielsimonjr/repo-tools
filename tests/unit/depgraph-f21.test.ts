/**
 * Fix F21: in DEPENDENCY_GRAPH.md, an export list of more than 8 names renders as a fenced `text`
 * block under its label, wrapped at 100 characters. A list of 8 names or fewer stays inline. The
 * names and their order do not change.
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
  EXPORT_LIST_WRAP_WIDTH,
  LONG_EXPORT_LIST_THRESHOLD,
  renderExportList,
} from "../../src/depgraph/reporters/markdown.ts";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

/** `count` names: `name01`, `name02`, ... */
function names(count: number, stem = "name"): string[] {
  return Array.from({ length: count }, (_, i) => `${stem}${String(i + 1).padStart(2, "0")}`);
}

/** The names of rendered export-list lines, inline or fenced, in order. */
function namesOf(lines: readonly string[]): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (line.trim() === "```text") inFence = true;
    else if (line.trim() === "```") inFence = false;
    else if (inFence)
      out.push(
        ...line
          .trim()
          .split(/,\s*|\s+/)
          .filter(Boolean),
      );
    else for (const m of line.matchAll(/`([^`]+)`/g)) out.push(m[1] ?? "");
  }
  return out;
}

describe("F21: long export lists render as fenced blocks", () => {
  test("the threshold is 8 names and the width is 100", () => {
    expect(LONG_EXPORT_LIST_THRESHOLD).toBe(8);
    expect(EXPORT_LIST_WRAP_WIDTH).toBe(100);
  });

  test("an 8-name list stays inline", () => {
    const lines: string[] = [];
    renderExportList(lines, "Functions", names(8));
    expect(lines).toEqual([`- Functions: \`${names(8).join("`, `")}\``]);
  });

  test("a 9-name list is a fence under its label", () => {
    const lines: string[] = [];
    renderExportList(lines, "Functions", names(9));
    expect(lines).toEqual([
      "- Functions:",
      "",
      "  ```text",
      `  ${names(9).join(", ")}`,
      "  ```",
      "",
    ]);
  });

  test("a long list wraps at 100 characters and keeps every name in order", () => {
    const long = names(40, "longExportName");
    const lines: string[] = [];
    renderExportList(lines, "Constants", long);
    const body = lines.slice(3, -2);
    expect(body.length).toBeGreaterThan(1);
    for (const row of body) expect(row.length - 2).toBeLessThanOrEqual(100);
    expect(namesOf(lines)).toEqual(long);
  });

  test("an empty list renders nothing", () => {
    const lines: string[] = [];
    renderExportList(lines, "Enums", []);
    expect(lines).toEqual([]);
  });

  test("DEPENDENCY_GRAPH.md fences a 9-function list and keeps a 2-constant list inline", async () => {
    const fns = names(9, "fn");
    const root = makeTree({
      "package.json": '{ "name": "f21", "version": "1.0.0" }',
      "src/index.ts":
        "/** Entry. */\n" +
        fns.map((n) => `export function ${n}(): number {\n  return 1;\n}\n`).join("") +
        "export const one = 1;\nexport const two = 2;\n",
    });
    const result = await runDepgraph(root);
    expect(result.code).toBe(0);
    const md = result.report("DEPENDENCY_GRAPH.md");
    expect(md).toContain(`- Functions:\n\n  \`\`\`text\n  ${fns.join(", ")}\n  \`\`\`\n`);
    expect(md).toContain("- Constants: `one`, `two`\n");
    const exportLines = md.split("**Exports:**\n")[1]?.split("\n---\n")[0]?.split("\n") ?? [];
    expect(namesOf(exportLines)).toEqual([...fns, "one", "two"]);
  });
});
