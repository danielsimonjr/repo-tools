/**
 * The mutation catalog of the fix-ledger audit (`scripts/fix-ledger-audit.ts`).
 *
 * Each entry brings back the 1.x defect of one fix of `docs/fix-ledger-2.0.0.md` in the code that
 * `repo-tools map` runs. An edit names an exact piece of text that must occur once in the file,
 * and the text that replaces it. The audit applies the edits in a scratch copy of the repository
 * and runs the tests. A fix whose reverted code still passes every test has no lock.
 *
 * A fix that lives in more than one place has one entry for each place. When the code changes,
 * an anchor can go stale. The unit test of the catalog applies every edit to the real sources, so
 * a stale anchor fails there before it can hide a result.
 */
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: an anchor is source text, and source text holds `${...}`.
import type { Edit, Mutation } from "./fix-ledger-audit.ts";

/** Builds one edit. */
const at = (file: string, find: string, replace: string): Edit => ({ file, find, replace });

/** Builds one mutation. */
const fix = (id: string, defect: string, ...edits: Edit[]): Mutation => ({
  fix: id,
  defect,
  edits,
});

/** Builds one mutation that another test file locks: `own` lists the files that must fail. */
const fixIn = (own: string[], id: string, defect: string, ...edits: Edit[]): Mutation => ({
  ...fix(id, defect, ...edits),
  own,
});

const BANNER = "src/depgraph/reporters/banner.ts";
const DISCOVERY = "src/map/discovery.ts";
const YAML = "src/depgraph/reporters/yaml.ts";
const PARSING = "src/map/parsing.ts";
const API_SURFACE = "src/depgraph/api-surface.ts";
const RESOLVER = "src/depgraph/resolver.ts";
const RESOLVERS = "src/map/resolvers.ts";
const ARTIFACTS = "src/map/artifacts.ts";
const GRAPH = "src/map/graph.ts";
const COMMAND = "src/map/command.ts";
const ROOTS = "src/depgraph/roots.ts";
const COVERAGE = "src/depgraph/coverage.ts";
const ANALYSIS = "src/depgraph/analysis.ts";
const WORKSPACES = "src/depgraph/workspaces.ts";
const PATHS = "src/depgraph/paths.ts";
const JSON_REPORT = "src/depgraph/reporters/json.ts";
const MASK = "src/mask.ts";
const IO = "src/io.ts";

