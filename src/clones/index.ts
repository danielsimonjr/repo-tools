/**
 * `repo-tools clones` (design section 17): lists the functions of a repository and finds the
 * functions that copy each other. The command reads the source and writes files only when the
 * user names an output folder.
 */
import { join, resolve } from "node:path";
import { type ClonesSettings, checkClonesFlag, loadConfigSections } from "../config.ts";
import { maskRoot } from "../depgraph/paths.ts";
import { writeLf } from "../io.ts";
import type { Io } from "../io-types.ts";
import { isDirectory } from "../map/command.ts";
import { discover, readSource } from "../map/discovery.ts";
import { grammarFor, loadGrammar, parserFor } from "../map/grammars.ts";
import { detect } from "./detect.ts";
import { clonesJson, inventoryJsonl, summaryText } from "./report.ts";
import { type ClonesConfig, mergeClonesConfig } from "./settings.ts";
import { type Unit, unitsOf } from "./units.ts";

/** The help text of `repo-tools clones`. */
export const CLONES_HELP = `Usage: repo-tools clones [root] [--out=<dir>] [--config=<path>] [--src=<path>...]
                         [--min-nodes=<n>] [--shingle=<n>] [--near=<f>]
                         [--containment=<f>] [--containment-min=<n>]
                         [--rare=<n>] [--min-shared=<n>] [--list-errors=<n>]

List the functions of a TypeScript or JavaScript repository and find the functions
that copy each other. The command only reads the repository. The result is a list
of candidates: read both bodies of a pair before you change anything.

A function is a unit when it has a name and its body has at least --min-nodes
labels. A label is one node of the body, with names, literals, types and comments
erased. Units with the same label sequence are an exact group. Two units whose
shingles (runs of --shingle labels) overlap enough are a near pair.

  --out=<dir>           Write inventory.jsonl and clones.json to this folder.
                        Without it the command writes no file.
  --config=<path>       The config file. The default is repo-tools.config.json at
                        the root. The settings are in its "clones" section.
  --src=<path>...       The folders to read. The word "auto" (the default) reads
                        the files of the src area. The flag takes every argument
                        up to the next flag.
  --min-nodes=<n>       The smallest number of labels of a unit. Default 50.
  --shingle=<n>         The labels in one shingle. Default 6.
  --near=<f>            The smallest Jaccard score of a near pair. Default 0.6.
  --containment=<f>     The smallest containment of a near pair. Default 0.9.
  --containment-min=<n> The smallest shingle count of the smaller unit for the
                        containment rule. Default 20.
  --rare=<n>            A shingle in more units than this does not pick candidate
                        pairs. Default 60.
  --min-shared=<n>      The rare shingles that a candidate pair must share.
                        Default 3.
  --list-errors=<n>     The most paths of files with a parse error that the
                        summary lists. Default 20.
  --root=<path>         The root. The default is the current folder.
  --help, -h            Show this help.

A flag overrides the config file, and the config file overrides the default.

Exit codes: 0 when the run finished. 1 when the root holds no source file to read.
2 on a usage error, a bad config file or a root that is not a folder.
`;

/** The run finds no source file to read. The run fails. The result is not clean. */
class NothingToRead extends Error {}

/** The flags that take one value, and the setting that each one sets. */
const VALUE_FLAGS: Readonly<Record<string, keyof ClonesSettings>> = {
  "--out": "out",
  "--min-nodes": "minNodes",
  "--shingle": "shingleLength",
  "--near": "nearThreshold",
  "--containment": "containmentThreshold",
  "--containment-min": "containmentMinShingles",
  "--rare": "rareShingleLimit",
  "--min-shared": "minSharedShingles",
  "--list-errors": "parseErrorList",
};

/** The settings that hold a whole number or a fraction: the flag text must be a plain number. */
const NUMERIC = new Set<keyof ClonesSettings>([
  "minNodes",
  "shingleLength",
  "nearThreshold",
  "containmentThreshold",
  "containmentMinShingles",
  "rareShingleLimit",
  "minSharedShingles",
  "parseErrorList",
]);

/** The parsed arguments. */
interface Options {
  root: string;
  config: string | undefined;
  settings: ClonesSettings;
}

