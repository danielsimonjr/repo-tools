<!-- repo-map:no-verification -->
<!-- This record measures other repositories; it makes no claim about the graph of this repository. -->

# Parity record of `repo-tools check`

This record compares `repo-tools check` with the Python tool `repo_map.py check`. Each named
repository is public on GitHub. The checks ran on 2026-09-30. Each run used a fresh clone (depth 1)
of the default branch of the repository.

| Repository | Commit | Language | Files |
| --- | --- | --- | --: |
| memoryjs | `df9956b` | TypeScript | 697 |
| Mathts | `abfd1af` | TypeScript | 1933 |
| universal-physics-tensor | `3aecc26` | TypeScript | 1020 |
| repo-tools | `eb96eb5` | TypeScript | 240 |
| fermat-mcp | `ef84ce2` | TypeScript | 15 |
| PITS-MRAS | `8b2cb2d` | Python | 95 |
| auto-memory | `d4adb29` | Python | 79 |
| memvid | `c416853` | Python | 29 |
| IronClaw | `8c8d78c` | Rust | 288 |
| ui-mcp | `8798a15` | C# | 25 |
| Windows-mcp | `2a74b3e` | C# | 189 |

The file count is the `totalFiles` metric of the engine.

## Method

A verdict of a document is its exit code and its set of problems. A problem has a kind, a claim
name and the actual value. The script does not compare the text of a message.

1. **Metrics.** The script read the metrics of each tool on the same clone. The Python tool
   gives them through `_metrics`, and the engine through `collectMetrics`. The script compared
   the names and the values.
2. **Verdict documents.** The script wrote three documents for each repository. Both tools checked
   each document.
   - Document A holds each metric of the Python tool, at the value of the Python tool.
   - Document B holds each metric of the engine, at the value of the engine.
   - Document C holds each metric of the Python tool, changed: a number plus 1, a boolean
     flipped, a string with one letter added.
3. **Predictions.** For each tool and each document, the script predicted the problems from the
   metrics of that tool alone. The prediction uses four rules: unknown claim, truncated cycle
   count, tainted reachability metric and mismatch. The output of the tool must equal the
   prediction. This test shows that the document parser and the verdict rules do what the
   metrics say.
4. **Edge documents.** The script wrote 41 hand-made documents. Both tools checked each one on
   fermat-mcp, in a folder of its own. A second set of 12 cases covers the folder and the path.
   In these 12 cases, both tools ran from a working directory outside the repository. The cases
   are listed in the result below.
5. **Controls.** A copy of the engine had one switch for each rule in the list of differences
   below. Each switch turns off one rule. With all switches on, the copy gives the same 39
   metrics as the engine (checked on memoryjs). The script ran the copy with one switch off at
   a time. It also ran the copy with all the applicable switches off together.

## Result: metric names

All 26 metric names of the Python tool are metric names of the engine. The engine adds names:

- 4 names on every repository: `runtimeCyclicComponents`, `runtimeFilesInCycles`,
  `typeOnlyCyclicComponents` and `typeOnlyFilesInCycles`.
- 9 more names on a TypeScript or JavaScript repository: `runtimeDuplicates`, `typeDuplicates`,
  `totalClasses`, `totalConstants`, `totalEnums`, `totalFunctions`, `totalInterfaces`,
  `totalReExports` and `totalTypeGuards`.

The Python tool reports each of these names as an unknown claim. The two tag tables
(`runtimeByTag` and `typeByTag`) are not scalar, so they are not metrics.

## Result: metric values

`schemaVersion` differs on all 11 repositories (`1.0.0` and `2.0.0`). Besides that name, the
common metrics differ in these repositories only:

| Repository | Different metrics | Cause |
| --- | --: | --- |
| memoryjs | 10 | The `import()` edge removes all 10. The namespace rule alone moves 4 of them. |
| universal-physics-tensor | 7 | The `import()` edge: 3 metrics. The namespace rule: 4 metrics. |
| Mathts | 12 | The five rules together (see below). |
| IronClaw | 3 | The comment rule: 2 metrics. The Rust `use` rule: 1 metric. |

