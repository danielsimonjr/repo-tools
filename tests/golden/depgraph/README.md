# depgraph characterization goldens

These files are the outputs of the generator that the `depgraph` port starts from (the
pre-port copy, before the design section 8 fixes). The port must reproduce them byte for byte.
After that, each fix changes these files in its own commit, and the commit names the fix.

| Folder | Fixture | Flags |
|---|---|---|
| `mini-repo/default` | `tests/fixtures/depgraph/mini-repo` | none |
| `mini-repo/all` | `tests/fixtures/depgraph/mini-repo` | `--all` |
| `mono-repo/default` | `tests/fixtures/depgraph/mono-repo` | none |
| `mono-repo/all` | `tests/fixtures/depgraph/mono-repo` | `--all` |

Masking: each ISO date-time is replaced by `<DATETIME>`, each ISO date by `<DATE>`, and the
fixture root by `<ROOT>`. `_exit-code.txt` holds the exit code. `_stdout.txt` holds the
standard output.

Known facts in these goldens:

- `mono-repo` exits 1. The census gate reports `packages/core/src/worker.ts` as an orphan,
  because the pre-port generator reads only the first tsup `entry` array (fix F14).
- `mini-repo` omits `src/view.tsx`, because the pre-port generator reads `.ts` files only.
- `_stdout.txt` holds the fixture root (masked). The port writes no absolute path to standard
  output (design criterion 4).
- The goldens hold the listing order of NTFS on Windows and the `localeCompare` order of Bun.
  The characterization tests therefore run on Windows only, until fixes F2 and F22 land.
