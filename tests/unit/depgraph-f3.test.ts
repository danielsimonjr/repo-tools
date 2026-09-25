/**
 * Fix F3: every Markdown report starts with the verification marker and the do-not-edit banner,
 * and the banner names the configured regenerate command.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/depgraph/index.ts";
import { bannerFor, VERIFICATION_MARKER } from "../../src/depgraph/reporters/banner.ts";
import { makeTempDir } from "./temp.ts";

const repo = join(import.meta.dir, "../..");
const work = makeTempDir("f3");
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("F3: the banner", () => {
  test("the default banner names repo-tools depgraph", () => {
    expect(bannerFor({})).toBe(
      `${VERIFICATION_MARKER}\n<!-- GENERATED FILE -- do not edit by hand.\n     Regenerate with \`repo-tools depgraph\`. -->\n\n`,
    );
  });

  test("the banner names a configured command", () => {
    expect(bannerFor({ command: "bun run docs:deps" })).toContain(
      "Regenerate with `bun run docs:deps`. -->",
    );
  });

  test("a null marker omits the first line", () => {
    expect(bannerFor({ marker: null }).startsWith("<!-- GENERATED FILE")).toBe(true);
  });

  test("every Markdown report of a run starts with the banner", async () => {
    const root = join(work, "mono");
    cpSync(join(repo, "tests/fixtures/depgraph/mono-repo"), root, { recursive: true });
    await run([`--root=${root}`], { stdout: () => {}, stderr: () => {} });
    const out = join(root, "docs/architecture");
    const md = readdirSync(out).filter((n) => n.endsWith(".md"));
    expect(md.length).toBeGreaterThan(3);
    for (const name of md) {
      const starts = readFileSync(join(out, name), "utf8").startsWith(bannerFor({}));
      expect({ name, starts }).toEqual({ name, starts: true });
    }
  });
});
