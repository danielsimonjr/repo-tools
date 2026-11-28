/**
 * The CI workflow file. A lost runner must fail the test job in minutes, not in the platform
 * default of six hours, so every job of the matrix carries a time limit.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const CI_FILE = join(import.meta.dir, "../../.github/workflows/ci.yml");

interface Job {
  "timeout-minutes"?: unknown;
}

const jobs = (load(readFileSync(CI_FILE, "utf8")) as { jobs: Record<string, Job> }).jobs;

describe("CI workflow: time limits", () => {
  // The slowest test run of the matrix took about two minutes on Windows in the recent runs;
  // the limit is about three times that.
  test("the test job has a time limit of six minutes", () => {
    expect(jobs.test?.["timeout-minutes"]).toBe(6);
  });
});
