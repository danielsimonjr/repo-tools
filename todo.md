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
- [ ] T6 Public design document `docs/design.md`.

## Part 2

- [x] D0 Fixture repositories and the characterization goldens of the pre-port generator.
- [x] D1-D8 `depgraph` port to byte parity with the goldens (reviewed; one fidelity fix).
- [ ] D9 API-surface module. Landed in 486d8f3; the CLI flag comes with D10.
- [ ] D10 `depgraph` config, full CLI flags, the exit table (with the empty-output-folder row) and
  the extension loader.
- [ ] D11 Golden and determinism CI on Linux and Windows; smoke steps 2, 3 and 7 on the product.
- [ ] D12 Public design document and the release-candidate report.
- [ ] depgraph fixes, one commit each: F1-F12, F13 (with a `pnpm-repo` fixture), F14 (with
  `tsup.config.*` read when it exists), F15-F26, F27-F32, F33 (script roots), F34 (link-safe
  walk), F35 (package.json guards), M1.
- [ ] D10 exit rows: a `--root` that is not an existing directory exits 1 before any folder is
  created; standard error shows the root as `<root>`, never an absolute path.

## Review fixes for `chunk` and `compress` (review of 486d8f3..5743c5d)

- [ ] chunk: refuse a manifest chunk file name that leaves the chunk folder, refuse an absolute
  `sourceFile` in a 2.x manifest, confirm a merge target outside the parent folder, and validate
  the manifest shape.
- [ ] chunk K7: no data loss on merge (JSON array and invalid JSON; no smaller or empty result over
  a non-empty source without `--allow-shrink`).
- [ ] chunk K8: split then merge is byte-identical for every supported type (property test),
  including top-level TypeScript statements and `export default`.
- [ ] chunk: keep a `__proto__` key on JSON merge; restore CRLF line endings on merge.
- [x] compress: no key collision between an abbreviation and an existing short key.
- [ ] compress: keep the shape of a top-level JSON array or single value.
- [ ] compress K9: `-d` supports JSON only; other formats exit 1 with a message.
- [ ] compress: batch `-d` never writes to its input; `-d` changes only the file base name.
- [ ] compress: keep a `__proto__` key; escape every glob metacharacter; refuse an unsafe integer.
- [ ] chunk and compress: exit 1 on an unknown flag, a flag without a value, a missing batch
  input, and a second input without `-b`.
