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
| `mini-repo/api-surface.json` | `tests/fixtures/depgraph/mini-repo` | `--api-surface=api-surface.json` |

Masking: each ISO date-time is replaced by `<DATETIME>`, each ISO date by `<DATE>`, and the
fixture root by `<ROOT>`. `_exit-code.txt` holds the exit code. `_stdout.txt` holds the
standard output.

Known facts in these goldens:

- `mono-repo` exits 0. Before fix F14 it exited 1: the pre-port generator read only the first
  tsup `entry` array, so the census gate reported `packages/core/src/worker.ts` as an orphan.
  `_stdout.txt` (the pre-port reference) still shows that run.
- `mini-repo` omits `src/view.tsx`, because the pre-port generator reads `.ts` files only.
- `_stdout.txt` holds the fixture root (masked). The port writes no absolute path to standard
  output (design criterion 4). `_stdout.port.txt` is the port's own standard output, and the
  characterization test compares it byte for byte.
- Fixes F2 and F22 made the goldens independent of the folder listing order and of the ICU
  data. The characterization tests run on Linux, macOS and Windows.
