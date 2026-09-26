/**
 * The graph of the map engine end to end, per language: the wiring of reader, resolver and roots.
 *
 * Ported from the architecture-docs skill: `test_graph_csharp.py`, `test_python_repo_end_to_end.py`
 * and the end-to-end part of `test_rust.py`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { detectLanguage, discover } from "../../src/map/discovery.ts";
import { buildGraph } from "../../src/map/graph.ts";
import { makeTempDir } from "./temp.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A new folder with the files `files`. */
function repo(files: Record<string, string>): string {
  const root = makeTempDir("map-e2e");
  made.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
}

const EXE_CSPROJ =
  '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <OutputType>Exe</OutputType>\n' +
  "    <TargetFramework>net9.0</TargetFramework>\n  </PropertyGroup>\n</Project>\n";
const LIB_CSPROJ =
  '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net9.0</TargetFramework>\n' +
  "  </PropertyGroup>\n</Project>\n";
const APP = {
  "src/App/App.csproj": EXE_CSPROJ,
  "src/App/Program.cs":
    "using System;\nusing ModelContextProtocol.Server;\nusing App.Tools;\n\nnamespace App;\n\n" +
    "internal static class Program\n{\n    public static async Task<int> Main(string[] args) => 0;\n}\n",
  "src/App/Tools/UiTools.cs": "namespace App.Tools;\n\npublic class UiTools { }\n",
};

describe("C#: build graph end to end", () => {
  test("a using becomes an edge; System is a builtin; a NuGet namespace is external", async () => {
    const program = (await buildGraph(repo(APP))).files.get("src/App/Program.cs");
    expect(program?.internal.map((d) => d.file)).toEqual(["src/App/Tools/UiTools.cs"]);
    expect(program?.nodeBuiltins).toEqual(["System"]);
    expect(program?.external).toEqual(["ModelContextProtocol.Server"]);
    expect(program?.broken).toEqual([]);
  });

  test("public types are exports", async () => {
    expect((await buildGraph(repo(APP))).files.get("src/App/Tools/UiTools.cs")?.exports).toEqual([
      "UiTools",
    ]);
  });

  test("a namespace split across files gives an edge to every file", async () => {
    const g = await buildGraph(
      repo({
        "src/App/App.csproj": EXE_CSPROJ,
        "src/App/Program.cs":
          "using App.Shared;\n\nnamespace App;\n\ninternal static class Program { public static int Main() => 0; }\n",
        "src/App/Shared/A.cs": "namespace App.Shared;\npublic class A { }\n",
        "src/App/Shared/B.cs": "namespace App.Shared;\npublic class B { }\n",
      }),
    );
    expect(
      g.files
        .get("src/App/Program.cs")
        ?.internal.map((d) => d.file)
        .sort(),
    ).toEqual(["src/App/Shared/A.cs", "src/App/Shared/B.cs"]);
  });

  test("a file gets no edge to itself through its own namespace", async () => {
    const g = await buildGraph(
      repo({
        "src/App/App.csproj": EXE_CSPROJ,
        "src/App/Program.cs":
          "using App.Shared;\n\nnamespace App.Shared;\n\ninternal static class Program { public static int Main() => 0; }\n",
        "src/App/Other.cs": "namespace App.Shared;\npublic class Other { }\n",
      }),
    );
    expect(g.files.get("src/App/Program.cs")?.internal.map((d) => d.file)).toEqual([
      "src/App/Other.cs",
    ]);
  });

  test("the Main file of an Exe project is the root", async () => {
    expect((await buildGraph(repo(APP))).roots).toEqual(["src/App/Program.cs"]);
  });

  test("a library-only repo has no root and says so, naming no TypeScript", async () => {
    const g = await buildGraph(
      repo({
        "src/Lib/Lib.csproj": LIB_CSPROJ,
        "src/Lib/Thing.cs": "namespace Lib;\npublic class Thing { }\n",
      }),
    );
    expect(g.roots).toEqual([]);
    expect(g.warnings.some((w) => w.includes("entry-point"))).toBe(true);
    expect(g.warnings.some((w) => w.includes("TypeScript"))).toBe(false);
  });

  test("a Main is found with no csproj at all", async () => {
    const g = await buildGraph(
      repo({
        "Program.cs": "namespace X;\ninternal static class Program { static void Main() { } }\n",
      }),
    );
    expect(g.roots).toEqual(["Program.cs"]);
  });

  test("generated obj output never reaches the graph", async () => {
    const g = await buildGraph(
      repo({
        ...APP,
        "src/App/obj/Debug/net9.0/App.GlobalUsings.g.cs": "global using System.Linq;\n",
      }),
    );
    expect([...g.files.keys()].some((p) => p.includes("obj/"))).toBe(false);
  });

  test("an empty repo warns that nothing was scanned", async () => {
    const g = await buildGraph(repo({ "README.md": "nothing to scan\n" }));
    expect(g.warnings.some((w) => w.includes("nothing was scanned"))).toBe(true);
  });
});

