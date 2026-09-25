/**
 * Test helper for `repo-tools query`: a small monorepo, its depgraph reports, and a runner.
 *
 * The packages:
 * - `packages/web`: its `.` entry reaches `io.ts`, which imports `node:fs` (a browser-safety
 *   leak). `cli.ts` imports `node:path`, but no file of the entry reaches it. `ping.ts` and
 *   `pong.ts` import each other (a runtime cycle).
 * - `packages/server`: its `.` entry imports `node:http`; a Node runtime in the tests that list it.
 *   `main.ts` imports `helper` from `@fx/web`.
 * - `packages/clean`: no file imports a Node built-in.
 */
import { main } from "../../src/cli.ts";
import { makeTree, runDepgraph } from "./tree.ts";

/** The files of the fixture monorepo. */
export const QUERY_TREE: Record<string, string> = {
  "package.json": JSON.stringify({ name: "fx", private: true, workspaces: ["packages/*"] }),
  "packages/web/package.json": JSON.stringify({ name: "@fx/web", version: "1.0.0" }),
  "packages/web/src/index.ts":
    "/** Web entry. */\nexport { helper } from './util.js';\nexport { view } from './view.js';\n",
  "packages/web/src/util.ts": "/** Util. */\nexport function helper(): number {\n  return 1;\n}\n",
  "packages/web/src/view.ts":
    "/** View. */\nimport { helper } from './util.js';\nimport { load } from './io.js';\n" +
    "import { ping } from './ping.js';\nexport const view = (): number => helper() + load() + ping();\n",
  "packages/web/src/io.ts":
    "/** IO. */\nimport { readFileSync } from 'node:fs';\n" +
    "export const load = (): number => readFileSync('x').length;\n",
  "packages/web/src/cli.ts":
    "/** CLI. */\nimport { join } from 'node:path';\nimport { helper } from './util.js';\n" +
    "export const run = (): string => join('a', String(helper()));\n",
  "packages/web/src/ping.ts":
    "/** Ping. */\nimport { pong } from './pong.js';\nexport const ping = (): number => pong() + 1;\n",
  "packages/web/src/pong.ts":
    "/** Pong. */\nimport { ping } from './ping.js';\nexport const pong = (): number => 0 * ping.length;\n",
  "packages/server/package.json": JSON.stringify({ name: "@fx/server", version: "1.0.0" }),
  "packages/server/src/index.ts":
    "/** Server entry. */\nimport { createServer } from 'node:http';\n" +
    "export { start } from './main.js';\nexport const server = createServer;\n",
  "packages/server/src/main.ts":
    "/** Main. */\nimport { helper } from '@fx/web';\nexport const start = (): number => helper();\n",
  "packages/clean/package.json": JSON.stringify({ name: "@fx/clean", version: "1.0.0" }),
  "packages/clean/src/index.ts": "/** Clean entry. */\nexport { twice } from './math.js';\n",
  "packages/clean/src/math.ts":
    "/** Math. */\nexport const twice = (n: number): number => n * 2;\n",
};

/**
 * Makes a copy of the fixture tree (with `extra` files) and runs depgraph on it with `--all`, so
 * the graph also holds the files that no entry reaches (`cli.ts`).
 */
export async function queryTree(extra: Record<string, string> = {}): Promise<string> {
  const root = makeTree({ ...QUERY_TREE, ...extra });
  const r = await runDepgraph(root, ["--all"]);
  if (r.code !== 0) throw new Error(`depgraph failed on the fixture: ${r.stderr}`);
  return root;
}

/** The result of one query run. */
export interface QueryRun {
  code: number;
  out: string;
  err: string;
}

/** Runs `repo-tools query` with captured output streams. */
export async function runQuery(argv: string[]): Promise<QueryRun> {
  let out = "";
  let err = "";
  const code = await main(["query", ...argv], {
    stdout: (s) => {
      out += s;
    },
    stderr: (s) => {
      err += s;
    },
  });
  return { code, out, err };
}
