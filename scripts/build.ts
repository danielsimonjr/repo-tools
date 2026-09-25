/**
 * Build script (design 11.1, 11.2).
 *
 *   bun scripts/build.ts [--outfile <path>]
 *       Writes the Node-compatible ESM bundle (default `dist/cli.js`). Third-party code is
 *       bundled in.
 *   bun scripts/build.ts --compile [--target <target>] [--outdir <dir>]
 *       Writes one compiled executable (default target: the host; default dir: `bin`).
 *
 * Both modes first check that `node_modules` matches `bun.lock` (`scripts/lockcheck.ts`) and
 * exit 1 when it does not. Flags take `--name value` or `--name=value`. An unknown flag or target
 * exits 1. The release
 * workflow (`build.yml`) writes and verifies `SHA256SUMS`; this script writes no checksum file.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertInstalledTree } from "./lockcheck.ts";

export const TARGETS = ["bun-windows-x64", "bun-linux-x64", "bun-darwin-arm64"] as const;
export type Target = (typeof TARGETS)[number];

export interface BuildArgs {
  compile: boolean;
  target?: string;
  outdir?: string;
  outfile?: string;
}

const VALUE_FLAGS = ["target", "outdir", "outfile"] as const;

/** Parses the build flags. Throws on an unknown flag or a flag without a value. */
export function parseBuildArgs(argv: string[]): BuildArgs {
  const args: BuildArgs = { compile: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--compile") {
      args.compile = true;
      continue;
    }
    const [name, inline] = arg.replace(/^--/, "").split(/=(.*)/s, 2);
    const flag = VALUE_FLAGS.find((f) => f === name);
    if (!arg.startsWith("--") || !flag) throw new Error(`unknown argument '${arg}'`);
    const value = inline ?? argv[++i];
    if (!value || value.startsWith("--")) throw new Error(`--${flag} needs a value`);
    args[flag] = value;
  }
  return args;
}

/** Returns the executable file name for a target, for example `repo-tools-linux-x64`. */
export function executableName(target: Target): string {
  const name = `repo-tools-${target.replace(/^bun-/, "")}`;
  return target.includes("windows") ? `${name}.exe` : name;
}

/** Returns the target of the host platform, or undefined when v1 does not build for it. */
export function hostTarget(): Target | undefined {
  const t = `bun-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
  return TARGETS.find((x) => x === t);
}

async function bundle(outfile: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: ["src/bin.ts"],
    target: "node",
    format: "esm",
    minify: false,
  });
  if (!result.success) throw new AggregateError(result.logs, "bundle failed");
  const [output] = result.outputs;
  if (!output) throw new Error("bundle produced no output");
  const code = (await output.text()).replace(/^#!.*\n/, "");
  mkdirSync(dirname(outfile), { recursive: true });
  await Bun.write(outfile, `#!/usr/bin/env node\n${code}`);
}

function compile(target: Target, outdir: string): void {
  mkdirSync(outdir, { recursive: true });
  const file = join(outdir, executableName(target));
  const r = Bun.spawnSync(
    [process.execPath, "build", "--compile", `--target=${target}`, "src/bin.ts", "--outfile", file],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (r.exitCode !== 0) throw new Error(`compile ${target} failed (exit ${r.exitCode})`);
}

if (import.meta.main) {
  try {
    const args = parseBuildArgs(process.argv.slice(2));
    // Both artifacts bundle node_modules, so a tree that differs from bun.lock stops the build.
    assertInstalledTree(process.cwd());
    if (args.compile) {
      if (args.outfile) throw new Error("--outfile applies to the bundle, not to --compile");
      const name = args.target ?? hostTarget();
      const target = TARGETS.find((t) => t === name);
      if (!target) {
        throw new Error(
          `no v1 target for '${name ?? `${process.platform}-${process.arch}`}'. ` +
            `Use one of: ${TARGETS.join(", ")}`,
        );
      }
      compile(target, args.outdir ?? "bin");
    } else {
      if (args.target || args.outdir) throw new Error("--target and --outdir need --compile");
      await bundle(args.outfile ?? "dist/cli.js");
    }
  } catch (e) {
    console.error(`build: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
