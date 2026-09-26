import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { scanText } from "../../scripts/privacy-check.ts";
import { makeTempDir } from "./temp.ts";

const root = join(import.meta.dir, "../..");
const work = makeTempDir("build");
afterAll(() => rmSync(work, { recursive: true, force: true }));

const bundle = join(work, "cli.js");

/**
 * The time budget of a test that runs the whole smoke script. The script spawns the tool about
 * ten times; one run takes about 5 s on the development machine.
 */
const SMOKE_TIMEOUT_MS = 30_000;

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

  test("each .wasm asset that the bundle references is written next to it (D7)", () => {
    const refs = [...readFileSync(bundle, "utf8").matchAll(/["']\.\/([\w.-]+\.wasm)["']/g)].map(
      (m) => m[1] as string,
    );
    expect(refs.length).toBe(3);
    for (const name of refs) expect(existsSync(join(dirname(bundle), name))).toBe(true);
  });

  test("node runs map from the bundle, from another working folder (D7)", () => {
    const mapWork = makeTempDir("bundle-map");
    try {
      const repo = join(mapWork, "r");
      mkdirSync(join(repo, "src"), { recursive: true });
      writeFileSync(join(repo, "src", "index.ts"), "export const a = 1;\n");
      writeFileSync(join(repo, "package.json"), '{"name": "r", "main": "src/index.ts"}\n');
      const r = Bun.spawnSync(["node", bundle, "map", `--root=${repo}`], { cwd: mapWork });
      expect(r.stderr.toString()).toBe("");
      expect(r.exitCode).toBe(0);
      expect(existsSync(join(repo, "docs/architecture/dependency-graph.json"))).toBe(true);
    } finally {
      rmSync(mapWork, { recursive: true, force: true });
    }
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

  test(
    "the smoke test passes on the source entry",
    () => {
      const r = smoke([process.execPath, "src/bin.ts"]);
      expect(r.stderr.toString()).toBe("");
      expect(r.exitCode).toBe(0);
    },
    SMOKE_TIMEOUT_MS,
  );

  test(
    "the smoke test fails on a command that prints the wrong version",
    () => {
      const fake = join(work, "fake.js");
      writeFileSync(fake, 'console.log("9.9.9");\n');
      const r = smoke(["node", fake]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr.toString()).toContain("--version");
    },
    SMOKE_TIMEOUT_MS,
  );

  test(
    "the smoke test fails when chunk split and merge do not round-trip (13.3 step 4)",
    () => {
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
    },
    SMOKE_TIMEOUT_MS,
  );

  test(
    "the smoke test fails when compress does not round-trip a JSON file",
    () => {
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
    },
    SMOKE_TIMEOUT_MS,
  );

  test(
    "the smoke test fails without a command",
    () => {
      expect(smoke([]).exitCode).toBe(1);
    },
    SMOKE_TIMEOUT_MS,
  );
});

describe("smoke test: map on the product (design 13.3 steps 2, 3 and 7)", () => {
  const smoke = (command: string[]) =>
    Bun.spawnSync([process.execPath, "scripts/smoke.ts", "--", ...command], { cwd: root });

  test(
    "the source entry passes every step, the map steps included",
    () => {
      const r = smoke([process.execPath, "src/bin.ts"]);
      expect(r.stderr.toString()).toBe("");
      expect(r.stdout.toString()).toBe("smoke passed: 8 steps.\n");
    },
    SMOKE_TIMEOUT_MS,
  );

  test(
    "a CLI whose map writes nothing fails steps 2, 3 and 7 by name",
    () => {
      // A fake CLI that passes the first three steps; its map exits 0 and writes nothing.
      const fake = join(work, "fake-map.js");
      writeFileSync(
        fake,
        [
          "const a = process.argv[2];",
          `if (a === "--version") console.log(${JSON.stringify(pkg.version)});`,
          'else if (a === "--help") console.log("map depgraph chunk compress query");',
          'else if (a !== "map") process.exitCode = 1;',
          "",
        ].join("\n"),
      );
      const err = smoke(["node", fake]).stderr.toString();
      expect(err).toContain("map golden (13.3 step 2)");
      expect(err).toContain("api surface golden (13.3 step 3)");
      expect(err).toContain("extension hooks (13.3 step 7)");
    },
    SMOKE_TIMEOUT_MS,
  );
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
