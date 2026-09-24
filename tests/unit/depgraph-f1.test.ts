/**
 * Fix F1: no report holds a date stamp. Two runs under two different clocks give the same bytes,
 * and no report holds an ISO date.
 */
import { afterAll, afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/depgraph/index.ts";

const repo = join(import.meta.dir, "../..");
const work = mkdtempSync(join(tmpdir(), "repo-tools-f1-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));
afterEach(() => setSystemTime());

async function reports(
  fixture: string,
  flags: string[],
  tag: string,
): Promise<Record<string, string>> {
  const root = join(work, `${fixture}-${tag}`);
  cpSync(join(repo, "tests/fixtures/depgraph", fixture), root, { recursive: true });
  await run([`--root=${root}`, ...flags], { stdout: () => {}, stderr: () => {} });
  const out = join(root, "docs/architecture");
  return Object.fromEntries(readdirSync(out).map((n) => [n, readFileSync(join(out, n), "utf8")]));
}

describe("F1: no date stamps", () => {
  for (const [fixture, flags] of [
    ["mini-repo", []],
    ["mini-repo", ["--all"]],
    ["mono-repo", []],
    ["mono-repo", ["--all"]],
  ] as const) {
    test(`${fixture} ${flags.join(" ") || "(default)"}`, async () => {
      setSystemTime(new Date("2031-01-02T03:04:05.678Z"));
      const first = await reports(fixture, [...flags], "a");
      setSystemTime(new Date("2037-11-12T13:14:15.161Z"));
      const second = await reports(fixture, [...flags], "b");
      expect(second).toEqual(first);
      for (const [name, text] of Object.entries(first)) {
        expect({ name, dates: text.match(/\b\d{4}-\d{2}-\d{2}\b/g) }).toEqual({
          name,
          dates: null,
        });
      }
    });
  }
});
