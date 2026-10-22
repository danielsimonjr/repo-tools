/**
 * Test coverage on the map engine's graph (design decision D5): TEST_COVERAGE.md and
 * test-coverage.json, from depgraph's analyzer run on the `src` and `tests` files of the graph,
 * for every language. The coverage policy is an input, so it never comes from the output folder
 * (D9).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NAMESPACE_IMPORT_COVERAGE_CAVEAT } from "../../src/depgraph/reporters/coverage.ts";
import { emitTestCoverage } from "../../src/map/coverage.ts";
import { buildGraph } from "../../src/map/graph.ts";
import { makeTempDir } from "./temp.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A new folder with the files `files`. */
function repo(files: Record<string, string>): string {
  const root = makeTempDir("map-coverage");
  made.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
}

// biome-ignore lint/suspicious/noExplicitAny: the artifact is untyped JSON.
type Json = any;

/** Writes the two coverage reports into `<root>/out`; returns the Markdown and the JSON. */
async function coverage(root: string): Promise<{ md: string; json: Json }> {
  const out = join(root, "out");
  mkdirSync(out, { recursive: true });
  const [mdPath, jsonPath] = emitTestCoverage(await buildGraph(root), root, out);
  return {
    md: readFileSync(mdPath as string, "utf8"),
    json: JSON.parse(readFileSync(jsonPath as string, "utf8")),
  };
}

const TS = {
  "package.json": '{"name": "demo", "main": "src/a.ts"}\n',
  "src/a.ts": 'import "./side.js";\nexport const a = 1;\n',
  "src/side.ts": "globalThis.x = 1;\nexport {};\n",
  "src/b.ts": "export const b = 2;\n",
  "tests/a.test.ts": 'import { a } from "../src/a.js";\nexport const t = a;\n',
};

describe("emitTestCoverage", () => {
  test("a test covers what it imports and the side-effect imports behind it", async () => {
    const { json } = await coverage(repo(TS));
    expect(json.testedFiles).toEqual(["src/a.ts", "src/side.ts"]);
    expect(json.untestedFiles).toEqual(["src/b.ts"]);
    expect(json.metadata.totalTestFiles).toBe(1);
    expect(json.testToSourceMap["tests/a.test.ts"]).toEqual(["src/a.ts", "src/side.ts"]);
  });

  test("the Markdown has the `repo-tools map` banner and the TypeScript test hint", async () => {
    const { md } = await coverage(repo(TS));
    expect(md).toContain("Regenerate with `repo-tools map`.");
    expect(md).toContain("# Test Coverage Analysis");
    expect(md).toContain("- `src/b.ts` → Expected test: `tests/unit/");
    expect(md.endsWith("\n")).toBe(true);
    expect(md).not.toContain("\r");
  });

  test("the policy is read from docs/architecture, never from the output folder", async () => {
    const policy = JSON.stringify({
      categories: {
        gen: { label: "Generated", rationale: "Made by a tool.", exactPaths: ["src/b.ts"] },
      },
    });
    let { json } = await coverage(
      repo({ ...TS, "docs/architecture/coverage-policy.json": policy }),
    );
    expect(json.metadata.effectiveCoverage.policyLoaded).toBe(true);
    expect(json.metadata.effectiveCoverage.excludedTotal).toBe(1);
    ({ json } = await coverage(repo({ ...TS, "out/coverage-policy.json": policy })));
    expect(json.metadata.effectiveCoverage.policyLoaded).toBe(false);
  });

  test("a test covers a file it loads with import(), or through dist/, as in 1.x", async () => {
    const { json } = await coverage(
      repo({
        "package.json": '{"name": "demo", "main": "src/a.ts"}\n',
        "src/a.ts": "export const a = 1;\n",
        "src/lazy.ts": "export const lazy = 1;\n",
        "src/built.ts": "export const built = 1;\n",
        "src/skipped.ts": "export const skipped = 1;\n",
        "tests/load.test.ts": [
          "const name = 'x';",
          "export const m = await import('../src/lazy.js');",
          // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is TypeScript source with a template literal.
          "export const n = await import(`../src/${name}.js`);",
          "export { built } from '../dist/built.js';",
          "",
        ].join("\n"),
      }),
    );
    expect(json.testedFiles).toEqual(["src/built.ts", "src/lazy.ts"]);
    expect(json.untestedFiles).toEqual(["src/a.ts", "src/skipped.ts"]);
  });

  test("a fixture or a helper under tests/ is no test file (the name decides, as in 1.x)", async () => {
    const { json } = await coverage(
      repo({
        ...TS,
        "tests/fixtures/data.ts": 'import { b } from "../../src/b.js";\nexport const d = b;\n',
        "tests/helpers.ts": 'import { b } from "../src/b.js";\nexport const h = b;\n',
      }),
    );
    expect(json.untestedFiles).toEqual(["src/b.ts"]);
    expect(json.metadata.totalTestFiles).toBe(1);
  });

  test("a Python test file follows pytest's names: test_*.py or *_test.py", async () => {
    const { json } = await coverage(
      repo({
        "pkg/__init__.py": "",
        "pkg/a.py": "x = 1\n",
        "pkg/b.py": "y = 2\n",
        "pkg/c.py": "z = 3\n",
        "tests/conftest.py": "from pkg.c import z\n",
        "tests/test_a.py": "from pkg.a import x\n",
        "tests/b_test.py": "from pkg.b import y\n",
      }),
    );
    expect(json.testedFiles).toEqual(["pkg/a.py", "pkg/b.py"]);
    expect(json.metadata.totalTestFiles).toBe(2);
  });

  test("a Python repo gets coverage too, without the TypeScript test hint (D5)", async () => {
    const { md, json } = await coverage(
      repo({
        "pkg/__init__.py": "",
        "pkg/a.py": "x = 1\n",
        "pkg/b.py": "y = 2\n",
        "tests/test_a.py": "from pkg.a import x\n",
      }),
    );
    expect(json.testedFiles).toEqual(["pkg/a.py"]);
    expect(json.untestedFiles).toEqual(["pkg/__init__.py", "pkg/b.py"]);
    expect(md).toContain("- `pkg/b.py`");
    expect(md).not.toContain("Expected test");
  });
});

