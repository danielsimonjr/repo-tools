/**
 * dependency-layers.json (design decision D3): depgraph's subsystem view, built on the map engine's
 * graph through the adapter, for every language (D5).
 *
 * `modules`, `entryPoints` and `layers` hold the `src` files and keep depgraph 1.x's shape.
 * `cyclicComponents` holds the files of every area, so its counts agree with the core statistics
 * of dependency-graph.json.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { categorizeFiles } from "../depgraph/analysis.ts";
import { detectCyclicComponents } from "../depgraph/cycles.ts";
import { entryPointsOf, layersOf, modulesJsonOf } from "../depgraph/reporters/json.ts";
import type { CyclicComponents, ModuleMap, ParsedFile } from "../depgraph/types.ts";
import { detectWorkspaces } from "../depgraph/workspaces.ts";
import { toParsedFiles } from "./adapter.ts";
import { writeJson } from "./artifacts.ts";
import { type RepoGraph, SCHEMA_VERSION } from "./schema.ts";

/** The name and version of a project: package.json's, else the folder name and "unknown". */
export interface ProjectIdentity {
  name: string;
  version: string;
}

/** Reads the project identity of `root`. A missing or malformed package.json is no error. */
export function projectIdentity(root: string, graph: RepoGraph): ProjectIdentity {
  let pkg: unknown = null;
  try {
    pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  } catch {
    // No readable package.json: the folder name and "unknown" stand in.
  }
  const field = (key: string): string | null => {
    if (typeof pkg !== "object" || pkg === null || Array.isArray(pkg)) return null;
    const value = (pkg as Record<string, unknown>)[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  return { name: field("name") ?? graph.name, version: field("version") ?? "unknown" };
}

/** The subsystem view of a graph: the `src` records, their modules and the cyclic components. */
export interface SubsystemView {
  records: ParsedFile[];
  modules: ModuleMap;
  cycles: CyclicComponents;
  isMonorepo: boolean;
}

/** Builds the subsystem view of `graph`. `warn` receives the workspace warnings. */
export function subsystemView(
  graph: RepoGraph,
  root: string,
  warn: (message: string) => void = () => {},
): SubsystemView {
  const records = toParsedFiles(graph, root);
  const workspaces = detectWorkspaces(root, warn);
  const isMonorepo = workspaces.size > 0;
  const modules = categorizeFiles(records, isMonorepo, workspaces);
  const cycles = detectCyclicComponents(toParsedFiles(graph, root, { allAreas: true }));
  return { records, modules, cycles, isMonorepo };
}

/** Writes dependency-layers.json into `outDir` and returns its path. */
export function emitDependencyLayers(
  graph: RepoGraph,
  root: string,
  outDir: string,
  view: SubsystemView = subsystemView(graph, root),
): string {
  const identity = projectIdentity(root, graph);
  return writeJson(join(outDir, "dependency-layers.json"), {
    metadata: {
      name: identity.name,
      version: identity.version,
      schemaVersion: SCHEMA_VERSION,
      language: graph.language,
    },
    entryPoints: entryPointsOf(view.records),
    modules: modulesJsonOf(view.modules),
    cyclicComponents: { runtime: view.cycles.runtime, typeOnly: view.cycles.typeOnly },
    layers: layersOf(view.modules),
  });
}
