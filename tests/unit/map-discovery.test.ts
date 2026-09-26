/**
 * Discovery of the map engine: the area and disposition rules, the language detection, the file
 * census and its reparse-point guard.
 *
 * Ported from the architecture-docs skill: `test_discovery.py`, `test_discovery_csharp.py`,
 * `test_discovery_reparse_points.py` and `test_discovery_unsupported_language.py`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  classifyArea,
  countLanguages,
  detectLanguage,
  discover,
  dispositionForArea,
  UnsupportedRepoLanguage,
} from "../../src/map/discovery.ts";
import { makeTempDir } from "./temp.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A new empty folder. */
function tmp(): string {
  const dir = makeTempDir("map-disc");
  made.push(dir);
  return dir;
}

/** Writes `text` to `root/rel`, and makes the parent folders. */
function write(root: string, rel: string, text = ""): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}

/** Runs git in `root`; throws on a non-zero exit. */
function git(root: string, ...args: string[]): void {
  const r = Bun.spawnSync(["git", ...args], { cwd: root });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
}

/** Makes `root` a git repository with a local identity. */
function gitRepo(root: string): string {
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  return root;
}

const paths = (root: string): Set<string> => new Set(discover(root).map((f) => f.path));
const WINDOWS = process.platform === "win32";

describe("classifyArea and dispositionForArea", () => {
  test("classify by path convention", () => {
    expect(classifyArea("src/index.ts")).toBe("src");
    expect(dispositionForArea(classifyArea("src/index.ts"), { reachable: true })).toBe("reachable");
    expect(dispositionForArea(classifyArea("tests/unit/foo.test.ts"))).toBe("test");
    expect(dispositionForArea(classifyArea("tools/gen/run.ts"))).toBe("tool");
    expect(dispositionForArea(classifyArea("vitest.config.ts"))).toBe("config");
    expect(dispositionForArea(classifyArea("benchmarks/speed.ts"))).toBe("bench");
    expect(dispositionForArea(classifyArea("examples/demo.ts"))).toBe("example");
  });

  test("patterns match at any depth; tools beats config", () => {
    expect(classifyArea("packages/core/tests/x.test.ts")).toBe("tests");
    expect(classifyArea("tools/x.config.ts")).toBe("tools");
    expect(classifyArea("packages/core/tools/gen.ts")).toBe("tools");
  });

  test("a file named as a test is a test even with a tools or scripts segment", () => {
    expect(classifyArea("tests/tools/plan-doc-audit.test.ts")).toBe("tests");
    expect(classifyArea("scripts/lib/parse.spec.ts")).toBe("tests");
    expect(classifyArea("tools/gen.test.ts")).toBe("tests");
    expect(classifyArea("tests/tools/gen.ts")).toBe("tools");
    expect(classifyArea("tools/x.config.ts")).toBe("tools");
    expect(classifyArea("scripts/build.mjs")).toBe("tools");
    expect(classifyArea("tests/vitest.config.ts")).toBe("config");
  });

  test("src/tools is source, a top-level tools/ is meta-tooling", () => {
    expect(classifyArea("src/tools/search.ts")).toBe("src");
    expect(classifyArea("src/tools/nested/deep.ts")).toBe("src");
    expect(classifyArea("tools/bundle.mjs")).toBe("tools");
    expect(classifyArea("src/tools/search.test.ts")).toBe("tests");
  });

  test("root-level config, the src fallback and docs", () => {
    expect(classifyArea("tsup.config.ts")).toBe("config");
    expect(classifyArea("vitest.config.js")).toBe("config");
    expect(classifyArea("src/index.ts")).toBe("src");
    expect(classifyArea("README-ish/x.ts")).toBe("src");
    expect(dispositionForArea("docs")).toBe("example");
    expect(classifyArea("docs/README.ts")).toBe("docs");
  });

  test("config with a hyphenated middle segment, on every recognised extension", () => {
    expect(classifyArea("webpack.config.dev-mode.ts")).toBe("config");
    expect(classifyArea("my.config.dev-special.ts")).toBe("config");
    expect(classifyArea("vite.config.mjs")).toBe("config");
    expect(classifyArea("jest.config.cjs")).toBe("config");
    expect(classifyArea("vite.config.jsx")).toBe("config");
    expect(classifyArea("vite.config.tsx")).toBe("config");
    expect(classifyArea("webpack.config.dev-mode.mjs")).toBe("config");
  });

  test("dispositionForArea: fixed areas and the src variants", () => {
    expect(dispositionForArea("src", { reachable: true })).toBe("reachable");
    expect(dispositionForArea("tests")).toBe("test");
    expect(dispositionForArea("tools")).toBe("tool");
    expect(dispositionForArea("config")).toBe("config");
    expect(dispositionForArea("benchmarks")).toBe("bench");
    expect(dispositionForArea("examples")).toBe("example");
    expect(dispositionForArea("docs")).toBe("example");
    expect(dispositionForArea("src", { isRoot: true })).toBe("build-entry");
    expect(dispositionForArea("src", { testReachable: true })).toBe("test-only");
    expect(dispositionForArea("src")).toBe("orphan");
  });

  test("every area maps to a known disposition", () => {
    const areas = new Set(["src", "tests", "tools", "config", "benchmarks", "examples", "docs"]);
    const dispositions = new Set([
      "build-entry",
      "reachable",
      "test-only",
      "orphan",
      "test",
      "tool",
      "config",
      "bench",
      "example",
    ]);
    for (const p of [
      "src/index.ts",
      "tests/unit.test.ts",
      "tools/gen.ts",
      "vitest.config.ts",
      "benchmarks/speed.ts",
      "examples/demo.ts",
      "docs/README.ts",
      "src/tools/nested.ts",
      "webpack.config.dev-mode.ts",
    ]) {
      const area = classifyArea(p);
      expect(areas.has(area)).toBe(true);
      expect(dispositions.has(dispositionForArea(area))).toBe(true);
    }
  });

  test("bench/ and the .bench. suffix are benchmarks; scripts/ is tooling", () => {
    expect(classifyArea("bench/sanity.bench.ts")).toBe("benchmarks");
    expect(classifyArea("bench/fixtures/schwarzschild.ts")).toBe("benchmarks");
    expect(dispositionForArea(classifyArea("bench/sanity.bench.ts"))).toBe("bench");
    expect(classifyArea("packages/core/perf/parse.bench.ts")).toBe("benchmarks");
    expect(classifyArea("scripts/emit-catalog-json.mjs")).toBe("tools");
    expect(dispositionForArea(classifyArea("scripts/emit-catalog-json.mjs"))).toBe("tool");
    expect(classifyArea("src/bench/harness.ts")).toBe("src");
    expect(classifyArea("src/scripts/codegen.ts")).toBe("src");
    expect(classifyArea("tests/bench/runner.test.ts")).toBe("tests");
  });
});