The other seven repositories have no difference besides `schemaVersion`.

- **memoryjs.** Without the `import()` edge, the engine equals the Python tool on all 25 other
  common metrics.
- **universal-physics-tensor.** The `import()` edge changes `runtimeCircularDeps`,
  `typeOnlyCircularDeps` and `totalTypeOnlyImports`. The namespace rule changes
  `referencedInModuleCount`, `unreferencedAnywhereCount` and the two unused-export counts. With
  both rules off, the engine equals the Python tool on all 25 other common metrics.
- **Mathts.** One switch moves up to 12 metrics, because the rules interact. With the five
  switches off together (`import()`, namespace, comment, workspace, `new URL` roots), the engine
  equals the Python tool on all 25 other common metrics.
- **IronClaw.** The comment rule moves `referencedInModuleCount` from 1970 to 1937 and
  `unreferencedAnywhereCount` from 665 to 698. The simple cycle count goes from 1667 to 1009.
  The 2.0.0 record gives the same two numbers for the Rust `use` rule. No switch isolates this
  metric in this run, so the identical numbers identify the cause. Both searches stop at the
  safety cap, so both counts are floors. `check` reports both claims as unverifiable.

## Result: verdict documents

For all 33 documents (11 repositories, 3 documents), the output of each tool equals the
prediction from the metrics of that tool.

- **Document A.** The Python tool reports no problem on 6 repositories. It reports 6 tainted
  claims on PITS-MRAS, auto-memory, memvid and Mathts, and 2 truncated claims on IronClaw. The
  engine reports the same tainted and truncated claims, apart from Mathts. The engine adds a
  mismatch for each different metric of the table above that neither tool reports as
  unverifiable. The engine adds one more mismatch for `schemaVersion`. On Mathts the engine finds entry roots, so it compares the
  6 reachability claims and does not report them as tainted.
- **Document B.** The engine reports no problem on the 5 TypeScript repositories and on ui-mcp
  and Windows-mcp. It reports the tainted or truncated claims where the build declares them
  unreliable. The Python tool reports one problem for each added name, one for `schemaVersion`,
  and one for `circularDepsTruncated` (see the boolean rule below).
- **Document C.** Both tools report a problem for each of the 26 claims, except for 2 claims on
  memoryjs. There, the changed value of the Python tool equals the value of the engine
  (`reachableFiles` and `typeOnlyCircularDeps`), so the engine finds a match.

## Result: edge documents

On 35 of the 41 documents, the exit code and the problems are equal. The 35 documents test these
cases:

- The heading forms: `## Verification`, `## Verification:`, `## Verification (note)`, upper
  case, `#` and `######`, and no space after the hashes.
- A heading that only mentions the word, and an indented heading.
- The opt-out marker alone on a line: first, last and indented. Also the marker beside wrong
  claims, and the marker after a byte-order mark.
- The names `constructor` and `__proto__`.
- A value with a leading zero or a plus sign.
- A row with two cells, and a row with four cells.
- A deeper heading inside the section, and two sections.
- CRLF and CR line ends, and a repeated claim.

The 6 documents with a different verdict come from three rules:

1. A boolean claim in lower case or upper case (`false`, `FALSE`) against `circularDepsTruncated`.
   The Python tool compares the text with `False` and reports a mismatch. The engine ignores the
   letter case of a boolean, and finds a match. This rule gives 2 documents.
2. A byte-order mark before the first heading. The Python tool does not remove the mark, so it
   finds no Verification section and fails. The engine removes the mark and checks the claims.
   This rule gives 1 document.
3. The opt-out marker inside a line, not alone on it. The 3 documents quote the marker in an
   inline code span, in a sentence and in a table cell. A stale claim follows the marker. The
   Python tool tests `marker in text`, so it opts the document out and reads no claim. The engine
   opts a document out only when a line, trimmed, equals the marker. The engine reads the table
   and reports the stale claim.

The two tools differ in both directions:

