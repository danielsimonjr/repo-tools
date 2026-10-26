<!-- repo-map:no-verification -->
<!-- This record measures another repository; it makes no claim about the graph of this repository. -->

# Parity record of `repo-tools clones`

This record compares `repo-tools clones` with the prototype script of the memoryjs duplicate-function
audit. The prototype parses with the oxc parser. The command parses with tree-sitter. Both use the same
detection rules, so the record measures how far the choice of parser moves the result.

The record covers two repositories. The first part covers memoryjs. The section "Second repository:
deepthinking-mcp" covers a second repository with other naming habits.

The input of the first part is `src/` of memoryjs at commit `6a20b5c` (292 TypeScript files). The audit
report is `docs/analysis/DUPLICATE_FUNCTION_AUDIT.md` in that repository. It lists 1,372 functions.

| Measure | Prototype | Command |
| --- | --: | --: |
| Files read | 292 | 292 |
| Files with a parse error | not recorded | 0 |
| Units of 50 or more labels | 1,372 | 1,417 |
| Exact groups | 20 | 22 |
| Near pairs | 177 | 145 |

## Method

1. **Input.** A fresh clone of memoryjs was set to commit `6a20b5c`. The `src/` folder of that clone
   equals the folder that the prototype read. `diff -r` shows no difference.
2. **Run.** The built bundle `dist/cli.js` ran `repo-tools clones <clone> --src=src --out=<folder>`. It
   ran once with Node and once with Bun. The two runs wrote the same bytes in both output files. A run
   from the source files wrote the same bytes too.
3. **Compare.** A script read `inventory.jsonl` and `clones.json` of both tools. The key of a unit is
   its file, its container, its name and its first line. The key of a group or a pair is the set of the
   keys of its units.

## Result: units

| Measure | Units |
| --- | --: |
| In both outputs (same file, container, name and first line) | 1,368 |
| Only in the prototype | 4 |
| Only in the command | 49 |
| Common units with a different kind | 0 |

The kind (function, method, constructor, accessor, field) is equal on all 1,368 common units.

The label count of the command is 1.05 times the count of the prototype (median over the common units).
The 5th percentile is 0.97 and the 95th percentile is 1.13. The two parsers give different tree shapes,
so the counts differ a little.

All 53 units that only one tool reports lie at the cutoff of 50 labels. The 49 units of the command have
50 to 56 labels (median 51). The 4 units of the prototype have 50, 50, 53 and 55 labels. A unit that lies
at the cutoff falls on one side or the other, depending on the parser. The count of units follows the
cutoff, not a difference in the rules. With `--min-nodes=48` the command reports 1,457 units, and with
`--min-nodes=40` it reports 1,640.

## Result: exact groups

The 20 exact groups of the prototype are all in the output of the command. The command reports 2 more:

- `EpisodicMemoryManager.getNextEvent` and `EpisodicMemoryManager.getPreviousEvent`. The bodies differ
  only in the name of one enum member (`PRECEDES` and `FOLLOWS`).
- `ProceduralGraphState.nextTimestamp` and `SqliteProceduralGraphBacking.nextTimestamp`.

Both pairs are real copies. The prototype did not report them because their label count lies below the
cutoff of 50 in its tree.

## Result: near pairs

| Measure | Pairs |
| --- | --: |
| In both outputs | 135 |
| Only in the prototype | 42 |
| Only in the command | 10 |

On the 135 common pairs, the structural score `jStruct` differs by 0.011 at the median and by 0.127 at
the maximum.

The 42 pairs that only the prototype reports have two causes:

- **32 nested pairs.** In each pair one function lies inside the other, as with a function and a
  closure in its body. The command never pairs a unit with a unit that it contains. The prototype did.
  The rule changed on purpose: such a pair holds the same text twice.
- **10 other pairs.** Seven have a `jStruct` from 0.603 to 0.663, next to the threshold of 0.6. Three
  are containment pairs (`jStruct` from 0.285 to 0.336, containment from 0.91 to 1). The shingles come
  from the labels, and the labels differ a little between the parsers, so the score of a pair differs a
  little too. A run of the command with `--near=0.55 --containment=0.85 --containment-min=15` leaves 5 of
  the 10 pairs missing.

None of the 42 pairs holds one of the 4 units that only the prototype reports.

The command reports 10 pairs that the prototype does not. Two of them are the exact pairs above.

## Time

The command read the 292 files of memoryjs and printed the summary in 2.6 to 4.2 seconds. The range
covers three runs of each of three ways to start the command, without an output folder. The three ways
are the source files with Bun, the bundle with Node and the bundle with Bun. All runs used one Windows
computer. The first two runs on the fresh clone took 15 and 19 seconds, and each of them also wrote the
two output files. The cause of the difference is not measured.

## Second repository: deepthinking-mcp