/** Reads the arguments. A strict parser: an unknown flag, a missing value or a repeat throws. */
function parseArgs(argv: readonly string[]): Options {
  const options: Options = { root: ".", config: undefined, settings: {} };
  const seen = new Set<string>();
  let rootSet = false;
  const setRoot = (value: string): void => {
    if (rootSet)
      throw new Error("the root is set twice (use --root=<path> or one positional path)");
    rootSet = true;
    options.root = value;
  };
  const once = (flag: string): void => {
    if (seen.has(flag)) throw new Error(`flag ${flag} is set twice`);
    seen.add(flag);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("-")) {
      setRoot(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (name === "--src") {
      once(name);
      const paths: string[] = [];
      if (eq !== -1) paths.push(arg.slice(eq + 1));
      else
        while (i + 1 < argv.length && !(argv[i + 1] ?? "").startsWith("-")) {
          paths.push(argv[++i] ?? "");
        }
      if (paths.length === 0 || paths.some((p) => p === "")) {
        throw new Error("flag --src needs a value: --src=<path>");
      }
      const only = paths.length === 1 ? paths[0] : undefined;
      options.settings.src = checkClonesFlag(
        name,
        "src",
        only === "auto" ? "auto" : paths,
      ) as ClonesSettings["src"];
      continue;
    }
    if (name !== "--root" && name !== "--config" && !Object.hasOwn(VALUE_FLAGS, name)) {
      throw new Error(`unknown flag '${name}' (see repo-tools clones --help)`);
    }
    once(name);
    let value = eq === -1 ? undefined : arg.slice(eq + 1);
    if (eq === -1 && i + 1 < argv.length && !(argv[i + 1] ?? "").startsWith("-")) {
      value = argv[++i];
    }
    if (value === undefined || value === "") {
      throw new Error(`flag ${name} needs a value: ${name}=<value>`);
    }
    if (name === "--root") setRoot(value);
    else if (name === "--config") options.config = value;
    else {
      const key = VALUE_FLAGS[name] as keyof ClonesSettings;
      // Number("") and Number("0x10") would pass as numbers, so the text must look like a number.
      const raw: unknown = NUMERIC.has(key)
        ? /^\d+(\.\d+)?$/.test(value)
          ? Number(value)
          : NaN
        : value;
      Object.assign(options.settings, { [key]: checkClonesFlag(name, key, raw) });
    }
  }
  return options;
}

/** A folder from `--src` or the config file as a POSIX path without `./` or a trailing slash. */
function folderPrefix(path: string): string {
  const posix = path
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/\/+$/, "");
  return posix === "." ? "" : posix;
}

/** The files to read: the `src` area, or the files below the listed folders. */
function selectFiles(root: string, src: ClonesConfig["src"]): string[] {
  const found = discover(root, "typescript").filter((f) => !f.path.endsWith(".d.ts"));
  if (src === "auto") return found.filter((f) => f.area === "src").map((f) => f.path);
  const folders = src.map(folderPrefix);
  return found
    .filter((f) => folders.some((d) => d === "" || f.path === d || f.path.startsWith(`${d}/`)))
    .map((f) => f.path);
}

/** Reads and parses every file and returns the units and the files with parse errors. */
async function readUnits(
  root: string,
  files: readonly string[],
  minNodes: number,
): Promise<{ units: Unit[]; parseErrorFiles: string[] }> {
  const units: Unit[] = [];
  const parseErrorFiles: string[] = [];
  for (const file of files) {
    const source = readSource(join(root, file)).replace(/^\uFEFF/, "");
    const grammar = grammarFor(file);
    await loadGrammar(grammar);
    const tree = parserFor(grammar).parse(source);
    if (!tree) {
      parseErrorFiles.push(file);
      continue;
    }
    try {
      if (tree.rootNode.hasError) parseErrorFiles.push(file);
      units.push(...unitsOf(tree.rootNode, source, file, minNodes));
    } finally {
      tree.delete();
    }
  }
  return { units, parseErrorFiles };
}

/** Runs the command for a root and the merged settings; returns the exit code. */
async function execute(root: string, config: ClonesConfig, io: Io): Promise<number> {
  const files = selectFiles(root, config.src);
  if (files.length === 0) {
    throw new NothingToRead(
      config.src === "auto"
        ? "no TypeScript or JavaScript file in the src area (set clones.src or pass --src=<path>)"
        : "no TypeScript or JavaScript file below the listed folders",
    );
  }
  const { units, parseErrorFiles } = await readUnits(root, files, config.minNodes);
  const detection = detect(units, config);
  io.stdout(summaryText(config, { files: files.length, parseErrorFiles }, units, detection));
  if (config.out !== null) {
    const out = resolve(root, config.out);
    try {
      writeLf(join(out, "inventory.jsonl"), inventoryJsonl(units));
      writeLf(join(out, "clones.json"), clonesJson(config, detection));
    } catch {
      throw new Error(`cannot write the output folder '${config.out}'`);
    }
    const shown = config.out.replace(/\\/g, "/").replace(/\/+$/, "");
    io.stdout(`wrote ${shown}/inventory.jsonl\nwrote ${shown}/clones.json\n`);
  }
  return 0;
}

/** Runs `repo-tools clones` and returns the exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  let root: string | undefined;
  const stderr = (text: string): void => io.stderr(root ? maskRoot(text, root) : text);
  try {
    const options = parseArgs(argv);
    root = resolve(options.root);
    if (!isDirectory(root)) throw new Error("the root <root> is not an existing directory");
    const file = loadConfigSections(root, options.config).clones;
    return await execute(root, mergeClonesConfig(options.settings, file), io);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(`repo-tools clones: ${message}\n`);
    return error instanceof NothingToRead ? 1 : 2;
  }
}