- In 3 documents (rules 1 and 2), the engine passes a document that the Python tool fails.
- In 3 documents (rule 3), the engine fails a document that the Python tool passes. This
  direction fails closed: the engine reports a stale claim that the Python tool never reads.

The 12 folder and path cases are:

- A missing folder, an empty folder, and a folder with a text file only.
- A document in a subfolder only, and a folder named `dir.md` beside a valid document.
- A file that is not valid UTF-8.
- A document with an upper-case extension (`DOC.MD`).
- A relative `--docs` path, and a relative path with `../`.
- A missing root, a root that is a file, and a root without a source file.

Of the 12 cases, 11 have the same exit code. A relative `--docs` path resolves against
the root in both tools, from any working directory, with and without `../`. Both tools read an
`.MD` file on Windows. The Python tool matches `*.md` with the case rule of the file system, so
on a case-sensitive file system it can skip such a file. The check ran on Windows only, so the
record does not measure that case. The engine reads the file on every platform.

The case with a different exit code is the root without a source file. The Python tool passes a
claim `totalFiles | 0` and exits 0. The engine exits 1 with the message of `map`, as the design
document states.

## Differences and their verdicts

- **`schemaVersion` (approved).** The schema version is `2.0.0`.
- **Added names (approved).** See the result for the metric names.
- **`import()` edge (`repo_map-wrong`).** The 2.0.0 record gives the rules. It changes the
  reachability, type-only and cycle metrics.
- **Namespace use (`repo_map-wrong`).** A file that writes `import * as ns from './a'` reads
  names of `a` through `ns`. The engine counts every export of `a` as used. The Python tool lists
  each of them as unused. On universal-physics-tensor, `src/cli/commands/map.ts` reads 40 names
  of `_atlas-map.ts` through `atlasMap`, and the Python tool lists all 40 as unused.
- **Comment rule (`repo_map-wrong`).** A name that a file mentions only in a comment is not an
  in-module reference. The engine moves the name from "referenced in module" to "unreferenced
  anywhere". With the comment rule off, 25 names move back on Mathts and 33 names on IronClaw.
- **Workspace roots and workspace imports (deliberate).** See the 2.0.0 record.
- **Roots from a root config or from `new URL(…, import.meta.url)` (deliberate).** The Python
  tool has no such root. On Mathts, four files are roots in the engine because of this rule.
- **Rust `use` aliases (deliberate).** See the 2.0.0 record.
- **Boolean letter case (deliberate).** The engine accepts any letter case. It prints the value
  in lower case.
- **Byte-order mark (expected improvement).** The engine removes it. The Python tool fails.
- **Marker alone on a line (deliberate, fail-closed).** The engine opts a document out when a
  line, trimmed, equals the marker. The Python tool opts out when the marker is anywhere in the
  text. A document can quote the marker in a sentence, a code span or a table cell. The engine
  keeps the table of such a document, and a stale claim in that table fails. In the Python tool,
  the same stale claim passes in silence. A blank `map.verificationMarker` matches no line.
- **Root without a source file (deliberate).** The engine fails, because a graph of no file
  verifies nothing. The Python tool passes.
- **Message text (expected improvement).** The messages of the engine show `<root>` and
  `<docs>`, not an absolute path. The engine also prints one line on standard output when every
  claim matches. The Python tool prints nothing.
- **Not a deletion list (deliberate).** The note for a dead-looking count covers seven names,
  and `unusedExportCount` is one of them. The Python tool covers the other six.

## Gaps that the parity check found

The check found two rules of the engine that the design document did not state. It also found
one rule that no test locked.

1. The namespace rule had no test. A test now locks it.
2. The namespace rule and the comment rule were not in the list of deliberate differences. The
   list in section 14.4 of the design document and the `CHANGELOG.md` entry now state them.

The method compares two tools, and two equal verdicts can both be wrong. The marker rule shows
this. Both tools passed a stale claim that followed a quoted marker, so the verdicts were equal.
The engine now opts out only for a marker alone on a line. The 3 documents of rule 3 measure
the difference from the Python tool.
