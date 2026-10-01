/**
 * `repo-tools check` (design section 15): the drift gate. It reads the Verification tables of
 * the Markdown documents in a folder and compares each claim with a fresh graph of the
 * repository. Exit 0 when every claim matches, exit 1 with one line per problem otherwise.
 *
 * Standard error shows the root as `<root>`, and an absolute `--docs` folder as `<docs>`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ABSOLUTE_PATH_TEXT, isAbsolutePath, loadConfigFile, mergeMapConfig } from "../config.ts";
import { wantsHelp } from "../depgraph/args.ts";
import { maskRoot } from "../depgraph/paths.ts";
import type { Io } from "../io-types.ts";
import { isDirectory } from "../map/command.ts";
import { sortCodeUnits } from "../sort.ts";
import { NO_VERIFICATION_MARKER } from "./claims.ts";
import { collectMetrics } from "./metrics.ts";
import { type DocFile, type Verdict, verifyDocs } from "./verify.ts";

/** The help text of `repo-tools check`. */
export const CHECK_HELP = `Usage: repo-tools check [options] [project-root] --docs=<dir>

Check the Markdown documents in a folder against a fresh graph of the repository.
Each document needs a '## Verification' section: a table of rows
'| claim | value | source |'. A claim is a metric name, such as totalFiles or
orphanedFiles, and the value is the number that the document states. The check
builds the graph again, so a stale report on disk cannot hide drift.

A document passes, and is not read for claims, when its text holds the line
${NO_VERIFICATION_MARKER}
(repo-tools map writes it into each generated report). The config key
map.verificationMarker adds a second line of this kind.

Every problem is a failure: a folder with no Markdown file, a document without a
Verification section, a section without a row, an unknown claim, a metric that
the graph build declared unreliable, and a value that differs from the graph.

Options:
  --docs=<dir>         The folder of the documents (required). A relative path
                       is relative to the root and can start with ../. An
                       absolute path is used as given.
  --root=<path>        Project root (default: the current directory). An
                       argument that is not a flag also sets the root.
  --config=<path>      Config file, relative to the root (default:
                       repo-tools.config.json at the root, when it exists). The
                       check reads map.duplicateAllowlist and
                       map.verificationMarker from its 'map' section.
  --help, -h           Show this help.

The duplicate allowlist defaults to docs/architecture/duplicate-allowlist.json
and never comes from the --docs folder. The check writes nothing in the
repository.

Exit codes: 0 when every claim in every document matches. 1 when the root is not
a folder, when the docs folder does not exist or holds no Markdown file, when a
document cannot be read as UTF-8, when the repository has no source file or a
language the engine cannot read, on an unknown or invalid flag, and when any
problem above is found.
`;

/** The parsed command line. */
interface CheckOptions {
  root: string;
  docs: string | undefined;
  config: string | undefined;
}

/** Parses the arguments. A strict parser: an unknown flag, a missing value or a repeat throws. */
function parseCheckArgs(argv: readonly string[], cwd: string): CheckOptions {
  const options: CheckOptions = { root: cwd, docs: undefined, config: undefined };
  let rootSet = false;
  const setRoot = (value: string): void => {
    if (rootSet)
      throw new Error("the root is set twice (use --root=<path> or one positional path)");
    rootSet = true;
    options.root = value;
  };
  for (const arg of argv) {
    if (!arg.startsWith("-")) {
      setRoot(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const value = eq === -1 ? undefined : arg.slice(eq + 1);
    if (name !== "--root" && name !== "--docs" && name !== "--config") {
      throw new Error(`unknown flag '${name}' (see repo-tools check --help)`);
    }
    if (value === undefined || value === "") {
      throw new Error(`flag ${name} needs a value: ${name}=<value>`);
    }
    if (name === "--root") {
      setRoot(value);
    } else if (name === "--docs") {
      if (options.docs !== undefined) throw new Error("flag --docs is set twice");
      options.docs = value;
    } else {
      if (options.config !== undefined) throw new Error("flag --config is set twice");
      if (isAbsolutePath(value)) throw new Error(`flag --config ${ABSOLUTE_PATH_TEXT}`);
      options.config = value;
    }
  }
  return options;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

/** Reads the Markdown documents of `dir`, in code-unit order. `label` names the folder. */
function readDocs(dir: string, label: string): DocFile[] {
  if (!isDirectory(dir)) {
    throw new Error(`the docs folder ${label} does not exist or is not a folder`);
  }
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    throw new Error(`cannot read the docs folder ${label}`);
  }
  // The ending matches in any letter case: a skipped `X.MD` would be a silent pass.
  const names = sortCodeUnits(entries.filter((name) => /\.md$/i.test(name)));
  if (names.length === 0) {
    throw new Error(
      `the docs folder ${label} holds no *.md file -- nothing to verify. This is a failure, ` +
        "not a pass: an empty folder can mean that the documents moved or were never written.",
    );
  }
  return names.map((name) => {
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(join(dir, name));
    } catch {
      throw new Error(`cannot read ${label}/${name}`);
    }
    try {
      return { name, text: decoder.decode(bytes) };
    } catch {
      throw new Error(`${label}/${name} is not valid UTF-8`);
    }
  });
}

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** The one line of a passing check. */
function passText(verdict: Verdict): string {
  const claims = `${count(verdict.claimsChecked, "claim")} in ${count(verdict.docsChecked, "document")}`;
  const optedOut =
    verdict.docsOptedOut > 0 ? `; ${count(verdict.docsOptedOut, "document")} opted out` : "";
  return `check passed: every claim matches the graph (${claims}${optedOut}).\n`;
}

/** Runs `repo-tools check` and returns the exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  if (wantsHelp(argv)) {
    io.stdout(CHECK_HELP);
    return 0;
  }
  let root: string | undefined;
  const stderr = (text: string): void => io.stderr(root ? maskRoot(text, root) : text);
  try {
    const options = parseCheckArgs(argv, process.cwd());
    root = resolve(options.root);
    if (!isDirectory(root)) throw new Error("the root <root> is not an existing directory");
    if (options.docs === undefined) throw new Error("flag --docs is required: --docs=<dir>");
    const config = mergeMapConfig({}, loadConfigFile(root, options.config));
    const label = isAbsolutePath(options.docs)
      ? "<docs>"
      : `<root>/${options.docs.replace(/\\/g, "/")}`;
    const docs = readDocs(resolve(root, options.docs), label);
    const measured = await collectMetrics(root, {
      allowlistPath: resolve(root, config.duplicateAllowlist),
    });
    const markers = [NO_VERIFICATION_MARKER];
    if (config.verificationMarker !== null && !markers.includes(config.verificationMarker)) {
      markers.push(config.verificationMarker);
    }
    const verdict = verifyDocs(docs, measured, markers);
    if (verdict.problems.length > 0) {
      stderr(`${verdict.problems.join("\n")}\n`);
      return 1;
    }
    io.stdout(passText(verdict));
    return 0;
  } catch (err) {
    stderr(`repo-tools check: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
