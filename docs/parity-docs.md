<!-- repo-map:no-verification -->
<!-- This record measures other repositories; it makes no claim about the graph of this repository. -->

# Parity record of `repo-tools docs`

This record compares `repo-tools docs` with the Python tool `code_docs.py` of the code-docs skill.
Each named repository is public on GitHub. The checks ran on 2026-10-02. Each run used a fresh clone
(depth 1) of the default branch of the repository, and the final run used the finished command.

| Repository | Commit | Files | Symbols | Exported | Documented | MUST issues | Unparsed |
| --- | --- | --: | --: | --: | --: | --: | --: |
| memoryjs | `0158a38` | 698 | 4980 | 1360 | 1346 | 7 | 3 |
| Mathts | `253aa72` | 1911 | 7964 | 2468 | 2403 | 54 | 0 |
| universal-physics-tensor | `0099eda` | 1076 | 3306 | 1669 | 1557 | 211 | 0 |
| repo-tools | `1b569c2` | 252 | 988 | 518 | 480 | 6 | 1 |
| fermat-mcp | `ef84ce2` | 14 | 68 | 33 | 5 | 28 | 0 |
| PITS-MRAS | `8b2cb2d` | 97 | 915 | 688 | 433 | 164 | 0 |
| auto-memory | `d4adb29` | 79 | 350 | 302 | 92 | 51 | 0 |
| memvid | `c416853` | 29 | 184 | 146 | 130 | 17 | 0 |
| deepthinking-mcp | `eeb45e5` | 509 | 3574 | 1477 | 1306 | 149 | 0 |
| Total | | 4665 | 22329 | 8661 | 7752 | 687 | 4 |

The columns for the issues and for the unparsed files are equal for both tools. The repositories
hold TypeScript, JavaScript and Python files. Mathts has 15 Python files of 1911, and
universal-physics-tensor has 9 of 1076. deepthinking-mcp has 15 of 509. Every file of auto-memory
and memvid is a Python file. PITS-MRAS holds 95 Python files and 2 TypeScript files.

## Method

1. **Scan.** Both tools scanned each clone. The script compared the two reports. A symbol is the
   file, the name, the line and the kind. For each symbol the script compared `exported`,
   `has_doc`, `params`, `doc_params`, `summary`, `dialect` and the list of issues. It also
   compared the `error` text and the dialects of each file.
2. **Control.** Two defects of the Python tool hide the other differences (see below). A copy of
   `code_docs.py` with two changes gave a control. The first change removes the closing `*/` from
   the summary of a one-line comment. The second change removes the comment delimiters from the
   prose that the STE check reads. The copy is a measurement tool only. The skill is not changed.
3. **Check.** Both tools ran `check` on each clone. The script compared the exit code and the
   lines of standard output.
4. **Stub, dry run.** Both tools ran `stub` on each clone. The script compared the lines
   "would document".
5. **Stub, apply.** Both tools ran `stub --apply` on a copy of five clones: repo-tools,
   fermat-mcp, auto-memory, memvid and PITS-MRAS. The script compared the set of changed files
   and the bytes of each file.
6. **Parser.** The script parsed each of the 1768 files of the Python 3.13 standard library with
   `ast`. It parsed each file again with the Python analyser of the command. Then it compared
   the verdicts.
7. **Edge cases.** The unit tests lock the cases that no repository holds. The cases are the
   dialects, the escape sequences and the stub positions. They also cover the config file, the
   paths, the exit codes and the syntax errors.

## Result: scan

The two tools find the same files and the same symbols. The count of symbols that only one tool
finds is 0. The `summary` and the `provenance` are equal on all nine clones. A file record of
`coverage.json` holds the language, the error text and the dialects. It also holds every field of
every symbol, with the text of every issue. Against the control, the file records are equal on
all nine clones. One exception exists: the order of the symbols in 40 files (see the verdicts
below). The MUST issues are 687 for each tool. The SHOULD issues are 11208 for each tool.

The Markdown report is equal as a set of lines, except for 4 lines of text. Two lines are in the
header and two lines are in the footer. They name the tool and the command.

The Python tool without the changes of the control gives other SHOULD counts.

| Rule | Python tool | Control | `repo-tools docs` |
| --- | --: | --: | --: |
| M1 | 480 | 480 | 480 |
| M2 | 120 | 120 | 120 |
| M3 | 84 | 84 | 84 |
| M4 | 3 | 3 | 3 |
| S2 | 10530 | 7513 | 7513 |
| S5 | 270 | 270 | 270 |
| S6/STE-LEN | 3163 | 3040 | 3040 |
| S6/STE-REF | 291 | 293 | 293 |
| S6/STE-VOICE | 86 | 86 | 86 |
| S6/STE-WORD | 6 | 6 | 6 |

The Python tool gives a different list of issues for 3131 symbols. The two defects explain all of
them.

- **Closing delimiter in the summary (`code_docs-wrong`).** For `/** Text. */` the Python tool
  keeps `Text. */` as the summary. The summary does not end with a full stop, so S2 fails. The
  command removes the delimiter. This rule gives 3017 S2 issues that the command does not report.
- **Delimiters as words (`code_docs-wrong`).** The Python tool gives the delimiters of a comment
  to the STE check. A delimiter counts as a word in the first sentence, so 123 sentences have
  too many words (STE-LEN). A delimiter also hides the start of the first sentence, so the check
  misses 2 issues of STE-REF. The command gives the prose without delimiters.

The unparsed files and the mixed-dialect files are equal. The tools find the same 4 files that do
not parse. They find the same 19 files with two dialects: 18 in memoryjs and 1 in
deepthinking-mcp.

## Result: check