describe("emitTestCoverage, the basis of a C# report", () => {
  const CS = {
    "src/Core/Core.csproj": '<Project Sdk="Microsoft.NET.Sdk"></Project>\n',
    "src/Core/A.cs": "namespace Demo.Core;\npublic class A { }\n",
    "src/Core/B.cs": "namespace Demo.Core;\npublic class B { }\n",
    "tests/ATests.cs": "using Demo.Core;\nnamespace Demo.Tests;\npublic class ATests { }\n",
  };

  test("a C# `using` covers every file of the namespace, and the percentage stays 100.0", async () => {
    const { json } = await coverage(repo(CS));
    expect(json.testedFiles).toEqual(["src/Core/A.cs", "src/Core/B.cs"]);
    expect(json.untestedFiles).toEqual([]);
    expect(json.metadata.coveragePercent).toBe("100.0");
  });

  test("the JSON names the namespace-import basis and the caveat", async () => {
    const { json } = await coverage(repo(CS));
    expect(json.metadata.coverageBasis).toBe("namespace-import");
    expect(json.metadata.coverageCaveat).toContain("namespace");
    expect(json.metadata.coverageCaveat).toContain("does not show that a test uses the file");
  });

  test("the Markdown states the basis between the summary table and the file lists", async () => {
    const { md } = await coverage(repo(CS));
    const table = md.indexOf("Coverage (raw, direct-import)");
    const note = md.indexOf("by namespace import");
    const lists = md.indexOf("## Source Files Without Test Coverage");
    expect(table).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(table);
    expect(lists).toBeGreaterThan(note);
    expect(md).toContain("does not show that a test uses the file");
  });

  test("a test in the same or a nested namespace needs no `using`, so it does not count", async () => {
    const { json } = await coverage(
      repo({
        "src/Core/Core.csproj": CS["src/Core/Core.csproj"],
        "src/Core/A.cs": CS["src/Core/A.cs"],
        "src/Core/B.cs": CS["src/Core/B.cs"],
        "tests/SameTests.cs": "namespace Demo.Core;\npublic class SameTests { A a; }\n",
        "tests/NestedTests.cs": "namespace Demo.Core.Tests;\npublic class NestedTests { B b; }\n",
      }),
    );
    // Both files are tests, so an empty tested list is a real miss and not a missing test.
    expect(json.metadata.totalTestFiles).toBe(2);
    expect(json.testedFiles).toEqual([]);
    expect(json.untestedFiles).toEqual(["src/Core/A.cs", "src/Core/B.cs"]);
    expect(json.metadata.coverageCaveat).toContain("too high or too low");
  });

  test("the note stands alone between the table and the rule when no policy is loaded", async () => {
    const { md } = await coverage(repo(CS));
    const row = "| Coverage (raw, direct-import) | **100.0%** |";
    expect(md).toContain(`${row}\n\n> ${NAMESPACE_IMPORT_COVERAGE_CAVEAT}\n\n---\n`);
  });

  test("with a policy the note follows the table and comes before the policy text", async () => {
    const policy = JSON.stringify({
      categories: {
        gen: { label: "Generated", rationale: "Made by a tool.", exactPaths: ["src/Core/B.cs"] },
      },
    });
    const { md } = await coverage(
      repo({ ...CS, "docs/architecture/coverage-policy.json": policy }),
    );
    const effective = md.indexOf("| Coverage (effective, active code only) |");
    const note = md.indexOf(`> ${NAMESPACE_IMPORT_COVERAGE_CAVEAT}`);
    const policyText = md.indexOf("The **effective** figure excludes");
    const breakdown = md.indexOf("### Untested-file breakdown by category");
    expect(effective).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(effective);
    expect(policyText).toBeGreaterThan(note);
    expect(breakdown).toBeGreaterThan(policyText);
    expect(md.slice(effective, note)).toMatch(/\|\n\n$/);
  });

  test("a Rust report keeps its output: no basis key and no caveat", async () => {
    const { md, json } = await coverage(
      repo({
        "Cargo.toml": '[package]\nname = "demo"\nversion = "0.1.0"\n',
        "src/lib.rs": "pub fn a() {}\n",
        "tests/t.rs": "fn main() {}\n",
      }),
    );
    expect(json.metadata.totalSourceFiles).toBeGreaterThan(0);
    expect(Object.keys(json.metadata)).not.toContain("coverageBasis");
    expect(Object.keys(json.metadata)).not.toContain("coverageCaveat");
    expect(md).not.toContain("namespace import");
  });

  test("a TypeScript report keeps its output: no basis key and no caveat", async () => {
    const { md, json } = await coverage(repo(TS));
    expect(Object.keys(json.metadata)).not.toContain("coverageBasis");
    expect(Object.keys(json.metadata)).not.toContain("coverageCaveat");
    expect(md).not.toContain("namespace import");
  });

  test("a Python report keeps its output: no basis key and no caveat", async () => {
    const { md, json } = await coverage(
      repo({
        "pkg/__init__.py": "",
        "pkg/a.py": "x = 1\n",
        "tests/test_a.py": "from pkg.a import x\n",
      }),
    );
    expect(Object.keys(json.metadata)).not.toContain("coverageBasis");
    expect(md).not.toContain("namespace import");
  });
});
