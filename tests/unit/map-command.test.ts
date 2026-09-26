/**
 * `repo-tools map` and its deprecated alias `repo-tools depgraph` (design decisions D8 and D9):
 * the reports it writes, the flags it refuses, the input files it reads, and its gates.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { main } from "../../src/cli.ts";
import { makeTempDir } from "./temp.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A new folder with the files `files`, under a parent folder of its own. */
function repo(files: Record<string, string>): string {
  const base = makeTempDir("map-cmd");
  made.push(base);
  const root = join(base, "repo");
  mkdirSync(root, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
}

/** Runs the CLI with captured output streams. */
async function cli(argv: string[]) {
  let out = "";
  let err = "";
  const code = await main(argv, {
    stdout: (s) => {
      out += s;
    },
    stderr: (s) => {
      err += s;
    },
  });
  return { code, out, err };
}

const TS = {
  "package.json": '{"name": "demo", "version": "1.0.0", "main": "src/index.ts"}\n',
  "src/index.ts": 'export { a } from "./a.js";\n',
  "src/a.ts": "export function a() { return 1; }\n",
  "tests/a.test.ts": 'import { a } from "../src/a.js";\nexport const t = a;\n',
};

const REPORTS = [
  "dependency-graph.json",
  "file-inventory.json",
  "duplicate-symbols.json",
  "unused-analysis.json",
  "dependency-layers.json",
  "DEPENDENCY_GRAPH.md",
  "dependency-graph.yaml",
  "dependency-summary.compact.json",
  "FILE_INVENTORY.md",
  "duplicate-symbols.md",
  "unused-analysis.md",
  "TEST_COVERAGE.md",
  "test-coverage.json",
  "package-export-surfaces.json",
];

const out = (root: string, name: string): string => join(root, "docs/architecture", name);

describe("repo-tools map", () => {
  test("writes every report into docs/architecture and exits 0", async () => {
    const root = repo(TS);
    const r = await cli(["map", root]);
    expect(r.code).toBe(0);
    for (const name of REPORTS) expect(existsSync(out(root, name))).toBe(true);
    expect(r.out).toContain("Written: docs/architecture/dependency-graph.json");
    expect(r.out).toContain("census passed");
    expect(readFileSync(out(root, "DEPENDENCY_GRAPH.md"), "utf8")).toContain(
      "Regenerate with `repo-tools map`.",
    );
  });

  test("a scan-scope flag of 1.x exits 1 and writes nothing (D8)", async () => {
    const root = repo(TS);
    const r = await cli(["map", root, "--src=lib"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("flag --src has no effect in 2.0.0");
    expect(existsSync(join(root, "docs"))).toBe(false);
  });

  test("the depgraph alias warns about the flag, prints the deprecation line and runs (D8)", async () => {
    const root = repo(TS);
    const r = await cli(["depgraph", root, "--all", "--src=lib"]);
    expect(r.code).toBe(0);
    expect(r.err).toContain("repo-tools depgraph is deprecated");
    expect(r.err).toContain("Warning: flag --all has no effect in 2.0.0");
    expect(r.err).toContain("Warning: flag --src has no effect in 2.0.0");
    expect(existsSync(out(root, "dependency-layers.json"))).toBe(true);
  });

  test("the alias keeps the value rules of an ignored flag", async () => {
    const root = repo(TS);
    expect((await cli(["depgraph", root, "--all=yes"])).code).toBe(1);
    expect((await cli(["depgraph", root, "--src"])).code).toBe(1);
  });

  test("a root-relative ../ --out writes outside the root (D9)", async () => {
    const root = repo(TS);
    const r = await cli(["map", root, "--out=../reports"]);
    expect(r.code).toBe(0);
    expect(existsSync(join(root, "..", "reports", "dependency-graph.json"))).toBe(true);
    expect(existsSync(join(root, "docs"))).toBe(false);
  });

  test("an input file in the output folder is not read (D9)", async () => {
    const allow = JSON.stringify({
      entries: [{ names: ["a"], filesGlob: ["src/**"], reason: "accepted" }],
    });
    const dup = { ...TS, "src/b.ts": "export function a() { return 2; }\n" };
    const inOut = repo({ ...dup, "../reports/duplicate-allowlist.json": allow });
    expect((await cli(["map", inOut, "--out=../reports"])).code).toBe(0);
    let data = JSON.parse(
      readFileSync(join(inOut, "..", "reports", "duplicate-symbols.json"), "utf8"),
    );
    expect(data.runtime[0].tag).toBe("TRUE_DUPLICATE");

    const inDocs = repo({ ...dup, "docs/architecture/duplicate-allowlist.json": allow });
    expect((await cli(["map", inDocs, "--out=../reports"])).code).toBe(0);
    data = JSON.parse(
      readFileSync(join(inDocs, "..", "reports", "duplicate-symbols.json"), "utf8"),
    );
    expect(data.runtime[0].tag).toBe("ALLOWLISTED");
  });

  test("a repository with no source file exits 1 and makes no output folder", async () => {
    const root = repo({ "README.md": "nothing\n" });
    const r = await cli(["map", root]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("no source file found");
    expect(existsSync(join(root, "docs"))).toBe(false);
  });

  test("a language the engine cannot read exits 1 and makes no output folder", async () => {
    const root = repo({ "main.go": "package main\n", "util.go": "package main\n" });
    const r = await cli(["map", root]);
    expect(r.code).toBe(1);
    expect(existsSync(join(root, "docs"))).toBe(false);
  });

  test("standard error shows the root as <root>", async () => {
    const root = repo({ "README.md": "nothing\n" });
    const r = await cli(["map", root, "--config=missing.json"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("<root>");
    expect(r.err).not.toContain(root);
  });
});

describe("repo-tools map: gates", () => {
  const ORPHAN = { ...TS, "src/lonely.ts": "export const lonely = 1;\n" };

  test("an orphan warns; with --strict-orphans it exits 1 after the reports", async () => {
    let r = await cli(["map", repo(ORPHAN)]);
    expect(r.code).toBe(0);
    expect(r.err).toContain("src/lonely.ts");
    const root = repo(ORPHAN);
    r = await cli(["map", root, "--strict-orphans"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("census FAILED (--strict-orphans)");
    expect(existsSync(out(root, "dependency-graph.json"))).toBe(true);
  });

  test("--check-census passes on a fresh inventory and fails after a new file", async () => {
    const root = repo(TS);
    expect((await cli(["map", root])).code).toBe(0);
    let r = await cli(["map", root, "--check-census"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("file-census check passed");
    writeFileSync(join(root, "src", "new.ts"), "export const n = 1;\n");
    r = await cli(["map", root, "--check-census"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("+ src/new.ts");
  });

  test("--write-duplicate-baseline then --check-duplicates passes; a new duplicate fails", async () => {
    const root = repo(TS);
    expect((await cli(["map", root])).code).toBe(0);
    let r = await cli(["map", root, "--write-duplicate-baseline"]);
    expect(r.code).toBe(0);
    expect(existsSync(out(root, "duplicate-baseline.json"))).toBe(true);
    r = await cli(["map", root, "--check-duplicates"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("duplicate check passed");
    writeFileSync(join(root, "src", "b.ts"), "export function a() { return 2; }\n");
    r = await cli(["map", root, "--check-duplicates"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("[runtime] a");
  });

  test("--check-duplicates on a Python repo says the gate is for TypeScript only", async () => {
    const root = repo({ "pkg/__init__.py": "", "pkg/a.py": "x = 1\n" });
    expect((await cli(["map", root])).code).toBe(0);
    const r = await cli(["map", root, "--write-duplicate-baseline"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("TypeScript only");
  });
});

describe("repo-tools map --api-surface (D5)", () => {
  test("a missing entry file exits 1 before any write", async () => {
    const root = repo(TS);
    const r = await cli(["map", root, "--api-surface=api.json", "--api-entry=src/none.ts"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("the --api-entry file <root>/src/none.ts does not exist");
    expect(existsSync(join(root, "docs"))).toBe(false);
  });

  test("Python lists the surface names of the entry file, with the rule", async () => {
    const root = repo({ "pkg/__init__.py": '__all__ = ["A", "b"]\n', "pkg/a.py": "x = 1\n" });
    const r = await cli(["map", root, "--api-surface=api.json", "--api-entry=pkg/__init__.py"]);
    expect(r.code).toBe(0);
    const data = JSON.parse(readFileSync(join(root, "api.json"), "utf8"));
    expect(data.language).toBe("python");
    expect(data.symbols.map((s: { name: string }) => s.name)).toEqual(["A", "b"]);
    expect(data.note).toContain("__all__");
  });

  test("C# exits 1 with the reason, and writes nothing", async () => {
    const root = repo({
      "src/App/App.csproj": '<Project Sdk="Microsoft.NET.Sdk"></Project>\n',
      "src/App/A.cs": "namespace App;\npublic class A { }\n",
    });
    const r = await cli(["map", root, "--api-surface=api.json", "--api-entry=src/App/A.cs"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("--api-surface is not written for C#");
    expect(existsSync(join(root, "docs"))).toBe(false);
  });
});

describe("repo-tools map: config", () => {
  test("the section 'map' is read; 'map' and 'depgraph' together exit 1", async () => {
    let root = repo({ ...TS, "repo-tools.config.json": '{"map": {"out": "../mapped"}}\n' });
    expect((await cli(["map", root])).code).toBe(0);
    expect(existsSync(join(root, "..", "mapped", "dependency-graph.json"))).toBe(true);
    root = repo({
      ...TS,
      "repo-tools.config.json": '{"map": {"out": "a"}, "depgraph": {"out": "b"}}\n',
    });
    const r = await cli(["map", root]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("not both");
  });

  test("a 1.x scan-scope config key warns and the run continues", async () => {
    const root = repo({ ...TS, "repo-tools.config.json": '{"map": {"src": ["src"]}}\n' });
    const r = await cli(["map", root]);
    expect(r.code).toBe(0);
    expect(r.err).toContain("Warning: config key src:");
  });

  test("a C# repository gets a note, not a surface file", async () => {
    const root = repo({
      "src/App/App.csproj":
        '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup></Project>\n',
      "src/App/Program.cs":
        "namespace App;\ninternal static class Program { static void Main() { } }\n",
    });
    const r = await cli(["map", root]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("not written for C#");
    expect(existsSync(out(root, "package-export-surfaces.json"))).toBe(false);
  });
});
