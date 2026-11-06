/**
 * `repo-tools map` writes the values of the Verification tables in the Markdown documents of its
 * report folder, from the graph that it built. `repo-tools check` then passes without a hand edit.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NO_VERIFICATION_MARKER } from "../../src/check/claims.ts";
import { main } from "../../src/cli.ts";
import { makeTempDir } from "./temp.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A new repository with the files `files`. Returns its root. */
function repo(files: Record<string, string>): string {
  const base = makeTempDir("map-verify");
  made.push(base);
  const root = join(base, "repo");
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
};

const table = (...rows: [string, string][]): string =>
  `## Verification\n\n| Claim | Value | Source |\n|---|---|---|\n${rows
    .map(([c, v]) => `| ${c} | ${v} | repo-tools map |`)
    .join("\n")}\n`;

const OVERVIEW = "docs/architecture/OVERVIEW.md";
const read = (root: string, rel = OVERVIEW): string => readFileSync(join(root, rel), "utf-8");
const check = (root: string) => cli(["check", root, "--docs=docs/architecture"]);

describe("repo-tools map: the values of the Verification tables", () => {
  test("a stale value is written from the graph; prose is kept; the check then passes", async () => {
    const text = `# Overview\n\nProse stays.\n\n${table(["totalSourceFiles", "999"], ["totalFiles", "999"])}\nAfter.\n`;
    const root = repo({ ...TS, [OVERVIEW]: text });
    const r = await cli(["map", root]);
    expect(r.code).toBe(0);
    const after = read(root);
    expect(after).not.toContain("| 999 |");
    expect(after.startsWith("# Overview\n\nProse stays.\n\n## Verification\n")).toBe(true);
    expect(after.endsWith("\nAfter.\n")).toBe(true);
    expect(r.out).toMatch(/Updated: docs\/architecture\/OVERVIEW\.md totalSourceFiles 999 -> \d+/);
    expect((await check(root)).code).toBe(0);
  });

  test("CRLF line ends are kept", async () => {
    const text = `# Overview\r\n\r\n${table(["totalSourceFiles", "999"]).replace(/\n/g, "\r\n")}`;
    const root = repo({ ...TS, [OVERVIEW]: text });
    expect((await cli(["map", root])).code).toBe(0);
    const after = read(root);
    expect(after.replace(/\r\n/g, "")).not.toContain("\n");
    expect(after.split("\r\n").length).toBe(text.split("\r\n").length);
    expect((await check(root)).code).toBe(0);
  });

  test("a document that already matches is not written", async () => {
    const root = repo({ ...TS, [OVERVIEW]: table(["totalSourceFiles", "999"]) });
    await cli(["map", root]);
    const before = statSync(join(root, OVERVIEW)).mtimeMs;
    const r = await cli(["map", root]);
    expect(r.code).toBe(0);
    expect(statSync(join(root, OVERVIEW)).mtimeMs).toBe(before);
    expect(r.out).not.toContain("Updated:");
  });

  test("an unknown claim is not written; check still reports it", async () => {
    const text = table(["noSuchMetric", "7"]);
    const root = repo({ ...TS, [OVERVIEW]: text });
    expect((await cli(["map", root])).code).toBe(0);
    expect(read(root)).toBe(text);
    expect((await check(root)).err).toContain("unknown claim 'noSuchMetric'");
  });

  test("a metric that the graph build declared unusable is not written", async () => {
    const text = table(["orphanedFiles", "5"]);
    const root = repo({
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 1;\n",
      [OVERVIEW]: text,
    });
    await cli(["map", root]);
    expect(read(root)).toBe(text);
    expect((await check(root)).err).toContain("cannot be verified");
  });

  test("a document that opts out is not written", async () => {
    const text = `${NO_VERIFICATION_MARKER}\n${table(["totalSourceFiles", "999"])}`;
    const root = repo({ ...TS, "docs/architecture/HAND.md": text });
    expect((await cli(["map", root])).code).toBe(0);
    expect(read(root, "docs/architecture/HAND.md")).toBe(text);
  });

  test("a byte order mark is kept", async () => {
    const root = repo({ ...TS, [OVERVIEW]: `\uFEFF${table(["totalSourceFiles", "999"])}` });
    expect((await cli(["map", root])).code).toBe(0);
    const bytes = readFileSync(join(root, OVERVIEW));
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect((await check(root)).code).toBe(0);
  });

  test("a document that is not UTF-8 gives a warning, and map still finishes", async () => {
    const root = repo({ ...TS, [OVERVIEW]: table(["totalSourceFiles", "999"]) });
    writeFileSync(join(root, "docs/architecture/LATIN.md"), Buffer.from([0x23, 0x20, 0xe9, 0x0a]));
    const r = await cli(["map", root]);
    expect(r.code).toBe(0);
    expect(r.err).toContain("Verification values not written");
    expect(r.err).toContain("not valid UTF-8");
  });
});

describe("rewriteClaimValues", () => {
  test("a source cell with a line separator is rewritten", async () => {
    const { rewriteClaimValues } = await import("../../src/check/claims.ts");
    const text = `## Verification\n\n| totalFiles | 999 | a${String.fromCharCode(0x2028)}b |\n`;
    expect(rewriteClaimValues(text, () => "5")).toContain("| totalFiles | 5 |");
  });
});
