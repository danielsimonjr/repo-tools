/**
 * The artifacts of the map engine end to end for C# and Rust, and the regression guards that
 * keep a TypeScript repo scanned as before.
 *
 * Ported from the architecture-docs skill: `test_csharp_repo_end_to_end.py`,
 * `test_unused_csharp.py` and `test_rust_unused_caveat.py`. The source tests that read a real
 * local repository are not ported; the side-1 parity run covers that repository. The Rust caveat
 * tests read the caveats from the written file, not from the private helper.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  emitDependencyGraph,
  emitFileInventory,
  emitUnusedAnalysis,
} from "../../src/map/artifacts.ts";
import { detectLanguage, discover } from "../../src/map/discovery.ts";
import { buildGraph } from "../../src/map/graph.ts";
import { makeTempDir } from "./temp.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A new folder with the files `files`. */
function repo(files: Record<string, string>): string {
  const root = makeTempDir("map-art-e2e");
  made.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
}

// biome-ignore lint/suspicious/noExplicitAny: the artifacts are untyped JSON.
type Json = any;

/** Builds the graph first, so the output folder is never scanned, then emits and reads back. */
async function emitted(
  root: string,
  emit: (g: Awaited<ReturnType<typeof buildGraph>>, out: string) => string,
): Promise<Json> {
  const graph = await buildGraph(root);
  const out = join(root, "_out");
  mkdirSync(out, { recursive: true });
  return JSON.parse(readFileSync(emit(graph, out), "utf8"));
}

const EXE_CSPROJ =
  '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n' +
  "    <OutputType>Exe</OutputType>\n    <TargetFramework>net9.0</TargetFramework>\n" +
  "  </PropertyGroup>\n</Project>\n";
const BARE_CSPROJ = '<Project Sdk="Microsoft.NET.Sdk"></Project>\n';
const MAIN_CS = "namespace App;\ninternal static class Program { static void Main() { } }\n";

describe("C#: the regression guards (adding C# changes nothing that worked)", () => {
  test("a TypeScript repo with a .cs file stays TypeScript", () => {
    const root = repo({
      "src/a.ts": "export const a = 1;\n",
      "src/App/Program.cs": "namespace App;\n",
    });
    expect(detectLanguage(root)).toBe("typescript");
  });

  test("a TypeScript repo does not scan .cs files", () => {
    const root = repo({
      "src/a.ts": "export const a = 1;\n",
      "vendor/App/Program.cs": "namespace App;\n",
    });
    expect(new Set(discover(root).map((f) => f.path))).toEqual(new Set(["src/a.ts"]));
  });

  test("a JavaScript repo keeps its bin folder (bin is skipped for C# only)", () => {
    const root = repo({
      "package.json": '{"bin": {"x": "bin/cli.js"}}\n',
      "bin/cli.js": "export const run = 1;\n",
    });
    expect(discover(root).map((f) => f.path)).toContain("bin/cli.js");
  });
});

describe("C#: the language-neutral file count", () => {
  test("statistics carry totalSourceFiles with the same value as totalTypeScriptFiles", async () => {
    const data = await emitted(
      repo({ "src/App/App.csproj": EXE_CSPROJ, "src/App/Program.cs": MAIN_CS }),
      (g, out) => emitDependencyGraph(g, out),
    );
    expect(data.statistics.totalSourceFiles).toBe(1);
    expect(data.statistics.totalTypeScriptFiles).toBe(1);
  });

  test("the neutral count is written for TypeScript too", async () => {
    const data = await emitted(
      repo({
        "package.json": '{"main": "src/index.ts"}\n',
        "src/index.ts": "export const a = 1;\n",
      }),
      (g, out) => emitDependencyGraph(g, out),
    );
    expect(data.statistics.totalSourceFiles).toBe(1);
  });
});

describe("C#: the .csproj is the package", () => {
  test("each file is attributed to its owning .csproj", async () => {
    const data = await emitted(
      repo({
        "src/App/App.csproj": EXE_CSPROJ,
        "src/App/Program.cs": MAIN_CS,
        "src/Core/Core.csproj": BARE_CSPROJ,
        "src/Core/Thing.cs": "namespace Core;\npublic class Thing { }\n",
      }),
      emitFileInventory,
    );
    const byPath = Object.fromEntries(data.files.map((f: Json) => [f.file, f.package]));
    expect(byPath["src/App/Program.cs"]).toBe("App");
    expect(byPath["src/Core/Thing.cs"]).toBe("Core");
  });

  test("a nested project wins over its parent (longest prefix)", async () => {
    const data = await emitted(
      repo({
        "src/Outer/Outer.csproj": BARE_CSPROJ,
        "src/Outer/A.cs": "namespace Outer;\npublic class A { }\n",
        "src/Outer/Inner/Inner.csproj": BARE_CSPROJ,
        "src/Outer/Inner/B.cs": "namespace Inner;\npublic class B { }\n",
      }),
      emitFileInventory,
    );
    const byPath = Object.fromEntries(data.files.map((f: Json) => [f.file, f.package]));
    expect(byPath["src/Outer/A.cs"]).toBe("Outer");
    expect(byPath["src/Outer/Inner/B.cs"]).toBe("Inner");
  });

  test("a C# repo with no project file says so, and uses (root)", async () => {
    const data = await emitted(repo({ "Program.cs": MAIN_CS }), emitFileInventory);
    expect(data.files[0].package).toBe("(root)");
    expect(data.warnings.some((w: string) => w.includes("csproj"))).toBe(true);
  });
});

