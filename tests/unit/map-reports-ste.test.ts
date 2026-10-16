/**
 * The prose that `repo-tools map` writes into `duplicate-symbols.md` and `unused-analysis.md`
 * passes `repo-tools ste`. A hand edit of a generated report is lost at the next run, so the
 * generator text itself must pass. The test maps one repository for each language that has
 * language-specific text (TypeScript, C#, Rust) and one that has none (Python).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runMap } from "../../src/map/command.ts";
import { checkMarkdown } from "../../src/ste/markdown.ts";
import { makeTempDir } from "./temp.ts";

const REPO = join(import.meta.dir, "../..");
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A new folder with the files `files`. */
function repo(files: Record<string, string>): string {
  const root = makeTempDir("map-ste");
  made.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
}

/** Maps `root` and returns the STE findings of the two reports. */
async function findings(root: string): Promise<string[]> {
  const code = await runMap([`--root=${root}`, "--no-extensions"], {
    stdout: () => {},
    stderr: () => {},
  });
  expect(code).toBe(0);
  const out = join(root, "docs/architecture");
  return ["duplicate-symbols.md", "unused-analysis.md"].flatMap((name) =>
    checkMarkdown(name, readFileSync(join(out, name), "utf8").replace(/\r\n?/g, "\n")),
  );
}

describe("the generated prose passes the STE check", () => {
  test("TypeScript: the classified duplicates list and the base caveats", async () => {
    const root = makeTempDir("map-ste");
    made.push(root);
    cpSync(join(REPO, "tests/fixtures/depgraph/mono-repo"), root, { recursive: true });
    expect(await findings(root)).toEqual([]);
  });

  test("TypeScript: the per-export note that names a dynamic import", async () => {
    const root = repo({
      "package.json": '{"name": "demo", "main": "src/index.ts"}\n',
      "src/index.ts": "export type Lazy = typeof import('./lazy.js');\nexport const go = 1;\n",
      "src/lazy.ts": "export const unusedThing = 1;\n",
    });
    expect(await findings(root)).toEqual([]);
    const text = readFileSync(join(root, "docs/architecture/unused-analysis.md"), "utf8");
    expect(text).toContain("`unusedThing`: Verified: 'src/index.ts' has a literal import()");
  });

  test("C#: the namespace caveat", async () => {
    const root = repo({
      "src/App/App.csproj":
        '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup></Project>\n',
      "src/App/Program.cs": "namespace App;\npublic class Program { }\npublic class Helper { }\n",
      "src/Core/Core.csproj": '<Project Sdk="Microsoft.NET.Sdk"></Project>\n',
      "src/Core/Thing.cs": "namespace Core;\npublic class Thing { }\npublic class Helper { }\n",
    });
    expect(await findings(root)).toEqual([]);
  });

  test("Rust: the public API caveat", async () => {
    const root = repo({
      "Cargo.toml": '[package]\nname = "demo"\nversion = "0.1.0"\n',
      "src/lib.rs": "mod util;\npub fn run() {}\n",
      "src/util.rs": "pub fn helper() {}\npub fn run() {}\n",
      "src/main.rs": "fn main() {}\n",
    });
    expect(await findings(root)).toEqual([]);
  });

  test("Python: the base caveats", async () => {
    const root = repo({
      "pkg/a.py": "def helper():\n    pass\n\ndef run():\n    pass\n",
      "pkg/b.py": "from pkg.a import run\n\ndef helper():\n    pass\n",
      "main.py": "import pkg.b\n",
    });
    expect(await findings(root)).toEqual([]);
  });
});
