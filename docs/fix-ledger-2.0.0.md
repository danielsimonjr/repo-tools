<!-- repo-map:no-verification -->
<!-- This ledger records how 1.x fixes map onto the 2.0 engine. It makes no claim about the graph of this repository. -->

# Fix ledger for the 2.0.0 engine

`repo-tools depgraph` is an alias of `repo-tools map`. The 1.x runner, regex parser, scanner,
inventory reporter and `tests/golden/depgraph` are deleted. A test that runs `map`, or a test of
a module that `map` uses, locks each 1.x fix (F1–F44, M1, R1).

`bun run audit:ledger` checks the locks. It reverts each fix in a scratch copy of the repository
and runs the tests. A fix is locked when a test of that fix fails. `docs/fix-ledger-audit.md`
holds the result, and `scripts/fix-ledger-mutations.ts` holds the reverts.

## Locked by a `map` test

| Fix | What the test locks |
| --- | --- |
| F1 | Two `map` runs under two different clocks give the same bytes. No report holds an ISO date. |
| F2 | The folder walks of `map` read through one reader, and discovery sorts after the read. A reversed reader does not change the report bytes. |
| F3 | Every Markdown report starts with the verification marker and the do-not-edit banner. The banner names the regenerate command. |
| F4 | The `js-yaml` 5 pin stays. The 1.x golden byte-compare is gone with the 1.x goldens. |
| F5 | The YAML quote probe runs before the YAML report is built. |
| F6 | A comment inside export braces is not part of a name. The tree-sitter reader and the API-surface reader both lock this. |
| F7 | A `dist/` import, and a `dist/src/` import, lands on `src/`. A `bin` that names `dist/src/cli.js` seeds `src/cli.ts`. |
| F8 | An export and a file that only a test imports are not unused. |
| F9 | The target of an `exports` subpath, and the files that it imports, are reachable. A file that no root reaches stays in the graph as an orphan. |
| F10 | Coverage follows a chain of bare side-effect imports. A namespace import does not carry coverage. |
| F11 | A dynamic `import()` gives a dependency edge. F25 locks the kind of the edge. |
| F12 | A single-package repository without `src/` is scanned. Each top-level folder that holds TypeScript is a source root and a module of `dependency-layers.json`. `dist/` and `tests/` are not. |
| F13 | A pnpm workspace in `pnpm-workspace.yaml` is detected. Each package of a `packages/*` glob and of a plain folder pattern is found. A workspace import resolves to the package entry. |
| F14, F37 | Every tsup `entry` array, and the object form, seeds a build root. The config is read when it exists. |
| F15 | `package-export-surfaces.json` lists the public surface of each package only. A name is public when a package root exports it, directly or through a re-export chain. |
| F16 | The default report folder is the lowercase path `docs/architecture`. |
| F17 | A `bin` target, an `exports` subpath, a package `src/index.ts`, a test-only file, a `tsc -p` tsconfig and a root-config `new URL` are the roots and dispositions that the inventory reports. |
| F18 | A `.d.ts` file is not in the coverage denominator. It stays in the graph. |
| F19 | A test that imports a barrel covers the files that the barrel re-exports, through `export *`, through `export { } from` and through a chain of barrels. |
| F20 | The privacy check fails when the git index tracks a `.exe` file. |
| F21 | In `DEPENDENCY_GRAPH.md`, an export list of more than 8 names is a fenced `text` block wrapped at 100 characters. A shorter list stays inline. |
| F22 | Code-unit sort. No `localeCompare`. |
| F23 | An `import()` with a backtick specifier and no `${` gives an edge. A template with a substitution gives none. |
| F24 | The in-file reference count reads the source without comments. A name in its own JSDoc or in a `//` comment is not a use. |
| F25 | A dynamic `import()` is a runtime edge unless it is in a type position. A runtime `import()` closes a runtime component. The edge-kind cases live on the tree-sitter reader. |
| F26 | Strongly connected components are in `dependency-layers.json`, sorted by smallest member. The core statistics keep `runtimeCircularDeps`. YAML has no `cyclicComponents` key. |
| F27 | A `//` inside a string does not remove an import on the same line. A `/*` inside a string does not remove the lines after it. |
| F28 | An export whose name contains `$` gets its real in-file reference count. |
| F29 | `export { r as s } from` exports `s` only, and the edge names `r`. Each `export ... from` is one edge. |
| F30 | A relative import resolves to a `.tsx` file and to a directory index. The map resolver and `resolvePath` both hold the rule. |
| F31 | The entry check matches the path segments `src/index.ts`. The path `src/mysrc/index.ts` is not an entry. |
| F32 | A single-package module key is `entry`, `root`, or the first directory name under `src/`, including a name such as `lib.ts`. |
| F33 | A `node ./dist/gen.js` script makes `src/gen.ts` a build entry. |
| F34 | A folder link is not followed, and a workspace package folder that is a link is not read. A dangling link is listed in `skippedLinks`. |
| F35 | A `package.json` that is not an object warns and does not abort the run. A script that is not a string warns. |
| F36, F41 | A negated workspace pattern, in the npm form and in the pnpm form, drops the package from workspace detection, so it contributes no root. The census keeps the files. They show as orphans, and the run does not fail them as absent. The 1.x census walk that skipped those folders is not restored. |
| F38 | A runtime `import()` records `["*"]`. A type-position `import('./c').C` records `C` (the 1.x result "no names" is not kept). A static import beside `import()` records the static names and `*`. |
| F39 | `a++ / b` is division. `if (x) /re/` is a regular expression. A quote in a regular expression does not open a string. |
| F40 | `import().then(cb)` and `import().then<T>(cb)` are runtime edges. |
| F42 | A source file on disk that git does not track warns. `--strict-census` fails. `--check-census` compares the committed inventory with the git census. |
| F43 | A self-import resolves through `exports` or `main`, then `src/<sub>.ts`, then `src/<sub>/index.ts`. The mapped target is a root. |
| F44 | A `.d.ts` file with no importer stays in "Files with no in-repo importer", and so does an orphan `.ts` file. The 1.x rule that omitted `.d.ts` is not restored. Classified duplicate lists still skip a `.d.ts` definer. |
| M1 | An orphan warns. `--strict-orphans` exits 1. `--reachable-only` is rejected with exit 1. Roots come from `exports` and `bin`. |
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
- **F24 report shape.** The 2.0 unused report uses its own section titles. The report does not
  print the 1.x "in-file ref" suffix.
- **Regex `parseFile`.** Double edges and the other regex-parser results have no 2.0 reader.
  The tree-sitter reader replaces them.
- **Metadata name.** The core graph names the folder. A missing package version is `"unknown"`
  on the layers report, not on the core graph.

`docs/parity-2.0.0.md` records the verdicts that compare the engine with the Python tool and
with depgraph 1.x. The dynamic-`import()` verdict is `repo_map-wrong`. The bodiless
`export function` verdict is `repo_map-kept`.
