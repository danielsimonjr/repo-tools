# todo

## Part 1

- [x] T1 Scaffold and CLI shell (design 3.1, 11.1).
- [x] T2 Privacy check, commit-msg hook and CI on three operating systems (design 10.2).
- [x] T3 Bundle, compiled executables and the smoke test (design 11.1-11.3, 13.3).
- [x] T4 `chunk` port with fixes K1-K4 (design 3.3, 6.3).
- [x] T5 `compress` port with fixes K5 and K6 (design 3.4, 6.4).
  - [x] Port with characterization goldens from the original tool.
  - [x] K5: validate `--level` and `--format`.
  - [x] K6: sort the batch walk in code-unit order.
  - [x] Batch mode skips `.compact` files.
  - [x] A directory without `--batch`, and `--batch` without a directory, exit 1 with a message.
  - [x] JSON `-d` restores keys by structure (the original corrupts values).
  - [x] Round trip tests and a smoke step.
- [x] T6 Public design document `docs/design.md`.

## Part 2

- [x] D0 Fixture repositories and the characterization goldens of the pre-port generator.
- [x] D1-D8 `depgraph` port to byte parity with the goldens (reviewed; one fidelity fix).
- [x] D9 API-surface module. Landed in 486d8f3; the CLI flag comes with D10.
- [x] D10a `depgraph` config file, strict flags, path and exclude flags, `--api-surface` (8b974ea).
- [x] D10b the duplicate gate (`--check-duplicates`, `--no-regen`, `--write-duplicate-baseline`), the
  extension loader with `--no-extensions`, and `.tsx` input. Also: `--src` in a monorepo exits 1
  with a clear message, and the absolute-path error says to pass a root-relative path.
- [x] D10 `depgraph` config, full CLI flags, the exit table (with the empty-output-folder row) and
  the extension loader.
- [x] The `--write-duplicate-baseline` help line says it reads the last run's
  `duplicate-symbols.json` (run depgraph first), so a stale baseline is no surprise.
- [x] D13 `repo-tools query`, the fourth subcommand (owner scope addition): dependents,
  symbol-users, is-public, node-safety, cycles, the browser-safety gate, and the derived files
  `dependency-reverse.json` and `node-safety.json`. After D10b, before D11.
- [x] D11 Golden and determinism CI on Linux and Windows; smoke steps 2, 3 and 7 on the product.
  Also: `bun run compile` refuses to build when `node_modules` does not match `bun.lock`
  (a frozen install does not prune a stale nested package), proven with a planted stale nested
  package, RED then GREEN; the README build step matches.
  Also: the golden sets run with `--no-extensions`, and `tests/fixtures/extension/probe.mjs` moves
  to the section 5.2 extension shape when smoke step 7 runs the product.
- [x] D11 An interrupted test run leaves its `repo-tools-*` temp folders (a killed `bun test` never
  runs `afterAll`). Every test temp folder carries the PID of its run, and the next run removes the
  folders of runs that are no longer alive.
- [x] D11 `repo-tools query --config=<file>`, on the same path as `depgraph --config`
  (ruling 2026-09-24).
