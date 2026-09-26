/**
 * The map engine's graph as depgraph's parsed-file records, so that depgraph's analyzers (layers,
 * cyclic components, coverage, surfaces) run on the one graph for every language (design
 * decisions D3 and D5).
 *
 * Each internal edge carries its resolved target (`resolved`), so an analyzer never resolves a
 * specifier again. The specifier (`file`) is the one the source writes; an edge with none (a Rust
 * `mod` declaration) gets the target relative to the importing file. The package name comes from
 * the workspace folders, as in 1.x. One fact of a 1.x parse is not in the graph, and the records
 * say so by an empty list: the workspace edges. The reader names a default import `default` and
 * a namespace import `*`.
 */
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { extractDescription } from "../depgraph/parser.ts";
import type {
  Dependency as DepgraphDependency,
  ParsedFile,
  WorkspacePackage,
} from "../depgraph/types.ts";
import { detectWorkspaces } from "../depgraph/workspaces.ts";
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

/**
 * The package and built-in imports of `node`, one entry for each import statement as depgraph
 * lists them. A TypeScript built-in loses its `node:` prefix, as in depgraph. A node without its
 * import list (a hand-built graph) gives one entry for each specifier, with no names.
 */
function packageLists(
  node: FileNode,
  language: string,
): Pick<ParsedFile, "externalDependencies" | "nodeDependencies"> {
  const moduleName = (spec: string): string =>
    language === "typescript" ? spec.replace(/^node:/, "") : spec;
  if (!node.packageImports) {
    return {
      externalDependencies: node.external.map((p) => ({ package: p, imports: [] })),
      nodeDependencies: node.nodeBuiltins.map((m) => ({ module: moduleName(m), imports: [] })),
    };
  }
  return {
    externalDependencies: node.packageImports
      .filter((i) => !i.builtin)
      .map((i) => ({ package: i.specifier, imports: [...i.names] })),
    nodeDependencies: node.packageImports
      .filter((i) => i.builtin)
      .map((i) => ({ module: moduleName(i.specifier), imports: [...i.names] })),
  };
}

/**
 * The workspace package of `path`, as depgraph 1.x names it: the first workspace, other than the
 * root package, whose folder holds the file. Null outside every workspace.
 */
function packageNameOf(path: string, workspaces: Map<string, WorkspacePackage>): string | null {
  for (const [name, ws] of workspaces) {
    if (ws.directory !== "" && path.startsWith(`${ws.directory}/`)) return name;
  }
  return null;
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
 * built from; the description of a TypeScript file reads its comments from there. With
 * `allAreas`, the records hold the files of every area. With `loadEdges`, each record also gets
 * its dynamic and unresolved relative loads, for test coverage only.
 */
export function toParsedFiles(
  graph: RepoGraph,
  root: string,
  options: { allAreas?: boolean; loadEdges?: boolean } = {},
): ParsedFile[] {
  const records: ParsedFile[] = [];
  const workspaces = detectWorkspaces(root);
  for (const node of graph.files.values()) {
    if (node.area !== "src" && !options.allAreas) continue;
    const internalDependencies = node.internal.map(
      (d): DepgraphDependency => ({
        file: d.specifier ?? relativeSpecifier(node.path, d.file),
        imports: [...d.imports],
        ...(d.reExport ? { reExport: true } : {}),
        ...(d.typeOnly ? { typeOnly: true } : {}),
        ...(d.sideEffect ? { sideEffect: true } : {}),
        resolved: d.file,
      }),
    );
    if (options.loadEdges) {
      // Loads that the graph has no edge for: a literal `import(...)`, and a relative specifier
      // that resolves to no source file (for example `../dist/x.js`). They carry no resolved
      // target, so depgraph resolves them as 1.x does, with its `dist/` to `src/` mapping.
      const loads = [
        ...(node.dynamicImports ?? []),
        ...node.broken.filter((s) => s.startsWith(".")),
      ];
      for (const spec of loads) internalDependencies.push({ file: spec, imports: [] });
    }
    records.push({
      path: node.path,
      name: stem(node.path),
      ...packageLists(node, graph.language),
      internalDependencies,
      workspaceDependencies: [],
      packageName: packageNameOf(node.path, workspaces),
      exports: exportsOf(node),
      description: DESCRIBED_LANGUAGES.has(graph.language)
        ? extractDescription(readFileSync(join(root, node.path), "utf8"))
        : null,
    });
  }
  return records;
}
