import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { scanText } from "../../scripts/privacy-check.ts";

const root = join(import.meta.dir, "../..");
const work = mkdtempSync(join(tmpdir(), "repo-tools-build-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const bundle = join(work, "cli.js");

describe("node bundle (design 11.1)", () => {
  test("scripts/build.ts writes one ESM file", () => {
    const r = Bun.spawnSync([process.execPath, "scripts/build.ts", `--outfile=${bundle}`], {
      cwd: root,
    });
    expect(r.stderr.toString()).toBe("");
    expect(r.exitCode).toBe(0);
  });

  test("the bundle starts with a node shebang", () => {
    expect(readFileSync(bundle, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  test("the bundle holds no absolute path", () => {
    const rules = scanText("dist/cli.js", readFileSync(bundle, "utf8"), new Map()).map(
      (f) => f.rule,
    );
    expect(rules.filter((r) => r.endsWith("-path"))).toEqual([]);
  });

  test("node runs the bundle: version, help and an unknown subcommand", () => {
    const version = Bun.spawnSync(["node", bundle, "--version"]);
    expect(version.stdout.toString()).toBe(`${pkg.version}\n`);
    expect(version.exitCode).toBe(0);
    expect(Bun.spawnSync(["node", bundle, "--help"]).exitCode).toBe(0);
    expect(Bun.spawnSync(["node", bundle, "frobnicate"]).exitCode).toBe(1);
  });
});

describe("smoke test script (design 13.3)", () => {
  const smoke = (command: string[]) =>
    Bun.spawnSync([process.execPath, "scripts/smoke.ts", "--", ...command], { cwd: root });

  test("the smoke test passes on the source entry", () => {
    const r = smoke([process.execPath, "src/bin.ts"]);
    expect(r.stderr.toString()).toBe("");
    expect(r.exitCode).toBe(0);
  });

  test("the smoke test fails on a command that prints the wrong version", () => {
    const fake = join(work, "fake.js");
    writeFileSync(fake, 'console.log("9.9.9");\n');
    const r = smoke(["node", fake]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("--version");
  });

  test("the smoke test fails when chunk split and merge do not round-trip (13.3 step 4)", () => {
    // A fake CLI that passes the first three steps but whose `chunk` does nothing.
    const fake = join(work, "fake-chunk.js");
    writeFileSync(
      fake,
      [
        "const a = process.argv[2];",
        `if (a === "--version") console.log(${JSON.stringify(pkg.version)});`,
        'else if (a === "--help") console.log("depgraph chunk compress");',
        'else if (a !== "chunk") process.exitCode = 1;',
        "",
      ].join("\n"),
    );
    const r = smoke(["node", fake]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("chunk round trip");
  });

  test("the smoke test fails when compress does not round-trip a JSON file", () => {
    const fake = join(work, "fake-compress.js");
    writeFileSync(
      fake,
      [
        "const a = process.argv.slice(2);",
        `if (a[0] === "--version") console.log(${JSON.stringify(pkg.version)});`,
        'else if (a[0] === "--help") console.log("depgraph chunk compress");',
        'else if (a[0] !== "compress") process.exitCode = 1;',
        "",
      ].join("\n"),
    );
    const r = smoke(["node", fake]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("compress JSON round trip");
  });

  test("the smoke test fails without a command", () => {
    expect(smoke([]).exitCode).toBe(1);
  });
});

describe("extension-load probe (design 13.3 step 7)", () => {
  test("the probe runs both hooks of the fixture extension", async () => {
    const { probe } = await import("../../scripts/ext-probe.ts");
    const ran = await probe(
      join(root, "tests/fixtures/extension/probe.mjs"),
      join(work, "ext-out"),
    );
    expect(ran).toEqual(["log:preflight ran", "preflight", "report", "report-file"]);
  });
});

describe("build script arguments (review T3)", () => {
  const build = (args: string[]) =>
    Bun.spawnSync([process.execPath, "scripts/build.ts", ...args], { cwd: root });

  test("a space-separated flag value is accepted, not dropped", async () => {
    const { parseBuildArgs } = await import("../../scripts/build.ts");
    expect(parseBuildArgs(["--compile", "--target", "bun-linux-x64"]).target).toBe("bun-linux-x64");
    expect(parseBuildArgs(["--compile", "--target=bun-linux-x64"]).target).toBe("bun-linux-x64");
  });

  test("an unknown flag or target exits 1", () => {
    expect(build(["--compile", "--nope"]).exitCode).toBe(1);
    expect(build(["--compile", "--target=bun-plan9-x64"]).exitCode).toBe(1);
    expect(build(["--outfile"]).exitCode).toBe(1);
  });

  test("--compile writes the executable only, no checksum file", () => {
    const outdir = join(work, "compiled");
    const r = build(["--compile", "--outdir", outdir]);
    expect(r.exitCode).toBe(0);
    expect(readdirSync(outdir).filter((f) => !f.startsWith("repo-tools-"))).toEqual([]);
  });
});
