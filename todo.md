# todo

## Part 1

- [x] T1 Scaffold and CLI shell (design 3.1, 11.1).
- [x] T2 Privacy check, commit-msg hook and CI on three operating systems (design 10.2).
- [x] T3 Bundle, compiled executables and the smoke test (design 11.1-11.3, 13.3).
- [x] T4 `chunk` port with fixes K1-K4 (design 3.3, 6.3).
- [ ] T5 `compress` port with fixes K5 and K6 (design 3.4, 6.4).
  - [x] Port with characterization goldens from the original tool.
  - [x] K5: validate `--level` and `--format`.
  - [x] K6: sort the batch walk in code-unit order.
  - [x] Batch mode skips `.compact` files.
  - [x] A directory without `--batch`, and `--batch` without a directory, exit 1 with a message.
  - [ ] JSON `-d` restores keys by structure (the original corrupts values).
  - [ ] Round trip tests and a smoke step.
- [ ] T6 Public design document `docs/design.md`.

## Part 2

- [x] D0 Fixture repositories and the characterization goldens of the pre-port generator.
- [ ] D1-D12 `depgraph` port and fixes (plan part 2).