- [x] D11 Criterion 5: on UPT at a commit at or after 673504a, `repo-tools depgraph
  --api-surface=a.json` is byte-identical to UPT's own `create-dependency-graph.ts
  --api-surface=a.json` at the same commit.
- [x] D12 Public design document and the release-candidate report.
  The design document says that the extension `ctx.write` is a convenience boundary, not a
  security one: an extension is trusted repo code that can call the file system directly.
- [x] depgraph fixes, one commit each: F1-F12, F13 (with a `pnpm-repo` fixture), F14 (with
  `tsup.config.*` read when it exists), F15-F26, F27-F32, F33 (script roots), F34 (link-safe
  walk), F35 (package.json guards), F36 (negated workspace patterns), F37 (tsup object-form
  `entry`), M1.
- [x] depgraph batch 3 follow-ups before push: the `benchmarks/` census folder (a `bench`
  disposition), F41 (both census walks skip folders that a negated workspace pattern excludes),
  F42 (a census gap warns and exits 0; `--strict-census` makes it fail).
- [x] depgraph fixes, batch 4: F38 (a runtime `import()` edge records `["*"]`), F39 (a
  regex-aware comment stripper), F40 (`import().then<T>(...)` is a runtime edge), F43
  (self-imports in single-package mode), F44 (a `.d.ts` file never counts as an unused file).

## 1.1.0: `repo-tools ste`

- [x] The tool stays offline: a static test fails when `src/` imports a network module or uses a
  network global.
- [x] `repo-tools ste`: port `ste_check.py` and `ste_rules.py` from the architecture-docs skill, test-first.
- [x] `repo-tools ste --prose`: the docstring harness of the code-docs skill, over the same rule module.
- [x] A table of every behavioral difference between the two STE checkers, in `docs/design.md`.
- [x] STE parity: `repo-tools ste` and `ste_check.py` give the same output on a real document corpus.

## 2.0.0: the unified engine (repo_map port)

- [x] The Rust `use` reader cuts a name at the letters `as` inside a word (`HashMap` becomes `H`):
  the Python source splits on `as` after it removes white space. Fix it as a whole-word alias,
  with its own parity verdict (repo_map-wrong), after the side-1 parity record.
- [x] `repo-tools map` (D8): the command that writes every 2.0.0 output. `depgraph` stays a
  deprecated alias through 2.x. The scan-scope flags follow the review decision (asked for on
  2026-09-26).
- [x] The gates of `map`: `--check-census`, `--strict-orphans`, `--strict-census`,
  `--check-duplicates`, `--no-regen`, `--write-duplicate-baseline`, and the extension hooks.
- [x] `--api-surface` on the graph (D5): TypeScript as in 1.x, Python `__all__`, Rust `pub`. For
  C#, exit 1 with a message.
- [x] `repo-tools query` reads the core graph (D8): `dependents`, `symbol-users` and `cycles`
  get repo_map's meaning, and `cycles --components` lists the components.
- [x] Build (D7): the four `.wasm` files go into `dist/` and into the package `files`. Smoke
  test the exe and the Node bundle on Node 20 and 22.
- [x] Parity record in the repository (public repositories only): side 1 against `repo_map.py`,
  and side 2 against depgraph 1.x.
- [x] Decision for the PR review: dynamic `import()` edges in the core graph (D1). Verdict
  `repo_map-wrong`: a literal relative `import()` is an edge. A runtime call is a namespace use
  (`*`). A type-position `import('./c').Name` records that name. `typeof import()` records no
  names. A template with `${`, and a non-relative specifier, are not edges.
- [x] A bodiless `export function f(): T;` (an overload signature or an ambient declaration in a
  `.d.ts` file) is not an export of the reader, as in the Python tool. Verdict `repo_map-kept`.
  An overload plus an implementation records the name once.
- [x] Remove the 1.x depgraph pipeline, which the product no longer calls (`depgraph` is an
  alias of `map`). Each 1.x fix test (F1 to F44, M1, R1) is ported to `map`, or recorded in
  `docs/fix-ledger-2.0.0.md` when the fix has no 2.0.0 meaning. The 1.x runner, parser, scanner
  and goldens are deleted.
- [x] Workspace roots: in a workspace monorepo the graph has 0 roots, so each workspace source
  file shows as an orphan (a repo_map defect that 1.x did not have). Read the entry files of
  each workspace package, and list the change as a deliberate difference from repo_map.

## 2.1.0: `repo-tools check`

- [x] Gate findings of the merged engine change, in one pull request: the test e-mail address, the
  three STE findings, and a privacy accept-list for history that no new commit can change. An entry
  names a full commit sha, one finding kind and one line, and it carries a reason. A stale entry
  fails the check.
- [x] `repo-tools check [root] --docs <dir>`: port `check.py` (claims parser, Verification section,
  metrics from the map engine, truncation and warning taint, the no-verification marker). Read the
  root and scan scope from the config file, as `map` does. A root-relative `../` `--out` is pinned
  by a test. Exit 0 when every claim matches, exit 1 with the problem list otherwise.
- [x] `check` parity record against `check.py` on public repositories, then a smoke step.
- [x] The namespace rule (`import * as ns` counts every export of its target as used) and the
  comment rule (a name in a comment is not an in-module reference): the parity check found them
  missing from section 14.4 of the design document. A test locks the namespace rule.
- [x] PR #8 review, two fixes on `feat/check`: (1) spell the byte-order mark as an escape in
  `claims.ts` and `check-claims.test.ts`, and add a test that fails on any literal U+FEFF under
  `src/`, `tests/` or `scripts/`; (2) opt a document out only when a trimmed line equals the
  marker, with the divergence from `check.py` recorded in `docs/parity-check.md`.
- [x] Fix-ledger audit, after `check`: a script reverts each fix (F1 to F44, M1, R1) in a scratch
  worktree and records whether a `map` test fails. Each fix that no test catches gets a test.
- [x] Workflow comments: `.github/workflows/build.yml` line 4 ("design 11.3, 11.4") and `ci.yml`
  line 90 ("design 11.4") name subsections that `docs/design.md` section 11 does not have. Add
  the subsections (no release step, publish from the CI tarball after a hash check, no token in
  CI) or point the comments at section 11. Add a check that fails on a dangling section
  reference.
- [ ] Names of private decisions (`D2`, `D8`, `D10b`, `criterion 4`) appear about 74 times in
  comments and test titles. `docs/parity-2.0.0.md` defines the 2.0.0 ones. A reader of the public
  repository cannot resolve the 1.x ones. Replace each with a statement of the rule, or with a
  section of `docs/design.md`. Find them with the pattern `\bD[0-9]+[a-z]?\b|criterion [0-9]+`
  over `src`, `tests` and `scripts`: it finds 88 hits in 44 files, and some hits can be other
  uses. The largest counts: `tests/unit/map-artifacts.test.ts` 12, `src/map/artifacts.ts` 7,
  `tests/unit/map-command.test.ts` 6, `src/config.ts` 4.
- [ ] `check:design` cannot tell a right section number from a wrong one that exists
  (`scripts/design-refs.ts`). Four references named section 4 for the chunk and compress modules,
  and section 4 exists. Read the references to sections 3 to 9 once by hand, or give each section
  a one-line summary that a check can compare.
- [ ] Dead code in `src/depgraph/analysis.ts`: `findReachableFiles` (line 114), `detectUnused`
  (line 192), `generateStatistics` (line 292) and `splitDormant` (line 363) have no caller outside
  that file and the tests. Remove them with their tests, or wire them in.
- [ ] Single-package roots do not use the `./x` to `src/x.ts` or `src/x/index.ts` fallback of an
  `exports` subpath whose target has no source. Workspace packages use it
  (`exportsSubpathEntries`, `src/depgraph/roots.ts` line 113), and the public surface of a single
  package uses it (`rootPackageEntries`, `src/depgraph/roots.ts` line 238). Compare with the 1.x
  and Python behavior before any change.
- [ ] The F36 and F41 tests exercise one code path:
  `tests/unit/depgraph-f36.test.ts` line 22 and `tests/unit/depgraph-f41.test.ts` line 11, both
  about a negated workspace pattern. Keep one, or give F41 a case that F36 does not reach.
  `tests/unit/fix-ledger-audit.test.ts` line 205 lists both as locked, so change it with them.
- [ ] Tests that run the whole pipeline or spawn git lose the 5 s default deadline under load.
  Symptom on this host (other sessions and Defender): two full runs lost 4 different tests
  (`--check-duplicates` in `tests/unit/depgraph-duplicate-gate.test.ts`, the accept-list,
  R1 in `tests/unit/depgraph-r1.test.ts` and one unnamed test), and each test passes alone.
  Symptom on CI: the Windows runner of PR #12 (push run 37028571343, head `bf98770`) failed one
  test, `JSON: every number keeps its text ... 0.12345678901234567890123 in an array at medium`
  (`tests/unit/compress.test.ts` lines 503 to 539: 6274 ms against 5000 ms). The `pull_request`
  run of the same commit passed, so the cause is load and not a defect of the change. That test
  runs `compress` in process and writes files to a temp folder, so the slow part is not measured.
  Proposed fix: read the `[N ms]` time that `bun test` prints for each test, and list the slowest
  ones. Give each of them an explicit deadline as the third argument of `test(...)`, or cut its
  work. Do not widen the global deadline blind.

## 2.2.0: `repo-tools docs`

- [ ] `repo-tools docs`: port `code_docs.py` (scan, stub, check). `stub --apply` stays a dry run by
  default.
  - [x] The TSX grammar joins `src/map/grammars.ts`, so a `.tsx` or `.jsx` file parses.
  - [x] `src/docs/`: the model, the discovery with `.code-docs.json`, the Python analyser, the
    TypeScript analyser, the report, the stub writer and the command.
  - [x] Tests: the 7 test files of the Python tool, plus the new cases of each deliberate
    difference (CRLF files, `.tsx` stubs, test-file stubs, a missing root, no source file).
  - [x] Parity run: both tools on real repositories; the result goes in `docs/parity-docs.md`.
  - [x] `docs/design.md` section 16, the README, the CHANGELOG, the smoke test and the version
    (2.2.0).
  - [x] File the open findings of the port (the `COVERAGE.md` Verification block is not a
    checked claim; the stub planner reverts a file with a one-line body or 2-space indent).
- [ ] `COVERAGE.md` ends with a `## Verification` list (`src/docs/report.ts` line 124), and the
  footer names `check`. The list has no `| claim | value | source |` rows, so
  `repo-tools check --docs` reports a section without a row if you point it at `docs/code-docs`.
  Give the report the opt-out marker, or write rows that a command verifies. The Python tool
  writes the same list.
- [ ] The Python stub planner writes the docstring at the indent of the last `def` line plus 4
  spaces (`src/docs/stub.ts` line 66). A file that indents by 2 spaces or by tabs, and a
  `def f(): pass` on one line, fail the parse after the change. The writer reverts such a file
  and says `REVERTED`, so no source is lost. Read the indent unit of the file, and handle the
  one-line body. The Python tool has the same limit.
- [ ] The Python analyser (`syntaxError`, `src/docs/python.ts` line 361) accepts a few errors that
  CPython finds while it builds the tree (`def f(*)`, `del f()`), and it rejects a name that
  continues on the next line inside round brackets (`(bar.` then `baz)`). The second case fails
  closed. See `docs/parity-docs.md`. Report the grammar case to `tree-sitter-python`, and add a
  check for each error that a real file shows.
- [ ] The TypeScript grammar (0.23.2) rejects an invalid escape in a tagged template, for example
  ``String.raw`a\x` ``. ES2018 allows it, and `tsc` accepts it. The doc gate reports such a file as
  unparsed. `tests/unit/map-parsing-py.test.ts` held one, and the test now avoids it. Update the
  grammar, or rewrite the escape in `sanitise` (`src/docs/typescript.ts` line 80) with text of
  equal length.
- [ ] Two symbols on one line (compact or generated source) list in file order here
  (`src/docs/typescript.ts` line 221) and in reverse order in the Python tool. No gate reads the
  order. Close this item only if a consumer of `coverage.json` needs the Python order.

## Post-release list (filed, not worked in v1)

Scope closed after batch 4: a finding enters v1 only if it makes a real repo exit 1 or can lose
data. Other findings are filed here.

- [x] A named re-export writes one edge per `export ... from` statement. It does not add a second
  empty-imports edge to the same file.
- [x] The extension `write` refuses a link inside the output folder that points outside it.
- [x] Mathts migration note: set `map.duplicateAllowlist` (or `depgraph.duplicateAllowlist`) to
  Mathts' own allowlist path, or the duplicate gate fails on 283 names. The default is
  `docs/architecture/duplicate-allowlist.json`. The note is in the README.
- [x] The skip list (`node_modules, dist, build, coverage, .git`) also skips a real source folder
  such as `src/build/`. The run warns when that folder holds a source file. A root `build/` or
  `dist/` folder stays silent.
- [x] The census messages and the TEST_COVERAGE note name the configured regenerate command and
  coverage-policy path.
- [x] The walk skip list is not module state. Each walk builds its own skip set. The 1.x scanner
  that held the list is deleted.
- [x] The config file accepts a top-level `$schema` key.
- [x] A type-position `import('./c').C` records the name `C`. `typeof import()` records no names.
- [x] Single-package mode: `main` and `exports` targets are roots after `dist/` maps to `src/`,
  including when the file is not `src/index.ts`. A subpath root is the source of the export
  target.
- [x] Test coverage follows package-name imports (self or workspace), including side-effect
  imports of the resolved file.
- [x] Monorepo workspace subpaths use the `exports` target, then `<sub>.ts`, then
  `<sub>/index.ts`.
- [x] Import edges by package name (self or workspace) are in the cycle detection, including the
  components in `dependency-layers.json`.
- [x] The comment stripper treats `a++ / b / c` as division, and `if (x) /re/.test(s)` as a
  regular expression.
- [x] A bare `import './x'` together with `import('./x')` is one side-effect edge whose names are
  `["*"]`.
- [x] D10 exit rows: a `--root` that is not an existing directory exits 1 before any folder is
  created; standard error shows the root as `<root>`, never an absolute path.

## Review fixes for `chunk` and `compress` (review of 486d8f3..5743c5d)

- [x] chunk: refuse a manifest chunk file name that leaves the chunk folder, refuse an absolute
  `sourceFile` in a 2.x manifest, confirm a merge target outside the parent folder, and validate
  the manifest shape.
- [x] chunk K7: no data loss on merge (JSON array and invalid JSON; no smaller or empty result over
  a non-empty source without `--allow-shrink`).
- [x] chunk K8: split then merge is byte-identical for every supported type (property test),
  including top-level TypeScript statements and `export default`.
- [x] chunk: keep a `__proto__` key on JSON merge; restore CRLF line endings on merge.
- [x] compress: no key collision between an abbreviation and an existing short key.
- [x] compress: keep the shape of a top-level JSON array or single value.
- [x] compress K9: `-d` supports JSON only; other formats exit 1 with a message.
- [x] compress: batch `-d` never writes to its input; `-d` changes only the file base name.
- [x] compress: keep a `__proto__` key; escape every glob metacharacter; refuse an unsafe integer.
- [x] chunk and compress: exit 1 on an unknown flag, a flag without a value, a missing batch
  input, and a second input without `-b`.
- [x] Second review of the chunk and compress fixes: link-safe paths, line-ending round trips, number safety, output overwrite guard.