Both tools exit 1 on all nine clones, because each clone has a MUST issue. After the line ends
are made equal, the standard output is equal on eight clones. The Python tool writes CRLF on
Windows. The command writes LF always (rule R1).

On PITS-MRAS the two outputs hold the same 103 lines in a different order. One line moves: the M1
issue of `to_batched` in `src/pits_mras/data/trajectory.py`. The line number is 29 in the output
of the command and 32 in the output of the Python tool. The Python tool lists the symbols of a Python
file breadth first (`ast.walk`), and the command lists them in the order of the file. This
rule moves the order of the symbols in 38 Python files of the nine clones.

The Python tool sorts the symbols of a TypeScript file by line. Its stack walk reverses two
symbols that share one line, and the command keeps them in the order of the file. Two compact
fixture files of repo-tools (`tests/golden/compress/js.aggressive.compact.js` and
`ts.aggressive.compact.ts`) hold such symbols. The order of the symbols differs in these 2
files.

## Result: stub

**Dry run.** The Python tool plans 909 stubs on the nine clones. The command plans 480. The
difference is 429 stubs in test files. A test file is exempt from M1, so a stub in a test file
documents a symbol that the gate never asks about. When the lines for test files are removed
from the output of the Python tool, the lines are equal on all nine clones.

**Apply.** On the five copies, both tools changed 80 files. The command changed no file that the
Python tool did not change. The Python tool changed 59 more files, and all 59 are test files.
For the 80 files, the bytes are equal after the line ends are made equal.

The line ends differ. In three of the copies (fermat-mcp, auto-memory and memvid), the files of
the work tree use CRLF. The Python tool wrote LF in all 51 files of these copies. The command kept
CRLF in all 51 files. The other two copies hold LF files, and both tools wrote LF.

## Result: parser

The Python analyser uses tree-sitter. The Python tool uses `ast`. A file that `ast` rejects must
not count as clean, so the verdicts of the two parsers must agree. Of the 1768 files, `ast`
rejects 2 and the command rejects 2. Only 1 file is in both sets.

- `Lib/test/tokenizedata/bad_coding2.py` starts with a byte-order mark. `ast` rejects the
  mark. The command removes the mark and reads the file. The difference is deliberate.
- `Lib/test/test_compile.py` has a name that continues on the next line inside round brackets
  (`(bar.` then `baz)`). CPython accepts it. The grammar reports an error, so the command
  reports the file as unparsed. This direction fails closed: the file counts as unknown and the
  gate fails.

The grammar accepts some text that CPython rejects. The command adds three checks for the cases
that the standard library and the unit tests showed.

- An indentation error: an unexpected indent, an inconsistent indent, or a block with no
  statement.
- A Python 2 statement (`print x`, but not `print >>f, x`).
- An integer with a leading zero.

The command does not find the errors that CPython finds while it builds the tree. Two examples
are `def f(*)` and `del f()`. The Python tool reports such a file as unparsed, and the gate
fails. The command measures the file.

## Differences and their verdicts

- **Closing delimiter in the summary (`code_docs-wrong`).** See the result of the scan.
- **Delimiters as words (`code_docs-wrong`).** See the result of the scan.
- **Order of the symbols (deliberate).** The command lists the symbols in the order of the file.
  The order differs in 40 files of the nine clones, and one line of one `check` output moves.
- **Text of `COVERAGE.md` (expected improvement).** The footer of the Python tool says that
  `check` recomputes each value of the report. `check` measures the code again and does not read
  the report. The footer of the command says so.
- **Parser of Python (deliberate).** Tree-sitter replaces `ast`, so the command needs no Python.
  The syntax error text is different. The list of residual cases is above.
- **Byte-order mark in a Python file (expected improvement).** The command removes the mark.
- **Docstring text (deliberate).** The command decodes the escape sequences as CPython does.
  `\N{name}` stays as written.
- **Grammar of `.tsx` and `.jsx` (deliberate).** The command uses the TSX grammar for these files
  and for the check after a stub. The Python tool uses the TypeScript grammar for them. The nine
  clones hold 1 such file, so the record measures no effect of this rule. The unit tests lock it.
- **Nothing to measure (deliberate, fail-closed).** A root with no source file exits 1. The Python
  tool passes with 0 of 0.
- **Exit 2 (deliberate).** A root that is not a folder and a malformed `.code-docs.json` exit 2.
  The Python tool passes in the first case and ends with a trace in the second case.
- **Targets of the stub (deliberate).** Only a symbol with an M1 issue gets a stub. See the result
  of the stub.
- **Line ends of the stub (expected improvement).** The command keeps CRLF. A file with a lone
  carriage return is skipped.
- **Paths of `check` (deliberate).** A `./` prefix and an absolute path in `--paths` are accepted.
  A `note:` line names an unmeasured source path.
- **JSON percentage (deliberate).** `exported_documented_pct` is `55`, not `55.0`. The key names
  are the same.

## Gaps that the parity check found

The check found three gaps in the command, and it fixed them.

1. A Python 2 print with a chevron (`print >>f, x`) is valid Python 3 syntax. The first version
   of the Python 2 check rejected valid files of the standard library for this reason.
2. The line of a syntax error was the line of the start of the file. The line is now the line of
   the innermost node with an error.
3. The grammar does not report an inconsistent indentation or a leading zero in an integer. Two
   checks now find them.

The method compares two tools, and two equal verdicts can both be wrong. The raw comparison of
the SHOULD tier showed 3131 symbols with a different list of issues. A reader could take them for
errors of the port. The control showed that two defects of the Python tool cause all of them.

## Residuals

- The grammar accepts a few Python errors that CPython finds (see the result of the parser).
- The grammar rejects a name that continues on the next line inside round brackets. The command
  reports such a file as unparsed.