export const MUTATIONS: Mutation[] = [
  fix(
    "F1",
    "Every Markdown report holds a generation time stamp, so two runs differ.",
    at(
      BANNER,
      "  return marker === null ? comment : `${marker}\\n${comment}`;",
      "  const stamp = `<!-- generated ${new Date().toISOString()} -->\\n`;\n  return marker === null ? comment + stamp : `${marker}\\n${comment}${stamp}`;",
    ),
  ),
  fix(
    "F2",
    "The discovery returns files in the order of the walk, with no sort after it.",
    at(
      DISCOVERY,
      "  return found.sort(compareParts);\n}\n\n/**\n * The source files of `language`",
      "  return found;\n}\n\n/**\n * The source files of `language`",
    ),
  ),
  fix(
    "F3",
    "A Markdown report has no generated-file banner.",
    at(BANNER, "  return bannerFor(options) + body;", "  return body;"),
  ),
  fix(
    "F4",
    "package.json pins js-yaml 4, so the YAML report is built with the wrong major version.",
    at("package.json", '"js-yaml": "5.4.2"', '"js-yaml": "4.1.1"'),
  ),
  fix(
    "F5",
    "The YAML report is built without the quote-style probe, so a js-yaml that ignores the option writes wrong quotes.",
    at(YAML, "  probeQuoteStyle(dumpFn);\n", ""),
  ),
  fix(
    "F6",
    "The tree-sitter reader takes the text of an import or export brace, so a comment becomes part of a name.",
    at(
      PARSING,
      '      for (const spec of child.children) {\n        if (spec.type !== "import_specifier") continue;\n        const name = spec.childForFieldName("name");\n        if (name) names.push(name.text);\n      }',
      '      names.push(\n        ...child.text\n          .slice(1, -1)\n          .split(",")\n          .map((part) => part.trim())\n          .filter((part) => part !== ""),\n      );',
    ),
    at(
      PARSING,
      '      for (const spec of child.children) {\n        if (spec.type !== "export_specifier") continue;\n        const target = spec.childForFieldName("alias") ?? spec.childForFieldName("name");\n        if (target) entries.push([target.text, "unknown"]);\n      }',
      '      for (const part of child.text.slice(1, -1).split(",")) {\n        if (part.trim() !== "") entries.push([part.trim(), "unknown"]);\n      }',
    ),
  ),
  fixIn(
    ["tests/unit/api-surface.test.ts"],
    "F6",
    "The API-surface reader takes export-list names from the raw text, so a comment becomes part of a name.",
    at(
      API_SURFACE,
      "    const names = masked\n      .slice(start, end)",
      "    const names = src\n      .slice(start, end)",
    ),
  ),
  fix(
    "F7",
    "An import of compiled output (dist/) does not map to its source file.",
    at(RESOLVER, "  if (!m) return path;", "  return path;"),
  ),
  fix(
    "F30",
    "A directory import does not resolve to the index file of the folder.",
    at(
      RESOLVERS,
      "      const cand = pyJoin(stem, `index${suffix}`);\n      if (knownFiles.has(cand)) return cand;",
      "      const cand = pyJoin(stem, `index${suffix}`);\n      if (knownFiles.has(cand) && false) return cand;",
    ),
  ),
  fix(
    "F30",
    "A .tsx file is not a resolution candidate, so an import of it does not resolve.",
    at(
      RESOLVERS,
      'const CANDIDATE_SUFFIXES = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];',
      'const CANDIDATE_SUFFIXES = [".ts", ".js", ".jsx", ".mjs", ".cjs"];',
    ),
  ),
  fix(
    "F8",
    "An import in a test file does not count as use, so an export that only a test uses is unused.",
    at(
      ARTIFACTS,
      "  for (const node of graph.files.values()) {\n    for (const d of node.internal) {\n      const set = imported.get(d.file)",
      '  for (const node of graph.files.values()) {\n    if (node.area !== "src") continue;\n    for (const d of node.internal) {\n      const set = imported.get(d.file)',
    ),
    at(
      ARTIFACTS,
      "  const targets = new Set([...graph.files.values()].flatMap((n) => n.internal.map((d) => d.file)));\n  const roots = new Set(graph.roots);\n  return pySorted(\n    [...graph.files]",
      '  const targets = new Set(\n    [...graph.files.values()]\n      .filter((n) => n.area === "src")\n      .flatMap((n) => n.internal.map((d) => d.file)),\n  );\n  const roots = new Set(graph.roots);\n  return pySorted(\n    [...graph.files]',
    ),
  ),
  fix(
    "F9",
    "The target of an exports subpath is not a reachability root.",
    at(ROOTS, '    if (key !== ".") addIfExists(file);', "    if (false) addIfExists(file);"),
    at(GRAPH, "  collect(pkg.exports);\n", ""),
  ),
  fix(
    "F10",
    "Test coverage does not follow a chain of bare side-effect imports.",
    at(
      COVERAGE,
      "    for (const dep of sourceByPath.get(fromPath)?.internalDependencies ?? []) {\n      if (!dep.sideEffect) continue;",
      "    for (const dep of sourceByPath.get(fromPath)?.internalDependencies ?? []) {\n      if (!dep.sideEffect || true) continue;",
    ),
    at(
      COVERAGE,
      "    for (const dep of sourceByPath.get(fromPath)?.workspaceDependencies ?? []) {\n      if (!dep.sideEffect || dep.resolved === undefined) continue;",
      "    for (const dep of sourceByPath.get(fromPath)?.workspaceDependencies ?? []) {\n      if (true || dep.resolved === undefined) continue;",
    ),
  ),
  fix(
    "F11",
    "A dynamic import() is not a dependency edge.",
    at(
      PARSING,
      '        if (spec.startsWith(".")) dynamicCalls.push({ spec, use: dynamicImportUse(node) });',
      '        if (spec.startsWith(".") && false) dynamicCalls.push({ spec, use: dynamicImportUse(node) });',
    ),
  ),
  fix(
    "F12",
    "A single-package repo without src/ has no module map: the files of its top-level folders belong to no module.",
    at(
      ANALYSIS,
      "      } else if (parts.length >= 2) {\n        // Fix F12",
      "      } else if (false) {\n        // Fix F12",
    ),
  ),
  fix(
    "F13",
    "The packages of a pnpm workspace are not read from pnpm-workspace.yaml.",
    at(WORKSPACES, 'join(root, "pnpm-workspace.yaml")', 'join(root, "pnpm-workspace.disabled")'),
  ),
  fix(
    "F14",
    "A tsup config is read only when a package script calls tsup.",
    at(
      ROOTS,
      "  for (const entry of tsupConfigEntries(root, pkgDir)) addIfExists(entry);",
      '  const callsTsup = Object.values(scripts).some((s) => typeof s === "string" && /\\btsup\\b/.test(s));\n  if (callsTsup) for (const entry of tsupConfigEntries(root, pkgDir)) addIfExists(entry);',
    ),
  ),
  fix(
    "F14",
    "Only the first entry array of a tsup config names build roots.",
    at(
      ROOTS,
      "for (const opt of code.matchAll(/[\"']?\\bentry[\"']?\\s*:\\s*(?:\\[([^\\]]*)\\]|\\{([^}]*)\\})/g)) {",
      "for (const opt of [\n      ...code.matchAll(/[\"']?\\bentry[\"']?\\s*:\\s*(?:\\[([^\\]]*)\\]|\\{([^}]*)\\})/g),\n    ].slice(0, 1)) {",
    ),
  ),
  fix(
    "F18",
    "A .d.ts file is in the test coverage denominator.",
    at(
      COVERAGE,
      '  const sourceFiles = graphFiles.filter((f) => !f.path.endsWith(".d.ts"));',
      "  const sourceFiles = graphFiles;",
    ),
  ),
  fix(
    "F19",
    "Test coverage does not trace barrel re-exports.",
    at(
      COVERAGE,
      "    for (const reExportedPath of traceReExports(path, reExportMap)) {",
      "    for (const reExportedPath of []) {",
    ),
  ),
  fix(
    "F23",
    "A dynamic import() with a backtick-quoted specifier is not a dependency edge.",
    at(
      PARSING,
      '        arg?.type === "string" ||\n        (arg?.type === "template_string" && !hasChild(arg, "template_substitution"));',
      '        arg?.type === "string";',
    ),
  ),
  fix(
    "F25",
    "A runtime dynamic import() is a type-only edge, so it closes no runtime cycle.",
    at(
      PARSING,
      '  return { typeOnly: false, names: ["*"] };\n}\n\n/** One literal `import(...)`',
      '  return { typeOnly: true, names: ["*"] };\n}\n\n/** One literal `import(...)`',
    ),
  ),
  fix(
    "F27",
    "The comment stripper cuts a // inside a string literal, so an import on that line is lost.",
    at(MASK, "    if (c === \"'\" || c === '\"') {", "    if (c === \"'\" && c === '\"') {"),
  ),
  fix(
    "F29",
    "A re-export with an alias records the source name as an export of the re-exporting file.",
    at(
      PARSING,
      '        const target = spec.childForFieldName("alias") ?? spec.childForFieldName("name");\n        if (target) entries.push([target.text, "unknown"]);',
      '        const source = spec.childForFieldName("name");\n        const alias = spec.childForFieldName("alias");\n        if (source) entries.push([source.text, "unknown"]);\n        if (alias) entries.push([alias.text, "unknown"]);',
    ),
  ),
  fix(
    "F29",
    "A named re-export also writes a second edge with no names.",
    at(
      PARSING,
      "        mod.imports.push({ specifier: specifierOf(spec), names, typeOnly, reExport: true });",
      "        mod.imports.push({ specifier: specifierOf(spec), names, typeOnly, reExport: true });\n        if (names.length > 0) {\n          mod.imports.push({ specifier: specifierOf(spec), names: [], typeOnly, reExport: true });\n        }",
    ),
  ),
  fix(
    "F31",
    "The entry-point check matches the text suffix src/index.ts, so src/mysrc/index.ts is an entry.",
    at(
      PATHS,
      '  return path === "src/index.ts" || path.endsWith("/src/index.ts");',
      '  return path.endsWith("src/index.ts");',
    ),
  ),
  fix(
    "F32",
    "A single-package module name drops the first .ts text of a directory name.",
    at(
      ANALYSIS,
      '        add(parts.length === 2 ? "root" : (parts[1] ?? ""), file);',
      '        add(parts.length === 2 ? "root" : (parts[1] ?? "").replace(".ts", ""), file);',
    ),
  ),
  fix(
    "F32",
    "The cycle label of the compact summary drops the first .ts text of a file name.",
    at(
      JSON_REPORT,
      '.map((p) => p.split("/").pop()?.replace(/\\.ts$/, ""))',
      '.map((p) => p.split("/").pop()?.replace(".ts", ""))',
    ),
  ),
  fix(
    "F33",
    "A node script that runs ./dist/x.js does not seed src/x.ts as a build root.",
    at(ROOTS, "dist\\/(\\S+?)\\.[cm]?js\\b/g,", "dist\\/(\\S+?)\\.[cm]?js\\x08/g,"),
  ),
  fix(
    "F36",
    "A negated workspace pattern does not remove the package it matches.",
    at(
      WORKSPACES,
      "      if (negated.some((n) => matchesWorkspaceGlob(n, toPosix(pkgDir)))) return;\n",
      "",
    ),
  ),
  fix(
    "F37",
    "The object form of the tsup entry option names no build root.",
    at(
      ROOTS,
      "code.matchAll(/[\"']?\\bentry[\"']?\\s*:\\s*(?:\\[([^\\]]*)\\]|\\{([^}]*)\\})/g)) {",
      "code.matchAll(/[\"']?\\bentry[\"']?\\s*:\\s*(?:\\[([^\\]]*)\\])/g)) {",
    ),
  ),
  fix(
    "F38",
    "A runtime dynamic import() records no names, so the exports of the loaded module look unreferenced.",
    at(
      PARSING,
      '      names: use.typeOnly ? use.names : ["*"],',
      "      names: use.typeOnly ? use.names : [],",
    ),
    at(PARSING, '      addName(runtime.names, "*");', "      void runtime;"),
  ),
  fix(
    "F38",
    "A type-position import(...).Name records no name.",
    at(
      PARSING,
      '      return { typeOnly: true, names: name !== "" ? [name] : [] };',
      "      return { typeOnly: true, names: [] };",
    ),
  ),
  fix(
    "F39",
    "The comment stripper does not know regular-expression literals.",
    at(
      MASK,
      '    if (c === "/" && next !== "/" && next !== "*" && regexCanStart(src, prev, closedStmt)) {',
      '    if (c === "/" && next !== "/" && next !== "*" && false && regexCanStart(src, prev, closedStmt)) {',
    ),
  ),
  fix(
    "F39",
    "After a++ or a-- the stripper reads a / as the start of a regex, not as a division.",
    at(MASK, '  if ((c === "+" || c === "-") && src[prev - 1] === c) return false;\n', ""),
  ),
  fix(
    "F39",
    "After the ) of if (x) the stripper reads a / as a division, not as a regex.",
    at(MASK, '  if (c === ")") return afterStmtParen;', '  if (c === ")") return false;'),
  ),
  fix(
    "F40",
    "A member call with a type-argument list on a dynamic import is a type-only edge.",
    at(
      PARSING,
      '      top.parent.childForFieldName("function")?.id === top.id;',
      '      top.parent.childForFieldName("function")?.id === top.id &&\n      top.parent.childForFieldName("type_arguments") === null;',
    ),
  ),
  fix(
    "F41",
    "A package that a negated workspace pattern names still contributes its roots, so its files are not orphans.",
    at(
      WORKSPACES,
      "      if (negated.some((n) => matchesWorkspaceGlob(n, toPosix(pkgDir)))) return;\n",
      "",
    ),
  ),
  fix(
    "F42",
    "A source file on disk that the census does not list gives no warning.",
    at(COMMAND, "  if (gaps.length > 0) {", "  if (gaps.length > 0 && false) {"),
  ),
  fix(
    "F42",
    "--strict-census does not fail the run.",
    at(COMMAND, "    if (options.strictCensus) {", "    if (false) {"),
  ),
  fix(
    "F44",
    "A .d.ts file with no importer is left out of the list of files with no importer.",
    at(
      ARTIFACTS,
      '      .filter(([p, n]) => n.area === "src" && !targets.has(p) && !roots.has(p))',
      '      .filter(([p, n]) => n.area === "src" && !targets.has(p) && !roots.has(p) && !p.endsWith(".d.ts"))',
    ),
  ),
  fix(
    "M1",
    "--strict-orphans does not fail the run.",
    at(COMMAND, "    if (config.strictOrphans) {", "    if (false) {"),
  ),
  fix(
    "M1",
    "An orphan source file gives no warning.",
    at(COMMAND, "  if (orphans.length > 0) {", "  if (false) {"),
  ),
  fix(
    "M1",
    "The bin targets of the root package are not roots.",
    at(
      GRAPH,
      '  for (const key of ["main", "module", "bin"]) collect(pkg[key]);',
      '  for (const key of ["main", "module"]) collect(pkg[key]);',
    ),
  ),
  fix(
    "F15",
    "package-export-surfaces.json lists every named export, not only the public surface.",
    at(
      "src/depgraph/reporters/surfaces.ts",
      "        if (wholeFile || surface.publicNamed.has(`${f.path}::${n}`)) set.add(n);",
      "        set.add(n);",
    ),
  ),
  fix(
    "F15",
    "A re-export chain from a package root does not make the re-exported names public.",
    at(
      ANALYSIS,
      "      if (!dep.reExport) continue;\n      const target = byPath.get(targetOf(file.path, dep, byPath));",
      "      if (!dep.reExport || true) continue;\n      const target = byPath.get(targetOf(file.path, dep, byPath));",
    ),
  ),
  fix(
    "F16",
    "The default report folder is docs/Architecture, in upper case.",
    at(
      PATHS,
      'export const OUTPUT_SUBDIR = "docs/architecture";',
      'export const OUTPUT_SUBDIR = "docs/Architecture";',
    ),
  ),
  fix(
    "F17",
    "A package src/index.ts that no declared entry names is not a root, so it is unused.",
    at(GRAPH, "      if (fallback) pkgRoots.push(fallback);", "      void fallback;"),
  ),
  fix(
    "F17",
    "A file that a build or test config names in new URL() is not a build root.",
    at(
      GRAPH,
      "    for (const entry of configReferencedEntries(root)) {",
      "    for (const entry of [] as string[]) {",
    ),
  ),
  fix(
    "F17",
    "A file that only a test reaches is an orphan, not test-only.",
    at("src/map/discovery.ts", '    if (flags.testReachable) return "test-only";\n', ""),
  ),
  fix(
    "F17",
    "The entries of a tsc -p tsconfig are not build roots.",
    at(ROOTS, '      seedTsconfigEntries(root, pkgDir, m[1] ?? "", addIfExists);', "      void m;"),
  ),
  fix(
    "F17",
    "A bin target is not a build root.",
    at(ROOTS, "  for (const bin of binValues) {", "  for (const bin of [] as unknown[]) {"),
    at(
      GRAPH,
      '  for (const key of ["main", "module", "bin"]) collect(pkg[key]);',
      '  for (const key of ["main", "module"]) collect(pkg[key]);',
    ),
  ),
  fix(
    "F20",
    "The privacy check accepts a tracked .exe file.",
    at(
      "scripts/privacy-check.ts",
      "  if (/\\.exe$/i.test(file) || sizeBytes > MAX_TRACKED_BYTES) {",
      "  if (sizeBytes > MAX_TRACKED_BYTES) {",
    ),
  ),
  fix(
    "F21",
    "A long export list renders inline, not as a fenced block.",
    at(
      "src/depgraph/reporters/markdown.ts",
      "export const LONG_EXPORT_LIST_THRESHOLD = 8;",
      "export const LONG_EXPORT_LIST_THRESHOLD = 80;",
    ),
  ),
  fix(
    "F21",
    "The fenced export list does not wrap at 100 characters.",
    at(
      "src/depgraph/reporters/markdown.ts",
      "export const EXPORT_LIST_WRAP_WIDTH = 100;",
      "export const EXPORT_LIST_WRAP_WIDTH = 100000;",
    ),
  ),
  fix(
    "F22",
    "A sort uses the collation of the runtime, not code-unit order.",
    at(
      "src/sort.ts",
      "  return a < b ? -1 : 1;",
      '  return new Intl.Collator("en").compare(a, b);',
    ),
  ),
  fix(
    "F22",
    "A source file calls localeCompare.",
    at("src/sort.ts", "  return a < b ? -1 : 1;", "  return a.localeCompare(b);"),
  ),
  fix(
    "F24",
    "The in-file reference count reads the source with its comments, so a name in a comment is a use.",
    at(ARTIFACTS, "  const code = stripComments(text);", "  const code = text;"),
  ),
  fix(
    "F26",
    "A type-only component that equals a runtime component is reported again.",
    at(
      "src/depgraph/cycles.ts",
      '  const typeOnlySccs = stronglyConnectedComponents(graphs.all).filter(\n    (c) => !runtimeKeys.has(c.join("\\n")),\n  );',
      "  const typeOnlySccs = stronglyConnectedComponents(graphs.all);\n  void runtimeKeys;",
    ),
  ),
  fix(
    "F26",
    "The representative cycle depends on the order of the neighbours: it is not the first shortest in code-unit order.",
    at(
      "src/depgraph/cycles.ts",
      "    for (const next of graph.get(node) ?? []) {\n      if (!inside.has(next)) continue;",
      "    for (const next of [...(graph.get(node) ?? [])].reverse()) {\n      if (!inside.has(next)) continue;",
    ),
  ),
  fix(
    "F26",
    "The components are not sorted by their smallest member.",
    at(
      "src/depgraph/cycles.ts",
      '    }))\n    .sort((a, b) => compareCodeUnits(a.members[0] ?? "", b.members[0] ?? ""));',
      "    }));",
    ),
  ),
  fix(
    "F26",
    "A file that imports itself is not a component.",
    at("src/map/cycles.ts", "if (component.length > 1 || selfLoop)", "if (component.length > 1)"),
  ),
  fix(
    "F26",
    "The members of a component are not sorted in code-unit order.",
    at(
      "src/map/cycles.ts",
      "components.push(component.sort(compareCodeUnits))",
      "components.push(component)",
    ),
  ),
  fix(
    "F28",
    "The in-file reference count uses the word boundary \\b, which does not hold beside a $.",
    at(
      ARTIFACTS,
      "const IDENT_BOUNDARY = `(?:(?<=${IDENT})(?!${IDENT})|(?<!${IDENT})(?=${IDENT}))`;",
      'const IDENT_BOUNDARY = "\\\\b";',
    ),
  ),
  fix(
    "F28",
    "A symbol name goes into the regular expression without escaping, so a $ is an anchor.",
    at(
      ARTIFACTS,
      "${IDENT_BOUNDARY}${reEscape(name)}${IDENT_BOUNDARY}",
      "${IDENT_BOUNDARY}${name}${IDENT_BOUNDARY}",
    ),
  ),
  fix(
    "F34",
    "The file discovery follows a linked folder.",
    at(
      DISCOVERY,
      "        if (isReparsePoint(full)) {\n          onLink(",
      "        if (false && isReparsePoint(full)) {\n          onLink(",
    ),
  ),
  fix(
    "F34",
    "A dangling link is not listed.",
    at(
      DISCOVERY,
      "        if (isFile(full)) visit(parts, e.name);\n        else onLink([...parts, e.name]);",
      "        if (isFile(full)) visit(parts, e.name);",
    ),
  ),
  fix(
    "F34",
    "The skipped links are not reported.",
    at(
      GRAPH,
      "  graph.skippedLinks = [...skippedLinks].sort(compareCodeUnits);",
      "  graph.skippedLinks = [];",
    ),
  ),
  fix(
    "F34",
    "A workspace package folder that is a link is read.",
    at(WORKSPACES, "  if (isLink(join(root, pkgDir))) return;\n", ""),
  ),
  fix(
    "F35",
    "A script that is not a string stops the read of the roots of its package.",
    at(ROOTS, '    if (typeof script !== "string") {', "    if (false) {"),
  ),
  fix(
    "F35",
    "A root package.json that is not an object stops the run.",
    at(GRAPH, "  if (!isObject(pkg)) {\n    return [[],", "  if (false) {\n    return [[],"),
  ),
  fix(
    "F35",
    "A workspace package.json that is not an object stops the workspace detection.",
    at(WORKSPACES, "  if (!isJsonObject(pkg)) {\n    warn(", "  if (false) {\n    warn("),
  ),
  fix(
    "F43",
    "A package that imports its own name gets no edge to its own source.",
    at(
      GRAPH,
      "    const self = members.size === 0 ? selfPackage(root) : undefined;",
      "    const self = undefined;",
    ),
  ),
  fix(
    "F43",
    "A self-import of a subpath does not try src/<sub>/index.ts.",
    at(
      ROOTS,
      "(exists(file) ? file : exists(folder) ? folder : undefined)",
      "(exists(file) ? file : undefined)",
    ),
  ),
  fix(
    "F43",
    "The target of an exports entry is not mapped from dist/ to src/.",
    at(ROOTS, "distToSrc(under(target))", "under(target)"),
  ),
  fix(
    "F43",
    "A package without an exports entry does not use main for its own name.",
    at(
      ROOTS,
      '  if (!("." in targets) && typeof pkg.main === "string") targets["."] = pkg.main;\n',
      "",
    ),
  ),
  fix(
    "R1",
    "A report ends with the line feeds its generator left: no line feed, or two.",
    at(IO, '.replace(/\\n+$/, "")}\\n`;', "}`;"),
  ),
];
