/**
 * Entry roots for an app whose sources are not under `src/` alone: a build config that names its
 * entry files, a JSONC tsconfig, an HTML entry page and the scripts of the root package. The
 * tree mirrors an Electron app that builds its main process to `dist-electron/`, its CLI to
 * `dist-cli/` and its renderer from `src/index.html`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
  configReferencedEntries,
  htmlReferencedEntries,
  seedTsconfigEntries,
  stripJsonc,
} from "../../src/depgraph/roots.ts";
import { buildGraph } from "../../src/map/graph.ts";
import { makeTree, removeTrees } from "./tree.ts";

afterAll(removeTrees);

const CLI_TSCONFIG = `{
  // Emits the CLI to dist-cli/.
  "compilerOptions": { "outDir": "dist-cli", "rootDir": ".", },
  "include": ["cli/**/*.ts", "core/**/*.ts"],
}
`;

const VITE_CONFIG = `export default defineConfig({
  plugins: [
    electron({
      main: { entry: path.resolve(__dirname, 'electron/main.ts') },
      preload: { input: path.resolve(__dirname, 'electron/preload.ts') },
    }),
  ],
});
`;

const APP = {
  "package.json": JSON.stringify({
    name: "app",
    main: "dist-electron/main.js",
    bin: { app: "dist-cli/cli/index.js" },
    scripts: { "build:cli": "tsc -p tsconfig.cli.json" },
  }),
  "tsconfig.cli.json": CLI_TSCONFIG,
  "vite.config.ts": VITE_CONFIG,
  "vitest.config.ts": "export default { test: { setupFiles: ['test/setup.ts'] } };",
  "playwright.config.ts": "export default { globalSetup: './test/e2e/global-setup.ts' };",
  "src/index.html": '<html><script type="module" src="./main.ts"></script></html>',
  "src/main.ts": "import './ui.ts';",
  "src/ui.ts": "export const ui = 1;",
  "electron/main.ts": "import './menu.ts';",
  "electron/menu.ts": "export const menu = 1;",
  "electron/preload.ts": "export {};",
  "cli/index.ts": "import '../core/render.ts';",
  "core/render.ts": "export const render = 1;",
  "test/setup.ts": "export {};",
  "test/e2e/global-setup.ts": "export {};",
  "orphan/dead.ts": "export const dead = 1;",
};

describe("entry roots from build configs", () => {
  const root = makeTree(APP);

  test("seedTsconfigEntries reads a tsconfig with comments and trailing commas", () => {
    const seen: string[] = [];
    seedTsconfigEntries(root, "", "tsconfig.cli.json", (p) => seen.push(p));
    expect(seen).toContain("cli/index.ts");
    expect(seen).toContain("core/render.ts");
  });

  test("stripJsonc keeps a comment mark and a comma inside a string", () => {
    const text = '{ "url": "http://x/y", "a": "b,}", /* note */ "n": [1, 2,], }';
    expect(JSON.parse(stripJsonc(text))).toEqual({ url: "http://x/y", a: "b,}", n: [1, 2] });
  });

  test("configReferencedEntries reads entry, input, setupFiles and globalSetup values", () => {
    expect(configReferencedEntries(root).sort()).toEqual([
      "electron/main.ts",
      "electron/preload.ts",
      "test/e2e/global-setup.ts",
      "test/setup.ts",
    ]);
  });

  test("a setupFiles array and a tsup-style entry object are read", () => {
    const tree = makeTree({
      "vitest.config.ts": "export default { test: { setupFiles: ['a/one.ts', \"a/two.ts\"] } };",
      "tsup.config.ts": "export default { entry: { cli: 'bin/cli.ts' } };",
    });
    expect(configReferencedEntries(tree).sort()).toEqual(["a/one.ts", "a/two.ts", "bin/cli.ts"]);
  });

  test("htmlReferencedEntries reads the module script of a root or src index page", () => {
    expect(htmlReferencedEntries(root)).toEqual(["src/main.ts"]);
    const rootPage = makeTree({
      "index.html":
        '<script type="module" src="/src/app.tsx"></script><script src="https://x/y.js">',
      "src/app.tsx": "",
    });
    expect(htmlReferencedEntries(rootPage)).toEqual(["src/app.tsx"]);
    expect(htmlReferencedEntries(makeTree({ "readme.md": "" }))).toEqual([]);
  });

  test("buildGraph makes the app's real entries roots and leaves the dead file orphaned", async () => {
    const graph = await buildGraph(root);
    expect([...graph.roots].sort()).toEqual([
      "cli/index.ts",
      "core/render.ts",
      "electron/main.ts",
      "electron/preload.ts",
      "src/main.ts",
      "test/e2e/global-setup.ts",
      "test/setup.ts",
    ]);
  });
});
