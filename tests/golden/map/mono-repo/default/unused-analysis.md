<!-- repo-map:no-verification -->
<!-- GENERATED FILE -- do not edit by hand.
     Regenerate with `repo-tools map`. -->

# Unused Files and Exports Analysis

## Summary

- **Files with no in-repo importer**: 0
- **Dormant files**: 0
  - **Orphaned (reachable from nothing)**: 0
  - **Test-only (only a test reaches them)**: 0
- **Potentially unused exports**: 2
  - **Unreferenced anywhere**: 2
  - **Referenced in their own module**: 0
  - **Not classified**: 0

## Caveats

- Dynamic `import(...)` expressions and runtime module loads (e.g. `new Worker(path)`) are invisible to this analysis -- the parser only walks static `import ... from ...` statements, so a file or export reached ONLY through one of those is reported as no-importer/unreferenced even though it is genuinely live. Confirmed on the real memoryjs corpus: src/cli/commands/check.ts, .../inspect.ts, and src/cli/interactive.ts itself are all consumed exclusively via `await import(...)` inside interactive.ts.
- `noImporterFiles` is NOT a deletion-candidate list. A file with zero in-repo importers is expected, not suspicious, for: a standalone script invoked directly (e.g. a smoketest run via `node script.mjs`, never `import`ed by anything), or a build/lint config file loaded by its own tool rather than by source code (e.g. `eslint.config.mjs`, read by eslint itself). Cross-check against package.json scripts / tool configs before treating any entry here as dead.
- Only NAMED exports are analysed (`FileNode.exports` carries named exports only) -- `export default` usage is not checked here.
- The `referencedInModule` vs `unreferencedAnywhere` split for exports is a TEXT-LEVEL heuristic (whole-identifier occurrence count within the defining file's own source, minus the declaration site itself), not an AST reference count -- it can over-count a name that also appears in a string literal or comment. When the source text can't be read at all (no `RepoGraph.root_path`, or the file is missing) the export lands in `unclassifiedExports` instead of being guessed into either bucket.
- `unreferencedAnywhereNotes`'s dynamic-import check (`_dynamic_import_referrers`) only sees `import(...)` calls with a LITERAL string specifier. A dynamic import built from a variable or template literal (e.g. `import(`./cmds/${name}.js`)`, a command-dispatcher pattern) is invisible to it -- 'found none' in a note means no LITERAL match was found, NOT that nothing imports the file.

## Dormant files: orphaned

Source files that no root and no test reaches. Verify each one before you delete it.

_None._

## Dormant files: test-only

Source files that only a test reaches. They ship nothing, but a test uses them.

_None._

## Files with no in-repo importer

No file of this repository imports these files. This is not a deletion list.

_None._

## Exports unreferenced anywhere

No other file imports these names, and their own module does not use them.

- `packages/core/src/internal.ts`: `INTERNAL_FLAG`
- `packages/core/src/worker.ts`: `workerResult`

### Notes

- `packages/core/src/internal.ts` `INTERNAL_FLAG`: Checked for a dynamic import() call with a LITERAL string specifier resolving to 'packages/core/src/internal.ts' across the whole repo and found none. This scan can only see import() calls with a literal string specifier -- a dynamic import built from a variable or template literal (e.g. import(`./cmds/${name}.js`)) is invisible to it, so 'found none' means no LITERAL match was found, NOT that nothing imports this. 'INTERNAL_FLAG' may still be consumed via such a call. Also verify against consumption this scan cannot see at all (docs examples, published API surface, a runtime-built path/`new Worker(...)`) before deleting.
- `packages/core/src/worker.ts` `workerResult`: Checked for a dynamic import() call with a LITERAL string specifier resolving to 'packages/core/src/worker.ts' across the whole repo and found none. This scan can only see import() calls with a literal string specifier -- a dynamic import built from a variable or template literal (e.g. import(`./cmds/${name}.js`)) is invisible to it, so 'found none' means no LITERAL match was found, NOT that nothing imports this. 'workerResult' may still be consumed via such a call. Also verify against consumption this scan cannot see at all (docs examples, published API surface, a runtime-built path/`new Worker(...)`) before deleting.

## Exports referenced in their own module

No other file imports these names, but their own module uses them.

_None._

## Exports not classified

The analysis could not read the source of these names.

_None._