describe("Python: build graph end to end", () => {
  test("a Python repo is detected; a TypeScript repo with a .py file stays TypeScript", () => {
    expect(
      detectLanguage(
        repo({
          "server.py": "from remember.system import S\n",
          "remember/__init__.py": "",
          "remember/system.py": "class S:\n    pass\n",
        }),
      ),
    ).toBe("python");
    const ts = repo({ "src/a.ts": "export const a = 1;\n", "scripts/helper.py": "x = 1\n" });
    expect(detectLanguage(ts)).toBe("typescript");
    expect(new Set(discover(ts).map((f) => f.path))).toEqual(new Set(["src/a.ts"]));
  });

  test("a Python repo builds a real dependency graph", async () => {
    const g = await buildGraph(
      repo({
        "server.py": "from remember.system import RememberSystem\nimport os\nimport numpy\n",
        "remember/__init__.py": "",
        "remember/system.py": "from .types import Thing\n\nclass RememberSystem:\n    pass\n",
        "remember/types.py": "class Thing:\n    pass\n",
      }),
    );
    expect(new Set(g.files.keys())).toEqual(
      new Set(["server.py", "remember/__init__.py", "remember/system.py", "remember/types.py"]),
    );
    const server = g.files.get("server.py");
    expect(server?.internal.map((d) => d.file)).toEqual(["remember/system.py"]);
    expect(server?.external).toContain("numpy");
    expect(server?.nodeBuiltins).toContain("os");
    const system = g.files.get("remember/system.py");
    expect(system?.internal.map((d) => d.file)).toEqual(["remember/types.py"]);
    expect(system?.exports).toEqual(["RememberSystem"]);
  });

  test("a broken relative import is reported", async () => {
    const g = await buildGraph(
      repo({ "pkg/__init__.py": "", "pkg/a.py": "from .nonexistent import thing\n" }),
    );
    expect(g.files.get("pkg/a.py")?.broken).toEqual([".nonexistent"]);
  });

  test("the conventional server module is the root", async () => {
    const g = await buildGraph(repo({ "server.py": "import os\n", "remember/__init__.py": "" }));
    expect(g.roots).toEqual(["server.py"]);
    expect(g.warnings.some((w) => w.includes("could not determine any entry-point roots"))).toBe(
      false,
    );
  });

  test("a pyproject.toml script wins over the fallback", async () => {
    const g = await buildGraph(
      repo({
        "pyproject.toml": '[project]\nname = "x"\n\n[project.scripts]\nrun = "pkg.cli:main"\n',
        "server.py": "import os\n",
        "pkg/__init__.py": "",
        "pkg/cli.py": "def main():\n    pass\n",
      }),
    );
    expect(g.roots).toEqual(["pkg/cli.py"]);
  });
});

describe("Rust: build graph end to end", () => {
  const CRATE = {
    "Cargo.toml": '[package]\nname = "demo"\n',
    "src/lib.rs": "pub mod engine;\npub mod util;\n",
    "src/engine.rs": "use crate::util::helper;\npub fn run() { helper(); }\n",
    "src/util.rs": "pub fn helper() {}\n",
    "src/stray.rs": "pub fn nobody_calls_me() {}\n",
  };

  test("a Rust repo is detected and scanned", () => {
    const root = repo(CRATE);
    expect(detectLanguage(root)).toBe("rust");
    expect(new Set(discover(root).map((f) => f.path))).toEqual(
      new Set(["src/lib.rs", "src/engine.rs", "src/util.rs", "src/stray.rs"]),
    );
  });

  test("mod declarations make modules reachable; an undeclared module is an orphan", async () => {
    const g = await buildGraph(repo(CRATE));
    expect(g.language).toBe("rust");
    expect(g.roots).toContain("src/lib.rs");
    expect(g.files.get("src/engine.rs")?.disposition).toBe("reachable");
    expect(g.files.get("src/util.rs")?.disposition).toBe("reachable");
    expect(g.files.get("src/stray.rs")?.disposition).toBe("orphan");
  });

  test("a use edge is recorded, and public items are exports", async () => {
    const g = await buildGraph(repo(CRATE));
    expect(g.files.get("src/engine.rs")?.internal.map((d) => d.file)).toContain("src/util.rs");
    expect(g.files.get("src/util.rs")?.exports).toEqual(["helper"]);
  });

  test("both crate roots are entry points", async () => {
    const g = await buildGraph(
      repo({
        "src/lib.rs": "pub mod a;\n",
        "src/main.rs": "pub mod b;\nfn main() {}\n",
        "src/a.rs": "pub fn a() {}\n",
        "src/b.rs": "pub fn b() {}\n",
      }),
    );
    expect(new Set(g.roots)).toEqual(new Set(["src/lib.rs", "src/main.rs"]));
    expect(g.files.get("src/a.rs")?.disposition).toBe("reachable");
    expect(g.files.get("src/b.rs")?.disposition).toBe("reachable");
  });
});
