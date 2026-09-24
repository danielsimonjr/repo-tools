# chunk goldens

These files are characterization goldens for `repo-tools chunk`.

The original chunker (`chunking-for-files.ts`, the tool that this port replaces) made the first
version of these files. The steps for each case in `tests/unit/chunk-golden.ts`:

1. Copy the fixture from `tests/fixtures/chunk/` into an empty folder.
2. Run `split` on the copy, then `status`, then `merge`, on the manifest.
3. Keep the chunk files, the manifest, the merged file and the output of each step.

The masking rules are in `tests/unit/chunk-golden.ts`. The manifest keeps its bytes, but the
`createdAt` value and an absolute `sourceFile` value become placeholders. In the output, the
run folder becomes `<DIR>`, a date becomes `<createdAt>` and a backup timestamp becomes `<ts>`.

A fix that changes a golden names the changed file in its commit message.