describe("discover", () => {
  test("walks the repo and skips noise", () => {
    const root = tmp();
    write(root, "src/a.ts", "export const a = 1;\n");
    write(root, "node_modules/pkg/b.ts", "x");
    write(root, ".git/c.ts", "x");
    expect(paths(root)).toEqual(new Set(["src/a.ts"]));
    const [f] = discover(root).filter((x) => x.path === "src/a.ts");
    expect(f?.area).toBe("src");
    expect(f?.disposition).toBe("reachable");
  });

  test("records the line count and POSIX paths", () => {
    const root = tmp();
    write(root, "src/deep/b.ts", "a\nb\nc\n");
    expect(discover(root)).toEqual([
      { path: "src/deep/b.ts", area: "src", disposition: "reachable", loc: 3 },
    ]);
  });

  test("nested tool files, src/tools, docs and tools/tests areas", () => {
    let root = tmp();
    write(root, "packages/core/tools/gen.ts", "export const gen = 1;\n");
    expect(discover(root).map((f) => [f.path, f.area])).toEqual([
      ["packages/core/tools/gen.ts", "tools"],
    ]);
    root = tmp();
    write(root, "src/tools/search.ts", "export const search = 1;\n");
    expect(discover(root).map((f) => [f.path, f.area])).toEqual([["src/tools/search.ts", "src"]]);
    root = tmp();
    write(root, "docs/architecture.ts", "export const docs = 1;\n");
    expect(discover(root).map((f) => [f.area, f.disposition])).toEqual([["docs", "example"]]);
    for (const rel of ["tools/tests/gen.ts", "tests/tools/gen.ts"]) {
      root = tmp();
      write(root, rel, "export const gen = 1;\n");
      expect(discover(root).map((f) => [f.area, f.disposition])).toEqual([["tools", "tool"]]);
    }
  });

  test("a committed bundle is skipped", () => {
    const root = tmp();
    write(root, "src/server.ts", "export const s = 1;\n");
    write(root, "bundle/index.mjs", "// generated\n".repeat(5000));
    expect(discover(root).map((f) => f.path)).toEqual(["src/server.ts"]);
  });

  test("a gitignored source file is not discovered", () => {
    const root = gitRepo(tmp());
    write(root, "src/a.ts", "export const A = 1;\n");
    write(root, "scratch/junk.ts", "export const J = 1;\n");
    write(root, ".gitignore", "scratch/\n");
    git(root, "add", "-A");
    const found = paths(root);
    expect(found.has("src/a.ts")).toBe(true);
    expect(found.has("scratch/junk.ts")).toBe(false);
  });

  test("an untracked file is not discovered", () => {
    const root = gitRepo(tmp());
    write(root, "src/a.ts", "export const A = 1;\n");
    git(root, "add", "-A");
    write(root, "src/stray.ts", "export const S = 1;\n");
    const found = paths(root);
    expect(found.has("src/a.ts")).toBe(true);
    expect(found.has("src/stray.ts")).toBe(false);
  });

  test("a folder that is not a git repository is walked", () => {
    const root = tmp();
    write(root, "src/a.ts", "export const A = 1;\n");
    expect(paths(root).has("src/a.ts")).toBe(true);
  });
});

