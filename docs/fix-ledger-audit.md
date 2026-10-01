<!-- repo-map:no-verification -->
<!-- GENERATED FILE -- do not edit by hand.
     Regenerate with `bun run audit:ledger -- --out docs/fix-ledger-audit.md`. -->

# Fix-ledger audit

Each row reverts one fix of `docs/fix-ledger-2.0.0.md` in a scratch copy of the repository.
The audit runs the test file of the fix, and then the whole suite. A fix is locked when a
test fails. A fix that no test catches is a gap, and it needs a test.

| Fix | Defect that the mutation restores | Result | First failing test |
| --- | --- | --- | --- |
| F1 | Every Markdown report holds a generation time stamp, so two runs differ. | caught by its own test | `F1: no date stamps > mini-repo (default)` (+1 more) |
| F2 | The discovery returns files in the order of the walk, with no sort after it. | caught by its own test | `F2: the output does not depend on the folder listing order > mini-repo (default)` (+1 more) |
| F3 | A Markdown report has no generated-file banner. | caught by its own test | `F3: the banner > every Markdown report of a run starts with the banner` |
| F4 | package.json pins js-yaml 4, so the YAML report is built with the wrong major version. | caught by its own test | `F4: the YAML report is built with js-yaml 5 > package.json pins js-yaml 5 exactly, and that copy is the one loaded` |
| F5 | The YAML report is built without the quote-style probe, so a js-yaml that ignores the option writes wrong quotes. | caught by its own test | `F5: the YAML quote-style probe > generateYaml runs the probe before it builds the report` |
| F6 | The tree-sitter reader takes the text of an import or export brace, so a comment becomes part of a name. | caught by its own test | `F6: comments inside { } import and export blocks > no symbol in any report holds comment text` |
| F6 | The API-surface reader takes export-list names from the raw text, so a comment becomes part of a name. | caught by its own test | `comments inside export braces > never become part of a name` |
| F7 | An import of compiled output (dist/) does not map to its source file. | caught by its own test | `F7: dist/ imports land on src/ > distToSrc maps dist/ and dist/src/, and keeps a dist/ folder inside src/` (+2 more) |
| F8 | An import in a test file does not count as use, so an export that only a test uses is unused. | caught by its own test | `F8: test imports count as usage > an export and a file used only by a test are not unused` |
| F9 | The target of an exports subpath is not a reachability root. | caught by its own test | `F9: exports subpaths are reachability roots > the target of an exports subpath and its imports are reachable` |
| F10 | Test coverage does not follow a chain of bare side-effect imports. | caught by its own test | `F10: coverage follows side-effect imports transitively > a test that imports a covers b and c of the chain a -> b -> c` (+1 more) |
| F11 | A dynamic import() is not a dependency edge. | caught by its own test | `F11: dynamic import() is a dependency > await import('./x.js') gives an edge to x` |
| F12 | A single-package repo without src/ has no module map: the files of its top-level folders belong to no module. | caught by its own test | `F12: non-src layouts > the module map of dependency-layers.json holds the top-level source folders` |
| F13 | The packages of a pnpm workspace are not read from pnpm-workspace.yaml. | caught by its own test | `F13: pnpm workspaces > detectWorkspaces finds each package of pnpm-workspace.yaml` |
| F14 | A tsup config is read only when a package script calls tsup. | caught by its own test | `F14: tsup configs with several entry arrays > tsup.config.ts with no tsup script: every entry array is a build root` (+2 more) |
| F14 | Only the first entry array of a tsup config names build roots. | caught by its own test | `F14: tsup configs with several entry arrays > tsup.config.ts with no tsup script: every entry array is a build root` (+2 more) |
| F15 | package-export-surfaces.json lists every named export, not only the public surface. | caught by its own test | `F15: package-export-surfaces.json holds the public surface only > an internal named export is absent; re-exported names are present` |
| F15 | A re-export chain from a package root does not make the re-exported names public. | caught by its own test | `F15: package-export-surfaces.json holds the public surface only > an internal named export is absent; re-exported names are present` |
| F16 | The default report folder is docs/Architecture, in upper case. | caught by its own test | `F16: lowercase default output folder > single-package: the run creates exactly one folder, docs/architecture` (+1 more) |
| F17 | A package src/index.ts that no declared entry names is not a root, so it is unused. | caught by its own test | `F17: classifier roots for unused and dormant files > test-only consumer: a test import is use, and a test-reached file is test-only` |
| F17 | A file that a build or test config names in new URL() is not a build root. | caught by its own test | `F17: classifier roots for unused and dormant files > config-root seed: a tsc -p tsconfig and a config new URL() seed build roots` |
| F17 | A file that only a test reaches is an orphan, not test-only. | caught by its own test | `F17: classifier roots for unused and dormant files > test-only consumer: a test import is use, and a test-reached file is test-only` |
| F17 | The entries of a tsc -p tsconfig are not build roots. | caught by its own test | `F17: classifier roots for unused and dormant files > config-root seed: a tsc -p tsconfig and a config new URL() seed build roots` |
| F17 | A bin target is not a build root. | caught by its own test | `F17: classifier roots for unused and dormant files > bin root: the bin target and its imports are live, not unused` |
| F18 | A .d.ts file is in the test coverage denominator. | caught by its own test | `F18: .d.ts files are not in the coverage denominator > the coverage counts index.ts only, and the graph keeps the .d.ts file` |
| F19 | Test coverage does not trace barrel re-exports. | caught by its own test | `F19: coverage traces barrel re-exports > a test that imports a barrel covers the re-exported files` |
| F20 | The privacy check accepts a tracked .exe file. | caught by its own test | `F20: a tracked .exe fails the privacy check > a repository that tracks a compiled .exe gets a binary finding` |
| F21 | A long export list renders inline, not as a fenced block. | caught by its own test | `F21: long export lists render as fenced blocks > the threshold is 8 names and the width is 100` (+3 more) |
| F21 | The fenced export list does not wrap at 100 characters. | caught by its own test | `F21: long export lists render as fenced blocks > the threshold is 8 names and the width is 100` (+1 more) |
| F22 | A sort uses the collation of the runtime, not code-unit order. | caught by its own test | `F22: code-unit order > export surfaces list names in code-unit order: upper case, '_', then lower case` |
| F22 | A source file calls localeCompare. | caught by its own test | `F22: code-unit order > no source file calls localeCompare` (+1 more) |
| F23 | A dynamic import() with a backtick-quoted specifier is not a dependency edge. | caught by its own test | `F23: backtick specifiers in import() > import(`./x.js`) gives an edge; a template with a substitution gives none` |
| F24 | The in-file reference count reads the source with its comments, so a name in a comment is a use. | caught by its own test | `F24: in-file references ignore comments > an export named only in comments stays a deletion candidate` |
| F25 | A runtime dynamic import() is a type-only edge, so it closes no runtime cycle. | caught by its own test | `F25: runtime and type-position import() > await import() in a and import './a.js' in b is a runtime cycle` |
| F26 | A type-only component that equals a runtime component is reported again. | caught by its own test | `F26: cycles by strongly connected component > components: members in code-unit order, sorted by smallest member, shortest cycle` (+7 more) |
| F26 | The representative cycle depends on the order of the neighbours: it is not the first shortest in code-unit order. | caught by its own test | `F26: cycles by strongly connected component > components: members in code-unit order, sorted by smallest member, shortest cycle` (+1 more) |
| F26 | The components are not sorted by their smallest member. | caught by its own test | `F26: cycles by strongly connected component > components are sorted by smallest member, not in the order that the search ends them` |
| F26 | A file that imports itself is not a component. | caught by its own test | `F26: cycles by strongly connected component > components: members in code-unit order, sorted by smallest member, shortest cycle` |
| F26 | The members of a component are not sorted in code-unit order. | caught by its own test | `F26: cycles by strongly connected component > components: members in code-unit order, sorted by smallest member, shortest cycle` (+13 more) |
| F27 | The comment stripper cuts a // inside a string literal, so an import on that line is lost. | caught by its own test | `F27: comment removal is string-aware > the duplicate classifier keeps an import after a URL string` |
| F28 | The in-file reference count uses the word boundary \b, which does not hold beside a $. | caught by its own test | `F28: RegExp-safe symbol names > an export named $store used once in its file has 1 in-file ref` |
| F28 | A symbol name goes into the regular expression without escaping, so a $ is an anchor. | caught by its own test | `F28: RegExp-safe symbol names > an export named $store used once in its file has 1 in-file ref` |
| F29 | A re-export with an alias records the source name as an export of the re-exporting file. | caught by its own test | `F29: aliased re-exports > an aliased re-export records the alias once and the source name on the edge` |
| F29 | A named re-export also writes a second edge with no names. | caught by its own test | `F29: aliased re-exports > an aliased re-export records the alias once and the source name on the edge` |
| F30 | A directory import does not resolve to the index file of the folder. | caught by its own test | `F30: .tsx files and directory indexes > the map resolver picks a .tsx file and a directory index` (+1 more) |
| F30 | A .tsx file is not a resolution candidate, so an import of it does not resolve. | caught by its own test | `F30: .tsx files and directory indexes > the map resolver picks a .tsx file and a directory index` |
| F31 | The entry-point check matches the text suffix src/index.ts, so src/mysrc/index.ts is an entry. | caught by its own test | `F31: entry check by path segment > isSrcIndex matches whole segments only` (+1 more) |
| F32 | A single-package module name drops the first .ts text of a directory name. | caught by its own test | `F32: strip the .ts suffix only > module names and cycle labels keep an inner .ts` |
| F32 | The cycle label of the compact summary drops the first .ts text of a file name. | caught by its own test | `F32: strip the .ts suffix only > module names and cycle labels keep an inner .ts` |
| F33 | A node script that runs ./dist/x.js does not seed src/x.ts as a build root. | caught by its own test | `F33: node dist script roots > a node --flag ./dist/gen.js script makes src/gen.ts a build entry` |
| F34 | The file discovery follows a linked folder. | caught by its own test | `F34: link-safe walk > monorepo: dangling, self-loop and sibling links are skipped and listed` (+1 more) |
| F34 | A dangling link is not listed. | caught by its own test | `F34: link-safe walk > monorepo: dangling, self-loop and sibling links are skipped and listed` |
| F34 | The skipped links are not reported. | caught by its own test | `F34: link-safe walk > monorepo: dangling, self-loop and sibling links are skipped and listed` (+1 more) |
| F34 | A workspace package folder that is a link is read. | caught by its own test | `F34: link-safe walk > a workspace package folder that is a link is not read, even with a package.json` |
| F35 | A script that is not a string stops the read of the roots of its package. | caught by its own test | `F35: package.json type guards > a non-string script keeps its workspace package and warns` |
| F35 | A root package.json that is not an object stops the run. | caught by its own test | `F35: package.json type guards > a null root package.json warns and the conventional entry stays a root` |
| F35 | A workspace package.json that is not an object stops the workspace detection. | caught by its own test | `F35: package.json type guards > a workspace package.json that is not an object is skipped with a warning` |
| F36 | A negated workspace pattern does not remove the package it matches. | caught by its own test | `F36: negated workspace patterns > npm: !packages/skip and a glob negation exclude their folders` (+1 more) |
| F37 | The object form of the tsup entry option names no build root. | caught by its own test | `F37: tsup object-form entry > tsupConfigEntries reads object values in file order` (+1 more) |
| F38 | A runtime dynamic import() records no names, so the exports of the loaded module look unreferenced. | caught by its own test | `F38: a runtime import() is a namespace use > the exports of a module loaded only through import() are not unreferenced` (+1 more) |
| F38 | A type-position import(...).Name records no name. | caught by its own test | `F38: a runtime import() is a namespace use > a type-position import() records the member name` |
| F39 | The comment stripper does not know regular-expression literals. | caught by its own test | `F39: regular-expression literals in the masker > a quote in a regex does not open a string` (+4 more) |
| F39 | After a++ or a-- the stripper reads a / as the start of a regex, not as a division. | caught by its own test | `F39: regular-expression literals in the masker > a++ / b / c is division, and a regex after if () is a regex` |
| F39 | After the ) of if (x) the stripper reads a / as a division, not as a regex. | caught by its own test | `F39: regular-expression literals in the masker > a++ / b / c is division, and a regex after if () is a regex` |
| F40 | A member call with a type-argument list on a dynamic import is a type-only edge. | caught by its own test | `F40: a member call on import() is runtime > import().then<T>(cb) is a runtime edge` (+5 more) |
| F41 | A package that a negated workspace pattern names still contributes its roots, so its files are not orphans. | caught by its own test | `F41: negated workspace folders are outside the census > npm: an excluded package does not fail the census` (+1 more) |
| F42 | A source file on disk that the census does not list gives no warning. | caught by its own test | `F42: a census gap warns unless --strict-census > by default the gap is a warning and the run exits 0` (+1 more) |
| F42 | --strict-census does not fail the run. | caught by its own test | `F42: a census gap warns unless --strict-census > --strict-census makes the gap fail the run` |
| F43 | A package that imports its own name gets no edge to its own source. | caught by its own test | `F43: self-imports in single-package mode > the exports targets resolve to the source files` (+2 more) |
| F43 | A self-import of a subpath does not try src/<sub>/index.ts. | caught by its own test | `F43: self-imports in single-package mode > a subpath whose target has no source falls back to src/<sub>.ts, then src/<sub>/index.ts` |
| F43 | The target of an exports entry is not mapped from dist/ to src/. | caught by its own test | `F43: self-imports in single-package mode > the exports targets resolve to the source files` (+1 more) |
| F43 | A package without an exports entry does not use main for its own name. | caught by its own test | `F43: self-imports in single-package mode > main resolves the package name` |
| F44 | A .d.ts file with no importer is left out of the list of files with no importer. | caught by its own test | `F44: .d.ts files stay in the core no-importer list > an ambient .d.ts file and an orphan .ts file are both listed` |
| M1 | --strict-orphans does not fail the run. | caught by its own test | `M1: single-package inventory, census and dormancy > single package: --strict-orphans fails; --reachable-only is rejected` (+1 more) |
| M1 | An orphan source file gives no warning. | caught by its own test | `M1: single-package inventory, census and dormancy > single package: roots, inventory, dormancy and an orphan warning` (+2 more) |
| M1 | The bin targets of the root package are not roots. | caught by its own test | `M1: single-package inventory, census and dormancy > single package: roots, inventory, dormancy and an orphan warning` |
| R1 | A report ends with the line feeds its generator left: no line feed, or two. | caught by its own test | `R1: every report ends with exactly one LF > mini-repo/default: the written reports` (+1 more) |

The audit ran 77 mutations of 46 fixes:

- 77 caught by its own test
- 0 caught by another test
- 0 uncaught
- 0 error
