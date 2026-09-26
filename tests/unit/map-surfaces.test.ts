/**
 * package-export-surfaces.json on the map engine's graph (design decision D5): per package, the
 * public export names. TypeScript uses depgraph's public-surface rules through the adapter.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildGraph } from "../../src/map/graph.ts";
import { emitExportSurfaces } from "../../src/map/surfaces.ts";
import { makeTempDir } from "./temp.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A new folder with the files `files`. */
function repo(files: Record<string, string>): string {
  const root = makeTempDir("map-surfaces");
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

/** Writes the surfaces into `<root>/out` and reads them back. */
async function surfaces(root: string): Promise<Json> {
  const out = join(root, "out");
  mkdirSync(out, { recursive: true });
  const path = emitExportSurfaces(await buildGraph(root), root, out);
  if (path === null) throw new Error("no surface file was written");
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("emitExportSurfaces: TypeScript", () => {
  test("a chain of export * makes every file behind the root public", async () => {
    const data = await surfaces(
      repo({
        "package.json": '{"name": "demo", "main": "src/index.ts"}\n',
        "src/index.ts": 'export * from "./lib/b.js";\n',
        "src/lib/b.ts": 'export * from "./c.js";\nexport const fromB = 1;\n',
        "src/lib/c.ts": "export const deep = 1;\n",
        "src/lib/internal.ts": "export const hidden = 1;\n",
      }),
    );
    // Single-package mode groups by module key, as depgraph 1.x does.
    expect(data.surfaces).toEqual({ entry: [], lib: ["deep", "fromB"] });
  });

  test("a named re-export makes that one name public, and no other", async () => {
    const data = await surfaces(
      repo({
        "package.json": '{"name": "demo", "main": "src/index.ts"}\n',
        "src/index.ts": 'export { one } from "./lib/m.js";\n',
        "src/lib/m.ts": "export const one = 1;\nexport const two = 2;\n",
      }),
    );
    expect(data.surfaces.lib).toEqual(["one"]);
  });
});

describe("emitExportSurfaces: other languages (D5)", () => {
  test("Python: each package lists its __all__, else the public names __init__.py defines", async () => {
    const data = await surfaces(
      repo({
        "pkg/__init__.py": '__all__ = ["A", "b"]\n',
        "pkg/sub/__init__.py": "def f():\n    pass\n\ndef _g():\n    pass\n",
        "pkg/mod.py": "def not_a_package():\n    pass\n",
      }),
    );
    expect(data.surfaces).toEqual({ pkg: ["A", "b"], "pkg/sub": ["f"] });
    expect(data.note).toContain("__all__");
  });

  test("Rust: each library crate root lists its pub items and its pub use names", async () => {
    const data = await surfaces(
      repo({
        "Cargo.toml": '[package]\nname = "demo"\n',
        "src/lib.rs": [
          "pub mod api;",
          "pub use api::{Client, Config as Cfg};",
          "pub use std::collections::HashMap;",
          "pub use inner::*;",
          "pub(crate) use hidden::H;",
          "pub fn go() {}",
          "fn private() {}",
          "",
        ].join("\n"),
        "src/api.rs": "pub struct Client;\npub struct Config;\n",
        "src/main.rs": "pub fn not_api() {}\nfn main() {}\n",
      }),
    );
    expect(data.surfaces).toEqual({
      "src/lib.rs": ["Cfg", "Client", "HashMap", "api", "go", "inner::*"],
    });
    expect(data.note).toContain("pub use");
  });

  test("C#: no surface file, because the language has no rule for one", async () => {
    const root = repo({
      "src/App/App.csproj": '<Project Sdk="Microsoft.NET.Sdk"></Project>\n',
      "src/App/A.cs": "namespace App;\npublic class A { }\n",
    });
    const out = join(root, "out");
    mkdirSync(out, { recursive: true });
    expect(emitExportSurfaces(await buildGraph(root), root, out)).toBeNull();
    expect(() => readFileSync(join(out, "package-export-surfaces.json"))).toThrow();
  });
});