describe("C# discovery", () => {
  test("a C# repo is detected as C#", () => {
    const root = tmp();
    write(root, "src/App/Program.cs", "namespace App;\n");
    expect(detectLanguage(root)).toBe("csharp");
  });

  test("TypeScript and Python win a tie over C#", () => {
    let root = tmp();
    write(root, "src/index.ts", "export const x = 1;\n");
    write(root, "src/App/Program.cs", "namespace App;\n");
    expect(detectLanguage(root)).toBe("typescript");
    root = tmp();
    write(root, "pkg/mod.py", "x = 1\n");
    write(root, "src/App/Program.cs", "namespace App;\n");
    expect(detectLanguage(root)).toBe("python");
  });

  test("discover walks .cs files, and skips obj/ and bin/", () => {
    let root = tmp();
    write(root, "src/App/Program.cs", "namespace App;\n");
    write(root, "tests/AppTests/Tests.cs", "namespace App.Tests;\n");
    expect(paths(root)).toEqual(new Set(["src/App/Program.cs", "tests/AppTests/Tests.cs"]));
    root = tmp();
    write(root, "src/App/Program.cs", "namespace App;\n");
    write(root, "src/App/obj/Debug/net9.0/App.AssemblyInfo.cs", "// generated\n");
    write(root, "src/App/obj/Debug/net9.0/App.GlobalUsings.g.cs", "global using System;\n");
    write(root, "src/App/bin/Debug/net9.0/Leftover.cs", "// stale build output\n");
    expect(paths(root)).toEqual(new Set(["src/App/Program.cs"]));
  });
});