The input is `src/` of deepthinking-mcp at commit `9e04da7` (243 TypeScript files). The repository holds
many handler classes in `src/modes/handlers` and many exporters that build LaTeX, TikZ and Mermaid text
in template strings. The command reports 466 units under `src/export` and 382 under `src/modes`. No audit
report exists for this repository.

| Measure | Prototype | Command |
| --- | --: | --: |
| Files read | 243 | 243 |
| Files with a parse error | 0 | 3 |
| Units of 50 or more labels | 1,174 | 1,199 |
| Exact groups | 12 | 13 |
| Near pairs | 442 | 402 |

### Method

1. **Input.** A fresh shallow clone was set to commit `9e04da7`. Both tools read its `src/` folder.
2. **Run.** The command ran as `repo-tools clones <clone> --src=src --out=<folder>` from the source
   files with Bun. The prototype ran as `node fn-inventory.mjs <clone> src <folder> 50 0.6`. It loaded
   oxc-parser 0.150.0 from the `node_modules` folder of another checkout, because the clone has none.
3. **Compare.** The same script and the same keys as for memoryjs.

### Result: units

| Measure | Units |
| --- | --: |
| In both outputs (same file, container, name and first line) | 1,172 |
| Only in the prototype | 2 |
| Only in the command | 27 |
| Common units with a different kind | 0 |

The label count of the command is 1.04 times the count of the prototype (median over the common units).
The 5th percentile is 0.98 and the 95th percentile is 1.13.

The 2 units of the prototype have 50 and 52 labels in the prototype and 48 and 47 in the command. 25 of
the 27 units of the command have 45 to 49 labels in the prototype and 50 to 62 in the command. These 27
units follow the cutoff, as in memoryjs.

The other 2 units do not lie at the cutoff. `LatexMermaidIntegrator.generateMermaidPreamble` has 103
labels in the command, and `LaTeXExporter.getColorScheme` has 61. The prototype counts fewer than 30
labels for each of them. Both bodies are template strings of LaTeX text with many backslashes. Tree-sitter
makes one node for each escape sequence and one for each text run between two escapes. The first body has
40 escape nodes and 48 text nodes. The prototype counts one node for a template element. Thus a function
that is mostly a template string has more labels in the command. The memoryjs run did not show this case.

The 3 files with a parse error hold 11 units. All 11 are in both outputs, and their label ratio runs from
1.00 to 1.13. Rewrite the three invalid lines in a copy of the tree (`abstract?:` to `abstractx?:`). The
copy has no parse error. It gives the same `inventory.jsonl` and `clones.json`, byte for byte.

### Result: exact groups

The 12 exact groups of the prototype are all in the output of the command. The command reports 1 more:
`CausalHandler.findEntryNodes` and `CausalHandler.findExitNodes`. The two bodies differ in the name of
one edge field (`to` and `from`) and in one variable name. Both units lie below the cutoff in the
prototype (46 labels) and above it in the command (57 labels). The nine text-identical groups are the
same in both outputs.

### Result: near pairs

| Measure | Pairs |
| --- | --: |
| In both outputs | 385 |
| Only in the prototype | 57 |
| Only in the command | 17 |

On the 385 common pairs, the structural score `jStruct` differs by 0.008 at the median and by 0.211 at
the maximum.

The 57 pairs that only the prototype reports have two causes:

- **27 nested pairs.** In each pair one function lies inside the other. The command never pairs a unit
  with a unit that it contains.
- **30 other pairs.** Eighteen have a `jStruct` from 0.600 to 0.636, next to the threshold of 0.6.
  Twelve are containment pairs (`jStruct` from 0.185 to 0.585, containment from 0.902 to 0.941). A run of
  the command with `--near=0.55 --containment=0.85 --containment-min=15` leaves 5 of the 30 pairs missing.

None of the 30 pairs holds one of the 2 units that only the prototype reports.

The command reports 17 pairs that the prototype does not. Eight are containment pairs, eight have a
`jStruct` from 0.604 to 0.677, and one is the exact pair above. Four of the 17 hold a unit that only the
command reports.

### Time

The command read the 243 files and printed the summary in 4.0 to 4.2 seconds. The range covers three
runs from the source files with Bun, without an output folder, on one Windows computer.

## What this record does not show

- The record shows that two parsers agree, not that every pair is a copy that should merge. Read both
  bodies of a pair before you change anything.
- The record is a regression record for the choice of parser. The two tools give different pair counts
  on the same input (177 and 145 on memoryjs, 442 and 402 on deepthinking-mcp). A count is therefore
  not a stable measure, and the record makes no claim of comparison between repositories.
- The record covers two repositories, and both are TypeScript with a library layout. A repository with
  more generated code, other syntax or a JavaScript majority can differ. The command does not read
  Python files, so no Python repository can be compared.
- The prototype is not published. For memoryjs the record cites its published report. For
  deepthinking-mcp no report exists, so a reader cannot repeat the prototype run from this record.
