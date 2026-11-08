/**
 * The optional hooks of the shared doc driver: `docSiteOf`, `adjacentDoc`, `nameOf`, `reports` and
 * the node argument of `read`. The tests run a small Go reader. C# and Rust use none of the hooks, and their
 * own test files hold their behaviour.
 */
import { describe, expect, test } from "bun:test";
import type { Node } from "web-tree-sitter";
import { analyseWith, type DocText, type Reader } from "../../src/docs/comments.ts";

/** The declaration that holds one type spec alone: its doc sits above the `type` keyword. */
const lone = (node: Node): boolean =>
  node.type === "type_spec" &&
  node.parent?.type === "type_declaration" &&
  !node.parent.children.some((c) => c.type === "(");

const seen: string[] = [];

const GO: Reader = {
  language: "go",
  grammar: "go",
  declarations: ["function_declaration", "type_spec"],
  isDoc: (node) => node.type === "comment",
  isSkipped: () => false,
  docSiteOf: (node) => (lone(node) && node.parent ? node.parent : node),
  adjacentDoc: (comment, below) => comment.endPosition.row + 1 >= below.startPosition.row,
  nameOf: (node) => `N:${node.childForFieldName("name")?.text ?? "?"}`,
  anchorOf: (node) => (lone(node) && node.parent ? node.parent : node),
  kindOf: (node) => (node.type === "type_spec" ? "type" : "function"),
  isExported: () => true,
  paramsOf: () => [],
  returnsValueOf: () => undefined,
  read: (run, node): DocText => {
    seen.push(`${node.type}:${run.length}`);
    return { docParams: [], summary: run[0]?.text ?? "", dialect: "", prose: "" };
  },
};

const symbols = async (src: string) => (await analyseWith(GO, "a.go", src)).symbols;

describe("the optional hooks of the doc driver", () => {
  test("adjacentDoc stops the walk at a blank line", async () => {
    const [far, near] = await symbols(
      "package a\n\n// far\n\nfunc F() {}\n\n// near one\n// near two\nfunc G() {}\n",
    );
    expect(far?.hasDoc).toBe(false);
    expect(near?.hasDoc).toBe(true);
    expect(near?.summary).toBe("// near one");
  });

  test("a lone type spec takes the doc above its declaration, and the stub goes there", async () => {
    const [one] = await symbols("package a\n\n// T is a type.\ntype T struct{}\n");
    expect(one?.hasDoc).toBe(true);
    expect(one?.anchorLine).toBe(4);
  });

  test("a spec in a group takes the doc above the spec", async () => {
    const [a, b] = await symbols(
      "package a\n\n// A is a type.\ntype (\n\t// B is a type.\n\tB int\n\tA int\n)\n",
    );
    expect(a?.name).toBe("N:B");
    expect(a?.hasDoc).toBe(true);
    expect(a?.anchorLine).toBe(6);
    expect(b?.hasDoc).toBe(false);
    expect(b?.anchorColumn).toBe(1);
  });

  test("nameOf gives the name of the symbol, and read gets the node", async () => {
    seen.length = 0;
    const [f] = await symbols("package a\n// F does it.\nfunc F() {}\n");
    expect(f?.name).toBe("N:F");
    expect(seen).toEqual(["function_declaration:1"]);
  });

  test("reports drops a node of a declaration type that is not a symbol", async () => {
    const src = "package a\n\n// T is a type.\ntype T struct{}\n\n// F does it.\nfunc F() {}\n";
    const all = await symbols(src);
    expect(all.map((s) => s.name)).toEqual(["N:T", "N:F"]);
    const reader: Reader = { ...GO, reports: (node) => node.type !== "type_spec" };
    const kept = (await analyseWith(reader, "a.go", src)).symbols;
    expect(kept.map((s) => s.name)).toEqual(["N:F"]);
  });

  test("reports sees the node, so it can reject one node of a type and keep another", async () => {
    const src = "package a\n\nfunc F() {}\n\nfunc G() {}\n";
    const reader: Reader = {
      ...GO,
      reports: (node) => node.childForFieldName("name")?.text !== "F",
    };
    const kept = (await analyseWith(reader, "a.go", src)).symbols;
    expect(kept.map((s) => s.name)).toEqual(["N:G"]);
  });
});