describe("C#: unused-analysis uses cross-file identifiers, not import names", () => {
  /** An interface in one file, its class in a second, its user in a third, and one dead type. */
  const SURFACE = {
    "src/App/App.csproj": EXE_CSPROJ,
    "src/App/Program.cs":
      "using App.Hosting;\n\nnamespace App;\n\ninternal static class Program\n{\n" +
      "    public static int Main()\n    {\n        ISurface s = new Surface();\n" +
      "        return 0;\n    }\n}\n",
    "src/App/Hosting/ISurface.cs": "namespace App.Hosting;\n\npublic interface ISurface { }\n",
    "src/App/Hosting/Surface.cs":
      "namespace App.Hosting;\n\npublic sealed class Surface : ISurface { }\n",
    "src/App/Hosting/Dead.cs": "namespace App.Hosting;\n\npublic class Dead { }\n",
  };

  test("a type that another file uses is not flagged", async () => {
    const flagged = (await emitted(repo(SURFACE), emitUnusedAnalysis)).unreferencedAnywhere;
    expect(flagged["src/App/Hosting/ISurface.cs"]).toBeUndefined();
    expect(flagged["src/App/Hosting/Surface.cs"]).toBeUndefined();
  });

  test("a type that nothing uses IS still flagged", async () => {
    expect((await emitted(repo(SURFACE), emitUnusedAnalysis)).unreferencedAnywhere).toEqual({
      "src/App/Hosting/Dead.cs": ["Dead"],
    });
  });

  test("the summary count matches the listed buckets", async () => {
    const data = await emitted(repo(SURFACE), emitUnusedAnalysis);
    let listed = 0;
    for (const key of ["unreferencedAnywhere", "referencedInModule", "unclassifiedExports"]) {
      for (const names of Object.values(data[key]) as string[][]) listed += names.length;
    }
    expect(data.summary.unusedExportCount).toBe(listed);
  });

  test("the caveats disclose the cross-file text heuristic", async () => {
    const joined = (await emitted(repo(SURFACE), emitUnusedAnalysis)).caveats.join(" ");
    expect(joined).toContain("namespace");
    expect(joined).toContain("identifier");
  });

  test("a TypeScript report does not carry the C# caveat", async () => {
    const data = await emitted(
      repo({
        "package.json": '{"main": "src/index.ts"}\n',
        "src/index.ts": "export const go = 1;\n",
      }),
      emitUnusedAnalysis,
    );
    expect(data.caveats.join(" ")).not.toContain("names a namespace");
  });

  test("TypeScript still uses import names, not text matching", async () => {
    const data = await emitted(
      repo({
        "package.json": '{"main": "src/index.ts"}\n',
        "src/index.ts": "import { Used } from './m.js';\nexport const go = () => Used;\n",
        "src/m.ts": "export const Used = 1;\nexport const Dead = 2;\n",
      }),
      emitUnusedAnalysis,
    );
    expect(data.unreferencedAnywhere["src/m.ts"]).toEqual(["Dead"]);
  });
});

describe("Rust: a pub item with no in-crate user is public API", () => {
  test("a Rust report discloses the public-API limit", async () => {
    const root = repo({
      "src/lib.rs": "pub mod api;\n",
      "src/api.rs": "pub fn one() {}\npub fn two() {}\npub struct Cfg;\n",
    });
    expect((await buildGraph(root)).language).toBe("rust");
    const text = (await emitted(root, emitUnusedAnalysis)).caveats.join(" ").toLowerCase();
    expect(text.includes("public api") || text.includes("downstream")).toBe(true);
  });

  test("the disclosure is scoped to Rust", async () => {
    const root = repo({ "src/index.ts": "export const a = 1;\n" });
    expect((await buildGraph(root)).language).toBe("typescript");
    const text = (await emitted(root, emitUnusedAnalysis)).caveats.join(" ").toLowerCase();
    expect(text).not.toContain("downstream");
  });
});
