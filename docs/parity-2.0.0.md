<!-- repo-map:no-verification -->
<!-- This record measures other repositories; it makes no claim about the graph of this repository. -->

# Parity record of the 2.0.0 engine

This record gives the parity checks of the 2.0.0 engine (`repo-tools map`). Each named
repository is public on GitHub. The checks ran on 2026-09-25 and 2026-09-26.

- **Side 1:** the four core files of `map` against the Python tool `repo_map.py map`.
- **Side 2:** the extras of `map` against `repo-tools depgraph` 1.x.

Each difference has a measured cause. A difference is one of these verdicts: an approved change,
a deliberate difference, an expected improvement, a 1.x defect, or an open point for review.

## Side 1: the core files against `repo_map.py`

### Method

The script ran `repo_map.py map` and the engine on the same working tree of each repository. It
compared `dependency-graph.json`, `file-inventory.json`, `duplicate-symbols.json` and
`unused-analysis.json`. Before the compare, the script applied the approved changes only:

- **R1:** LF line ends (the Python tool writes CRLF on Windows).
- **R3:** no `generated` date.
- **R4:** a warning names "the root", not the absolute root path.
- The schema version is `2.0.0`.
- Paths sort by code unit. The script compares objects, so key order has no effect.
- The 2.0.0 additions are removed: the D2 statistics keys, `byPackage` and `skippedLinks` (D4),
  and the classified lists of `duplicate-symbols.json` with their summary keys (D4).

### Result

| Repository | Files | Result |
| --- | --: | --- |
| memoryjs | 696 | identical |
| Mathts | 1919 | the two deliberate workspace differences only (see below) |
| universal-physics-tensor | 898 | identical |
| repo-tools | 243 | identical |
| PITS-MRAS | 95 | identical |
| auto-memory | 79 | identical |
| fermat-mcp | 42 | identical |
| memvid | 29 | identical |
| IronClaw | 288 | identical |
| ui-mcp | 25 | identical |
| Windows-mcp | 168 | identical |

The languages are TypeScript, Python (PITS-MRAS, auto-memory, fermat-mcp, memvid), Rust
(IronClaw) and C# (ui-mcp, Windows-mcp).

**Control for Mathts.** With the two workspace changes switched off, the four files of Mathts
are identical to the Python tool.

### Deliberate differences from the Python tool

1. **Workspace roots.** The Python tool reads the root `package.json` only. In a workspace
   monorepo, it finds no root, so each workspace source file shows as an orphan. The engine also
   reads the `package.json` of each workspace package. On Mathts, the roots go from 0 to 1167,
   and the disposition of each file equals depgraph 1.x.
2. **Workspace imports.** The Python tool keeps `import { x } from "@scope/pkg"` as an external
   package, so a monorepo has no edges between its packages. The engine resolves the import to
   the entry file of the workspace package when the census holds that file. On Mathts, 359 more
   edges are internal. 485 exports that other packages use are no longer counted as unused.
   Also, a name that a file re-exports from another package is no longer a second definition
   of that name.

### Defects of the Python tool that the engine keeps

The engine keeps these behaviors of the Python tool, so that side 1 stays exact. Each one has an
open item in `todo.md`:

- The Rust `use` reader cuts a name at the letters `as` inside a word (`HashMap` gives `H`).
  The new `pub use` reader of the export surface does not have this defect.
- A bodiless `export function f(): T;` in a declaration file is not an export.

## Side 2: the extras against depgraph 1.x

### Method

The checks ran on clones of memoryjs, Mathts and universal-physics-tensor at their default
branches. The same tree went to depgraph 1.x and to the engine. After each change to the
depgraph code that both engines share, depgraph 1.x wrote its 12 reports on memoryjs again. All
12 were byte-identical to the first 1.x run.

### Result

| Output | Result |
| --- | --- |
| `dependency-layers.json` (`modules`, `entryPoints`, `layers`) | memoryjs: the same modules, files, entry points and layers. The field differences are in the list below. |
| Workspace edges | Mathts: 197 edges in each engine. 1175 of 1178 files are identical, and the three others differ by the `* as X` naming only. |
| Per-kind export counts (D2) | memoryjs: the same names of each kind in each of the 292 files |
| Dispositions | Mathts: identical in each of the 1873 files that both censuses hold |
| Classified duplicate lists | Identical on the three repositories, apart from one 1.x definer that is a declaration file |
| Test coverage: tested files | Identical on the three repositories |
| `package-export-surfaces.json` | memoryjs: identical. Mathts and universal-physics-tensor: see the list below. |
| `--api-surface` | The mini-repo fixture: byte-identical to the 1.x golden |

### Differences and their verdicts

- **Scope (approved, D1).** The core statistics count the files of every area. depgraph 1.x
  counted its `src` files. On memoryjs, the count is 697 files against 292, and the totals in
  `DEPENDENCY_GRAPH.md` and the compact summary follow the core statistics.
- **JavaScript files (approved, D1).** The census reads JavaScript files. depgraph 1.x read
  `.ts` and `.tsx` only.
- **`import()` (open point for review).** depgraph 1.x records a dynamic `import()` as a graph
  edge, and the core graph (D1) does not. On memoryjs, one type-only cyclic component has 3
  files, not 7. Test coverage counts a literal `import()` in a test file as a load, so the tested
  files do not change.
- **Local `export type { X }` (expected improvement).** The 1.x reader does not find this form.
  The engine lists the name. On Mathts, 23 surface names are added.
- **`export * as ns from` (expected improvement).** The 1.x reader does not find the name `ns`.
- **`export type { … } from` (1.x defect).** depgraph 1.x also adds an untyped re-export edge,
  so a type-only re-export counts as a runtime edge.
- **Repeated names (1.x defect).** depgraph 1.x counts each overload or merged declaration of a
  name. For example, it counts `findEntityByName` 4 times.
- **A string that holds export text (1.x defect).** The 1.x reader finds `export const path` in
  a string literal of Mathts.
- **Default and namespace imports (listed naming difference).** The engine names a default
  import `default` and a namespace import `*`. depgraph 1.x uses the local name and `* as X`.
- **Declaration files (engine fix).** A `.d.ts` file declares a name and has no body. The
  classified duplicate lists do not count a declaration file as a definer.

## Defects that the parity checks found and fixed

The side-2 checks found these defects of the engine. Each fix has a test that failed first.

1. A declaration file counted as a duplicate definer (Mathts: 229 actionable names became 477).
2. The adapter gave no workspace package to a file.
3. Barrel expansion replaced the `*` of a bare `export *` edge. So the public-surface walk
   stopped after one step, and a name deep in an `export *` chain was not public.
4. A source file that a test loads by `import()`, or through a relative `dist/` path, was not
   covered.
5. A fixture file in a tests folder counted as a test.
6. Workspace roots, and workspace imports (see side 1).
7. The Node bundle did not have the tree-sitter `.wasm` files.
