import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { computePublicSurface } from "../../src/depgraph/analysis.ts";
import {
  buildDuplicateEntries,
  buildDuplicateReport,
  classifyDefiner,
  collectImportedLocalNames,
  collectOwnDefiners,
  DUPLICATE_SYMBOLS_NOTE,
  detectDuplicateSymbols,
  escapeRegExpLiteral,
  finalizeDuplicateEntry,
  findAllowlistMatch,
  globMatchSingle,
  isAliasDelegationBody,
  isDispatchVariantBody,
  loadDuplicateAllowlist,
  RUNTIME_DUP_CATEGORIES,
  TYPE_DUP_CATEGORIES,
  tallyByTag,
} from "../../src/depgraph/duplicates.ts";
import {
  generateDuplicateSymbolsJson,
  generateDuplicateSymbolsMarkdown,
} from "../../src/depgraph/reporters/duplicates.ts";
import { toParsedFiles } from "../../src/map/adapter.ts";
import { buildGraph } from "../../src/map/graph.ts";
import { makeTree, removeTrees } from "./tree.ts";

afterAll(removeTrees);

const root = makeTree({
  "src/index.ts": "export { same } from './a.js';\nexport * from './v.js';\n",
  "src/a.ts": "export function same() {}\nexport interface Shape { a: 1 }\n",
  "src/b.ts": "export function same() {}\nexport interface Shape { b: 1 }\n",
  "src/c.ts": "import { same as base } from './a.js';\nexport const alias = base;\n",
  "src/d.ts": "export const alias = 2;\n",
  "src/v.ts": "export const VERSION = '1';\nexport const op = mathTyped('op', {});\n",
  "src/w.ts": "export const VERSION = '2';\nexport const op = mathTyped('op', {});\n",
  "docs/architecture/duplicate-allowlist.json": JSON.stringify({
    entries: [{ names: ["VERSION"], filesGlob: ["src/**"], reason: "per-package version" }],
  }),
});
const allowPath = join(root, "docs/architecture/duplicate-allowlist.json");
const files = toParsedFiles(await buildGraph(root), root).filter((f) =>
  ["index", "a", "b", "c", "d", "v", "w"].includes(f.name),
);

describe("duplicate helpers", () => {
  test("globMatchSingle handles *, /** and prefix patterns", () => {
    expect(globMatchSingle("*", "x")).toBe(true);
    expect(globMatchSingle("src/**", "src/a/b.ts")).toBe(true);
    expect(globMatchSingle("is*", "isNumber")).toBe(true);
    expect(globMatchSingle("a", "ab")).toBe(false);
  });

  test("findAllowlistMatch needs a name match and a file match", () => {
    const list = loadDuplicateAllowlist(allowPath);
    expect(findAllowlistMatch(list, "VERSION", "src/v.ts")?.reason).toBe("per-package version");
    expect(findAllowlistMatch(list, "VERSION", "lib/v.ts")).toBeUndefined();
    expect(loadDuplicateAllowlist(join(root, "absent"))).toEqual([]);
  });

  test("escapeRegExpLiteral escapes special characters", () => {
    expect(escapeRegExpLiteral("a.b$")).toBe("a\\.b\\$");
  });

  test("isDispatchVariantBody and isAliasDelegationBody read the constant body", () => {
    expect(isDispatchVariantBody("export const op = mathTyped<X>('op', {})", "op")).toBe(true);
    expect(isDispatchVariantBody("export const op = 1", "op")).toBe(false);
    const code = "import { a as b } from './a.js';\nexport const x = b;";
    expect(collectImportedLocalNames(code)).toEqual(new Set(["b"]));
    expect(isAliasDelegationBody(code, "x", new Set(["b"]))).toBe(true);
    expect(isAliasDelegationBody("export const x = y;", "x", new Set(["b"]))).toBe(false);
  });

  test("classifyDefiner prefers the allowlist, then constant shapes, then PLAIN", () => {
    const list = loadDuplicateAllowlist(allowPath);
    const read = (p: string) =>
      p === "src/c.ts" ? "import { q } from 'x';\nexport const alias = q;" : "";
    const byPath = new Map(files.map((f) => [f.path, f]));
    const c = byPath.get("src/c.ts");
    const v = byPath.get("src/v.ts");
    if (!c || !v) throw new Error("fixture");
    expect(classifyDefiner(v, "VERSION", "constant", list, read)).toEqual({
      tag: "ALLOWLISTED",
      reason: "per-package version",
    });
    expect(classifyDefiner(c, "alias", "constant", list, read).tag).toBe("ALIAS_DELEGATION");
    expect(classifyDefiner(c, "alias", "function", list, read).tag).toBe("PLAIN");
  });

  test("collectOwnDefiners skips re-exports and counts interfaces once", () => {
    const runtime = collectOwnDefiners(files, RUNTIME_DUP_CATEGORIES);
    expect(runtime.get("same")?.map((d) => d.file.path)).toEqual(["src/a.ts", "src/b.ts"]);
    const types = collectOwnDefiners(files, TYPE_DUP_CATEGORIES);
    expect(types.get("Shape")?.map((d) => d.category)).toEqual(["interface", "interface"]);
  });

  test("finalizeDuplicateEntry gives the canonical hint", () => {
    const d = (file: string, pub: boolean) =>
      ({ file, package: "p", public: pub, tag: "PLAIN" }) as const;
    expect(
      finalizeDuplicateEntry(
        "n",
        new Set(["b", "a"]),
        [d("x", true), d("y", false)],
        "TRUE_DUPLICATE",
      ),
    ).toMatchObject({ category: "a+b", canonicalHint: "x" });
    expect(
      finalizeDuplicateEntry("n", new Set(["a"]), [d("x", true), d("y", true)], "TRUE_DUPLICATE")
        .canonicalHint,
    ).toBe("AMBIGUOUS");
    expect(
      finalizeDuplicateEntry("n", new Set(["a"]), [d("x", false)], "TRUE_DUPLICATE").canonicalHint,
    ).toBe("internal-only");
  });
});

