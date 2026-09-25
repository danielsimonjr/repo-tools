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

## Post-release list (filed, not worked in v1)

Scope closed after batch 4: a finding enters v1 only if it makes a real repo exit 1 or can lose
data. Other findings are filed here.

- [ ] A named re-export writes an extra empty-imports edge (`./view.js` twice for `src/index.ts`).
- [ ] The extension `write` does not guard against a link inside the output folder that points
  outside it.
- [ ] Mathts migration note: set `depgraph.duplicateAllowlist` to its own allowlist path, or the
  duplicate gate fails on 283 names.
- [ ] The skip list (`node_modules, dist, build, coverage, .git`) also skips a real source folder
  such as `src/build/`, with no warning.
- [ ] The census messages and the TEST_COVERAGE note name fixed values instead of the configured
  regenerate command and coverage-policy path.
- [ ] The walk skip list is module state: two runs in one process would interfere.
- [ ] The config file rejects a top-level `$schema` key.
- [ ] A type-position `import('./c').C` records no names, so an export used only that way reads
  as unreferenced.
- [ ] Single-package mode: the `exports "."` target or `main` is a root only when it is
  `src/index.ts`; subpath roots come from the export key, not its target.
- [ ] Test coverage does not follow package-name imports (self or workspace), in either mode.
- [ ] Monorepo workspace subpaths ignore `exports` targets and do not try `<sub>/index.ts`.
- [ ] Import edges by package name (self or workspace) are not in the cycle detection.
- [ ] The regex rule of the comment stripper misreads `a++ / b / c` and `if (x) /re/.test(s)`.
- [ ] With a bare `import './x'` and an `import('./x')` in one file, the `*` goes on the bare edge.
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
