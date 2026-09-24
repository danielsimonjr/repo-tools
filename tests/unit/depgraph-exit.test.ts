/**
 * The exit rows of design section 3.2 and criterion 4: a root that is not an existing directory
 * exits 1 before any folder is made; zero source files exit 1 and make no output folder; every
 * error text on standard error shows the root as `<root>`, never as an absolute path.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/depgraph/index.ts";
import { makeTree, removeTrees, runDepgraph } from "./tree.ts";

afterAll(removeTrees);

/** Runs depgraph with exactly `argv` (no added `--root=`). */
async function runArgs(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const code = await run(argv, {
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
  });
  return { code, stdout, stderr };
}

/** True when `text` holds `root` in its native or its POSIX form. */
function holdsRoot(text: string, root: string): boolean {
  return text.includes(root) || text.includes(root.replace(/\\/g, "/"));
}

describe("a root that is not an existing directory", () => {
  for (const form of ["--root=", ""]) {
    test(`${form || "a positional root"} that does not exist exits 1 and makes no folder`, async () => {
      const parent = makeTree({ "keep.txt": "x" });
      const missing = join(parent, "missing");
      const r = await runArgs([`${form}${missing}`]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("<root>");
      expect(r.stderr).toContain("not an existing directory");
      expect(holdsRoot(r.stderr, missing)).toBe(false);
      expect(r.stdout).toBe("");
      expect(existsSync(missing)).toBe(false);
      expect(readdirSync(parent)).toEqual(["keep.txt"]);
    });
  }

  test("a root that is a file exits 1 and makes no folder", async () => {
    const parent = makeTree({ "file.ts": "export const x = 1;\n" });
    const r = await runArgs([`--root=${join(parent, "file.ts")}`, "--check-census"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("not an existing directory");
    expect(readdirSync(parent)).toEqual(["file.ts"]);
  });
});

describe("zero source files", () => {
  test("exit 1 and make no output folder", async () => {
    const root = makeTree({ "package.json": JSON.stringify({ name: "z", version: "1.0.0" }) });
    const r = await runDepgraph(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("No TypeScript files found");
    expect(r.stdout).not.toContain("Created output directory");
    expect(existsSync(join(root, "docs"))).toBe(false);
  });

  test("make no --out folder either", async () => {
    const root = makeTree({ "README.md": "x\n" });
    const r = await runDepgraph(root, ["--out=reports/arch"]);
    expect(r.code).toBe(1);
    expect(existsSync(join(root, "reports"))).toBe(false);
  });
});

describe("error text shows the root as <root>", () => {
  test("a system error that names a path under the root", async () => {
    // The output folder is a file, so the write fails with a system error that names its path.
    const root = makeTree({
      "package.json": JSON.stringify({ name: "e", version: "1.0.0" }),
      "src/index.ts": "/** Entry. */\nexport const main = 1;\n",
      "blocked/arch": "a file, not a folder\n",
    });
    const r = await runDepgraph(root, ["--out=blocked/arch"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("<root>");
    expect(holdsRoot(r.stderr, root)).toBe(false);
    expect(holdsRoot(r.stdout, root)).toBe(false);
  });
});