describe("duplicate detection and report", () => {
  const surface = computePublicSurface(files, root, new Map());
  const dup = detectDuplicateSymbols(files, surface, root);

  test("detectDuplicateSymbols classes every duplicated name", () => {
    expect(dup.runtime.map((e) => [e.name, e.tag])).toEqual([
      ["same", "TRUE_DUPLICATE"],
      ["op", "DISPATCH_VARIANT"],
      ["alias", "ALIAS_DELEGATION"],
      ["VERSION", "ALLOWLISTED"],
    ]);
    expect(dup.runtime[0]?.canonicalHint).toBe("src/a.ts");
    expect(dup.types.map((e) => [e.name, e.tag])).toEqual([["Shape", "TRUE_DUPLICATE"]]);
  });

  test("buildDuplicateEntries keeps names with two distinct files only", () => {
    const byName = collectOwnDefiners(
      files.filter((f) => f.path === "src/index.ts" || f.path === "src/a.ts"),
      RUNTIME_DUP_CATEGORIES,
    );
    expect(buildDuplicateEntries(byName, surface, [], () => "")).toEqual([]);
  });

  test("tallyByTag and buildDuplicateReport count by tag", () => {
    expect(tallyByTag(dup.runtime)).toEqual({
      TRUE_DUPLICATE: 1,
      DISPATCH_VARIANT: 1,
      ALIAS_DELEGATION: 1,
      ALLOWLISTED: 1,
    });
    const report = buildDuplicateReport(dup);
    expect(report).not.toHaveProperty("generated");
    expect(report.note).toBe(DUPLICATE_SYMBOLS_NOTE);
    expect(report.summary.typeDuplicates).toBe(1);
  });

  test("the reporters render the tables and the JSON", () => {
    const report = buildDuplicateReport(dup);
    const md = generateDuplicateSymbolsMarkdown(report);
    expect(md.startsWith("# Duplicate Symbols\n\nNames that are OWN-DEFINED")).toBe(true);
    expect(md).toContain("| `same` | function | `src/a.ts` (unknown, public, PLAIN)<br>`src/b.ts`");
    expect(md).toContain("(unknown, internal, ALLOWLISTED: per-package version)");
    expect(md).toContain("| `op` | constant |");
    const json = generateDuplicateSymbolsJson(report);
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(report)));
    expect(json.endsWith("}")).toBe(true);
  });
});
