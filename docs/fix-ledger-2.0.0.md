<!-- repo-map:no-verification -->
<!-- This ledger records how 1.x fixes map onto the 2.0 engine. It makes no claim about the graph of this repository. -->

# Fix ledger for the 2.0.0 engine

`repo-tools depgraph` is an alias of `repo-tools map`. The 1.x runner, regex parser, scanner,
inventory reporter and `tests/golden/depgraph` are deleted. Each 1.x fix (F1–F44, M1, R1) is
either locked by a test that runs `map`, or recorded here as having no 2.0.0 meaning.

## Locked by a `map` test

| Fix | What the test locks |
| --- | --- |
| F1 | Two `map` runs of a fixture agree after the folder basename is masked. |
| F2 | Discovery sorts after the walk. Reversing `readdir` does not change the report bytes. |
| F3 | Every Markdown report of a `map` run starts with the banner of `repo-tools map`. |
| F4 | The `js-yaml` 5 pin stays. The 1.x golden byte-compare is gone with the 1.x goldens. |
| F5 | The YAML probe still round-trips. |
| F6 | A comment inside export braces is not part of a name. The tree-sitter reader and the API-surface reader both lock this. |
| F7 | A `dist/` target maps to `src/`. |
| F8 | An export and a file that only a test imports are not unused. |
| F9 | A file that no root reaches stays in the graph as an orphan. |
| F10 | Coverage follows a side-effect import, including through a cycle. |
| F11 | The exit rows of a bad flag, a missing root and an empty repository. |
| F12 | The census is the source set. A folder named `test/` is source unless the file name is a test. |
| F14, F37 | Every tsup `entry` array, and the object form, seeds a build root. The config is read when it exists. |
| F15 | `package-export-surfaces.json` lists names that a package root exports. |
| F16 | The default report folder is the lowercase path `docs/architecture`. |
| F17 | A `bin` target, an `exports` subpath, a test-only file, a `tsc -p` tsconfig and a root-config `new URL` are the dispositions the inventory reports. |
| F18 | A `.d.ts` file is not in the coverage denominator. |
| F19 | Coverage policy categories. |
| F20 | A report path does not leak the absolute root. |
| F21 | Long export lists in Markdown, and the statistics table. |
| F22 | Code-unit sort. No `localeCompare`. |
| F23 | The duplicate gate and its flags. |
| F24 | Unused exports split into "unreferenced anywhere" and "referenced in their own module". The count uses the comment mask. The report does not print "1 in-file ref". |
| F25 | Runtime and type-only cycles. The edge-kind cases live on the tree-sitter reader. The component lives in `dependency-layers.json`. |
| F26 | Strongly connected components are in `dependency-layers.json`. The core statistics keep `runtimeCircularDeps`. YAML has no `cyclicComponents` key. |
| F27 | An import edge stores the resolved path. A `//` inside a string does not remove an import. |
| F28 | An export whose name contains `$` is counted inside its file. |
| F29 | Each `export ... from` is one edge. A value re-export and a type re-export of the same file are two edges. |
| F30 | A directory import lands on `index.ts`. The layers report holds the `.tsx` cycle. |
| F31 | `entryPoints` in `dependency-layers.json` lists `src/index.ts`. The core `reachability.roots` list is the same roots. |
| F32 | A single-package module key is `entry`, `root`, or the first directory name under `src/`, including a name such as `lib.ts`. |
| F33 | A `node ./dist/gen.js` script makes `src/gen.ts` a build entry. |
| F34 | A folder link is not followed. A dangling link is listed in `skippedLinks`. |
| F35 | A `package.json` that is not an object warns and does not abort the run. A script that is not a string warns. |
| F38 | A runtime `import()` records `["*"]`. A type-position `import('./c').C` records `C` (the 1.x result "no names" is not kept). A static import beside `import()` records the static names and `*`. |
| F39 | `a++ / b` is division. `if (x) /re/` is a regular expression. |
| F40 | `import().then(cb)` and `import().then<T>(cb)` are runtime edges. |
| F42 | A source file on disk that git does not track warns. `--strict-census` fails. `--check-census` compares the committed inventory with the git census. |
| F43 | A self-import resolves through `exports` or `main`, then `src/<sub>.ts`, then `src/<sub>/index.ts`. The mapped target is a root. |
| M1 | An orphan warns. `--strict-orphans` exits 1. Roots come from `exports` and `bin`. |
| R1 | Every report ends with one LF. The goldens live under `tests/golden/map`. |

## No 2.0.0 meaning

These 1.x behaviors are not reimplemented. The tests lock the 2.0 result instead.

- **Scan-scope flags.** `--src`, `--tests`, `--exclude`, `--also-exclude`, `--all` / `-a`,
  `--reachable-only` and `--include-tests` / `-t` make `map` exit 1. The same keys in the config
  file warn and are ignored. The census is the set of files that git tracks (or a pruned walk
  outside a git work tree). `--reachable-only` does not remove files.
- **1.x stdout.** `map` does not print `Monorepo detected`, `Found N TypeScript files`,
  `Entry points:` or `FILE CENSUS SELF-CHECK`. The first line is
  `Language: typescript; N source files; R roots`.
- **F13.** The language line replaces the 1.x monorepo banner.
- **F36 and F41.** A negated workspace pattern still drops that package from workspace
  detection, so it contributes no root. The census keeps the files. They show as orphans. The
  1.x census walk that skipped those folders is not restored.
- **F44.** A `.d.ts` file with no importer stays in "Files with no in-repo importer". The 1.x
  rule that omitted `.d.ts` from that list is not restored. Classified duplicate lists still
  skip a `.d.ts` definer.
- **F24 report shape.** The 2.0 unused report uses its own section titles. The report does not
  print the 1.x "in-file ref" suffix.
- **Regex `parseFile`.** Double edges and the other regex-parser results have no 2.0 reader.
  The tree-sitter reader replaces them.
- **Metadata name.** The core graph names the folder. A missing package version is `"unknown"`
  on the layers report, not on the core graph.

`docs/parity-2.0.0.md` records the verdicts that compare the engine with the Python tool and
with depgraph 1.x. The dynamic-`import()` verdict is `repo_map-wrong`. The bodiless
`export function` verdict is `repo_map-kept`.