describe("countLanguages: a reparse point is not walked into", () => {
  /** Makes a Windows junction at `link` to `target`. */
  const junction = (link: string, target: string): boolean =>
    Bun.spawnSync(["cmd", "/c", "mklink", "/J", link, target]).exitCode === 0;

  test.skipIf(!WINDOWS)("a junction cycle does not inflate the counts", () => {
    const repo = join(tmp(), "repo");
    write(repo, "src/a.ts", "export const a = 1;\n");
    expect(junction(join(repo, "src", "loop"), repo)).toBe(true);
    expect(countLanguages(repo)).toEqual({ typescript: 1 });
  });

  test.skipIf(!WINDOWS)("a junction out of the tree does not import foreign files", () => {
    const base = tmp();
    const repo = join(base, "repo");
    write(repo, "src/a.ts", "export const a = 1;\n");
    for (let i = 0; i < 5; i++) write(base, `other/f${i}.ts`, "export const x = 1;\n");
    expect(junction(join(repo, "src", "vendor"), join(base, "other"))).toBe(true);
    expect(countLanguages(repo)).toEqual({ typescript: 1 });
  });

  test.skipIf(WINDOWS)("a symlink cycle does not inflate the counts", () => {
    const repo = join(tmp(), "repo");
    write(repo, "src/a.ts", "export const a = 1;\n");
    symlinkSync(repo, join(repo, "src", "loop"), "dir");
    expect(countLanguages(repo)).toEqual({ typescript: 1 });
  });

  test("plain nested folders are still walked (positive control)", () => {
    const repo = join(tmp(), "repo");
    write(repo, "src/a.ts", "export const a = 1;\n");
    write(repo, "src/deep/b.ts", "export const b = 2;\n");
    write(repo, "src/deep/deeper/c.ts", "export const c = 3;\n");
    expect(countLanguages(repo)).toEqual({ typescript: 3 });
  });
});

describe("detectLanguage: an unsupported language refuses", () => {
  /** A repo that is really Rust, with optional noise. */
  function rustRepo(root: string, opts: { strayJs?: boolean; rustdoc?: boolean } = {}): string {
    for (let i = 0; i < 12; i++) write(root, `src/m${i}.rs`, `pub fn f${i}() {}\n`);
    if (opts.strayJs) write(root, "src/static/app.js", "var x = 1;\n");
    if (opts.rustdoc) {
      for (let i = 0; i < 20; i++) {
        write(root, `target/doc/crate/sidebar-items${i}.js`, "window.SIDEBAR={};\n");
      }
    }
    return root;
  }

  test("target/ is skipped", () => {
    const root = tmp();
    write(root, "src/app.ts", "export const a = 1;\n");
    for (let i = 0; i < 20; i++) {
      write(root, `target/doc/crate/sidebar-items${i}.js`, "window.SIDEBAR={};\n");
    }
    expect(paths(root)).toEqual(new Set(["src/app.ts"]));
  });

  test("a Rust repo with rustdoc output and a stray .js is Rust", () => {
    const root = rustRepo(tmp(), { strayJs: true, rustdoc: true });
    expect(detectLanguage(root)).toBe("rust");
    expect(paths(root)).toEqual(new Set(Array.from({ length: 12 }, (_, i) => `src/m${i}.rs`)));
  });

  test("a genuinely unsupported language refuses, naming the language and the count", () => {
    const root = tmp();
    for (let i = 0; i < 9; i++) write(root, `cmd/m${i}.go`, "package main\n");
    write(root, "web.js", "var x = 1;\n");
    let error: unknown;
    try {
      detectLanguage(root);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(UnsupportedRepoLanguage);
    const message = String((error as Error).message);
    expect(message.toLowerCase()).toContain("go");
    expect(message).toContain("9");
  });

  test("a TypeScript repo with incidental .rs files still scans", () => {
    const root = tmp();
    for (let i = 0; i < 10; i++) write(root, `src/m${i}.ts`, "export const a = 1;\n");
    write(root, "native/lib.rs", "pub fn f() {}\n");
    expect(detectLanguage(root)).toBe("typescript");
    expect(discover(root).length).toBe(10);
  });

  test("Python and C# repos are unaffected", () => {
    const base = tmp();
    write(base, "py/src/a.py", "def f(): ...\n");
    expect(detectLanguage(join(base, "py"))).toBe("python");
    write(base, "cs/src/A.cs", "public class A {}\n");
    expect(detectLanguage(join(base, "cs"))).toBe("csharp");
  });

  test("an empty repo keeps the historical default", () => {
    const root = tmp();
    write(root, "docs/README.md", "# hi\n");
    expect(detectLanguage(root)).toBe("typescript");
  });
});
