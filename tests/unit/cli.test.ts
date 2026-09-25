import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { main, SUBCOMMANDS } from "../../src/cli.ts";
import { makeTempDir } from "./temp.ts";

/** Runs `main` with captured output streams. */
async function run(argv: string[]) {
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

describe("repo-tools CLI shell (spec 3.1)", () => {
  test("the subcommand list is exactly depgraph, chunk, compress, query", async () => {
    expect([...SUBCOMMANDS]).toEqual(["depgraph", "chunk", "compress", "query"]);
  });

  for (const argv of [[], ["--help"], ["-h"]]) {
    test(`${JSON.stringify(argv)} prints the subcommand list and exits 0`, async () => {
      const r = await run(argv);
      expect(r.code).toBe(0);
      for (const name of SUBCOMMANDS) expect(r.out).toContain(name);
      expect(r.err).toBe("");
    });
  }

  test("--version prints the package.json version and exits 0", async () => {
    const r = await run(["--version"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(`${pkg.version}\n`);
  });

  for (const name of ["depgraph", "chunk", "compress", "query"]) {
    test(`${name} --help prints that subcommand's help and exits 0`, async () => {
      const r = await run([name, "--help"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain(`repo-tools ${name}`);
    });
  }

  test("an unknown subcommand prints an error and the list, and exits 1", async () => {
    const r = await run(["frobnicate"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("frobnicate");
    for (const name of SUBCOMMANDS) expect(r.err).toContain(name);
  });

  test("an unknown global flag exits 1", async () => {
    expect((await run(["--nope"])).code).toBe(1);
  });

  test("depgraph dispatches to its pipeline: a root with no TypeScript exits 1", async () => {
    const root = makeTempDir("cli");
    try {
      const r = await run(["depgraph", `--root=${root}`]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("No TypeScript files found");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the entry file runs as a process and returns the same exit codes", async () => {
    const cli = join(import.meta.dir, "../../src/bin.ts");
    const ok = Bun.spawnSync([process.execPath, cli, "--version"]);
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout.toString()).toBe(`${pkg.version}\n`);
    const bad = Bun.spawnSync([process.execPath, cli, "frobnicate"]);
    expect(bad.exitCode).toBe(1);
  });
});
