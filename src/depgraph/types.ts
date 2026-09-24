/**
 * Shared types of the depgraph pipeline: the parsed-file record, the edges, the exports, the
 * statistics and the run context.
 */

/** A relative import edge (`./x.js`) of one file. */
export interface Dependency {
  /** The specifier as written in the source (not resolved). */
  file: string;
  imports: string[];
  reExport?: boolean;
  /** True when the edge carries types only. */
  typeOnly?: boolean;
  /** True for a bare side-effect import (`import './x.js';`): it binds no name (fix F10). */
  sideEffect?: boolean;
}

/** An import from a package that is not a workspace member and not a Node built-in. */
export interface ExternalDependency {
  package: string;
  imports: string[];
}

/** An import from a Node built-in module. */
export interface NodeDependency {
  module: string;
  imports: string[];
}

/** The export lists of one file. */
export interface FileExports {
  named: string[];
  default: string | null;
  types: string[];
  interfaces: string[];
  enums: string[];
  classes: string[];
  functions: string[];
  constants: string[];
  /** Re-exported symbols, and `* from <spec>` markers. */
  reExported: string[];
}

/** An import of a workspace package by its package name. */
export interface WorkspaceDependency {
  /** The workspace package name. */
  package: string;
  /** The workspace package directory. */
  directory: string;
  imports: string[];
  /** Set when the specifier names an `exports` subpath (`@scope/pkg/internal` gives "internal"). */
  subpath?: string;
}

/** The parse result of one TypeScript file. */
export interface ParsedFile {
  /** POSIX path, relative to the root. */
  path: string;
  name: string;
  externalDependencies: ExternalDependency[];
  nodeDependencies: NodeDependency[];
  internalDependencies: Dependency[];
  workspaceDependencies: WorkspaceDependency[];
  packageName: string | null;
  exports: FileExports;
  description: string | null;
}

/** Per file: the specifiers it imports and the files that import it. */
export interface DependencyMatrix {
  [path: string]: {
    importsFrom: string[];
    exportsTo: string[];
  };
}

/** The totals of one run. */
export interface Statistics {
  totalTypeScriptFiles: number;
  totalModules: number;
  totalLinesOfCode: number;
  totalExports: number;
  totalClasses: number;
  totalInterfaces: number;
  totalFunctions: number;
  totalTypeGuards: number;
  totalEnums: number;
  totalConstants: number;
  totalReExports: number;
  totalTypeOnlyImports: number;
  /** The number of runtime cyclic components (fix F26). */
  runtimeCyclicComponents: number;
  /** The number of type-only cyclic components (fix F26). */
  typeOnlyCyclicComponents: number;
  /** The number of distinct files in the runtime cyclic components. */
  runtimeFilesInCycles: number;
  /** The number of distinct files in the type-only cyclic components. */
  typeOnlyFilesInCycles: number;
  unusedFilesCount: number;
  unusedExportsCount: number;
}

/** One export that no other file imports. */
export interface UnusedExport {
  file: string;
  name: string;
  type: "function" | "class" | "interface" | "type" | "constant" | "enum" | "other";
  /**
   * References to the symbol in its own file, less its export definition. A value above 0
   * marks a type contract or a helper of a live export. A value of 0 marks a deletion
   * candidate.
   */
  inFileRefs: number;
}

/** The unused files and the unused exports. */
export interface UnusedAnalysis {
  unusedFiles: string[];
  unusedExports: UnusedExport[];
}

/** Module name to (file path to parsed file). */
export interface ModuleMap {
  [moduleName: string]: {
    [filePath: string]: ParsedFile;
  };
}

/** The fields of the root `package.json` that the reports use. */
export interface PackageJson {
  name: string;
  version: string;
}

/** One workspace package of a monorepo. */
export interface WorkspacePackage {
  /** The npm name, for example `@scope/core`. */
  name: string;
  /** The package directory, relative to the root, for example `packages/core`. */
  directory: string;
  /** The source directory, relative to the root, for example `packages/core/src`. */
  srcDir: string;
  /**
   * The source files of the extra build roots of the package: `exports` subpaths other than
   * ".", `bin` targets, script entries and tsup config entries. Paths are relative to the root.
   */
  extraEntries: string[];
}

/** One strongly connected component of the import graph that holds a cycle (fix F26). */
export interface CyclicComponent {
  /** The files of the component, in code-unit order. */
  members: string[];
  /** The shortest cycle through the first member. It starts and ends with that member. */
  cycle: string[];
}

/** The cyclic components of the import graph (fix F26), each list sorted by first member. */
export interface CyclicComponents {
  /** The strongly connected components of the runtime edges. */
  runtime: CyclicComponent[];
  /** The strongly connected components of all edges that are not identical to a runtime one. */
  typeOnly: CyclicComponent[];
}

/** The public API surface of the packages. */
export interface PublicSurface {
  /**
   * Files whose whole export list is public: a package root, or a file reached from a root by
   * a chain of `export *`.
   */
  publicWildcardFiles: Set<string>;
  /** `${path}::${name}` for each export that a named re-export chain makes public. */
  publicNamed: Set<string>;
  /** Public roots other than each `src/index.ts`: subpath, `bin` and config entries. */
  extraEntryPaths: Set<string>;
}

/** The parse and write state of one run. Paths are absolute unless the field says otherwise. */
export interface RunContext {
  /** The project root (absolute). */
  root: string;
  /** `<root>/src` (absolute). */
  srcDir: string;
  /** The output directory (absolute). */
  outputDir: string;
  packageJson: PackageJson;
  /** The workspace packages, keyed by npm name. Empty in single-package mode. */
  workspaces: Map<string, WorkspacePackage>;
}
