/**
 * The map engine's graph as depgraph's parsed-file records, so that depgraph's analyzers (layers,
 * cyclic components, coverage, surfaces) run on the one graph for every language (design
 * decisions D3 and D5).
 *
 * Each internal edge carries its resolved target (`resolved`), so an analyzer never resolves a
 * specifier again. The specifier (`file`) is the target relative to the importing file, for the
 * reports that show it. Three facts of a 1.x parse are not in the graph, and the records say so
 * by an empty value: the names imported from a package or a built-in, the workspace edges, and
 * a package name.
 */
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { extractDescription } from "../depgraph/parser.ts";
import type { Dependency as DepgraphDependency, ParsedFile } from "../depgraph/types.ts";
import type { FileNode, RepoGraph } from "./schema.ts";

/** The export kinds that are types, not values: depgraph lists them apart from `named`. */
const TYPE_KINDS = new Set(["interface", "type"]);
/** The languages whose comments `extractDescription` reads (JSDoc and `//`). */
const DESCRIBED_LANGUAGES = new Set(["typescript"]);

/** The specifier of `target` as the file `from` would write it: relative, with a leading `./`. */
function relativeSpecifier(from: string, target: string): string {
  const rel = posix.relative(posix.dirname(from), target);
  return rel.startsWith("../") ? rel : `./${rel}`;
}

/** The file name without its last extension, as depgraph names a file. */
function stem(path: string): string {
  const base = posix.basename(path);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** The export lists of `node`, in depgraph's kinds. */
function exportsOf(node: FileNode): ParsedFile["exports"] {
  const kinds = node.exportKinds ?? {};
  const ofKind = (kind: string): string[] => node.exports.filter((n) => kinds[n] === kind);
  const hasDefault = "default" in kinds;
  return {
    named: node.exports.filter((n) => !TYPE_KINDS.has(kinds[n] ?? "")),
    default: hasDefault ? (node.defaultExportLocal ?? "default") : null,
    types: node.exports.filter((n) => TYPE_KINDS.has(kinds[n] ?? "")),
    interfaces: ofKind("interface"),
    enums: ofKind("enum"),
    classes: ofKind("class"),
    functions: ofKind("function"),
    constants: ofKind("const"),
    reExported: [...new Set(node.reExports ?? [])],
  };
}

/**
 * The records of the `src` files of `graph`, in census order. `root` is the folder the graph was
 * built from; the description of a TypeScript file reads its comments from there.
 */
export function toParsedFiles(graph: RepoGraph, root: string): ParsedFile[] {
  const records: ParsedFile[] = [];
  for (const node of graph.files.values()) {
    if (node.area !== "src") continue;
    const internalDependencies = node.internal.map(
      (d): DepgraphDependency => ({
        file: relativeSpecifier(node.path, d.file),
        imports: [...d.imports],
        ...(d.reExport ? { reExport: true } : {}),
        ...(d.typeOnly ? { typeOnly: true } : {}),
        resolved: d.file,
      }),
    );
    records.push({
      path: node.path,
      name: stem(node.path),
      externalDependencies: node.external.map((p) => ({ package: p, imports: [] })),
      nodeDependencies: node.nodeBuiltins.map((m) => ({ module: m, imports: [] })),
      internalDependencies,
      workspaceDependencies: [],
      packageName: null,
      exports: exportsOf(node),
      description: DESCRIBED_LANGUAGES.has(graph.language)
        ? extractDescription(readFileSync(join(root, node.path), "utf8"))
        : null,
    });
  }
  return records;
}
