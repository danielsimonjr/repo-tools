/**
 * The language registry of `repo-tools docs`: one entry for each language that the command reads.
 * Discovery, analysis, the stub writer, the help text and the refusal of an unreadable repository
 * read this list. No other module of `docs` names a language.
 */
import { CSHARP_SKIP_DIRS, suffixOf } from "../map/discovery.ts";
import { analyseCFamily, parsesAsCFamily } from "./cfamily.ts";
import { analyseCSharp, parsesAsCSharp } from "./csharp.ts";
import { analyseGo, parsesAsGo } from "./go.ts";
import { analyseJava, parsesAsJava } from "./java.ts";
import { analyseKotlin, parsesAsKotlin } from "./kotlin.ts";
import type { FileReport } from "./model.ts";
import { analysePhp, parsesAsPhp } from "./php.ts";
import { analysePython, parsesAsPython } from "./python.ts";
import { analyseRuby, parsesAsRuby } from "./ruby.ts";
import { analyseRust, parsesAsRust } from "./rust.ts";
import { analyseTypeScript, parsesAsTypeScript } from "./typescript.ts";

/** One language that `docs` reads. */
export interface LanguageSpec {
  /** The id in reports and in `coverage.json`. It is also the key of the `map` census. */
  id: string;
  /** The names of the language in help and error text. One entry can read several languages. */
  names: readonly string[];
  /** The file suffixes of the language, with the dot. Two languages never share a suffix. */
  suffixes: ReadonlySet<string>;
  /**
   * The folders that hold generated files of this language only, for example `obj` and `bin` of a
   * C# build. A file of the language below such a folder is not source. The list does not apply
   * to the files of other languages: a `bin/` folder of Python scripts is source.
   */
  skipDirs: ReadonlySet<string>;
  /** Analyses one file. */
  analyse: (path: string, source: string) => Promise<FileReport>;
  /** True when `text` still parses as the language. The stub writer calls `parses` on each result. */
  parses: (path: string, text: string) => boolean;
  /** Where a stub goes: inside the body below the signature, or above the declaration. */
  stubPosition: "inside" | "above";
  /** The ids of the styles that `stub --style=` accepts for the language. */
  styles: readonly string[];
  /** The style of a stub when `--style` is absent. */
  defaultStyle: string;
}

/** Every language that `docs` reads, in the order of the help text. */
export const LANGUAGES: readonly LanguageSpec[] = [
  {
    id: "typescript",
    names: ["TypeScript", "JavaScript"],
    suffixes: new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]),
    skipDirs: new Set(),
    analyse: analyseTypeScript,
    parses: parsesAsTypeScript,
    stubPosition: "above",
    styles: ["tsdoc", "jsdoc"],
    defaultStyle: "tsdoc",
  },
  {
    id: "python",
    names: ["Python"],
    suffixes: new Set([".py"]),
    skipDirs: new Set(),
    analyse: analysePython,
    parses: (_path, text) => parsesAsPython(text),
    stubPosition: "inside",
    styles: ["google", "numpy", "rest"],
    defaultStyle: "google",
  },
  {
    id: "csharp",
    names: ["C#"],
    suffixes: new Set([".cs"]),
    skipDirs: CSHARP_SKIP_DIRS,
    analyse: analyseCSharp,
    parses: parsesAsCSharp,
    stubPosition: "above",
    styles: ["xmldoc"],
    defaultStyle: "xmldoc",
  },
  {
    id: "rust",
    names: ["Rust"],
    suffixes: new Set([".rs"]),
    skipDirs: new Set(),
    analyse: analyseRust,
    parses: parsesAsRust,
    stubPosition: "above",
    styles: ["rustdoc"],
    defaultStyle: "rustdoc",
  },
  {
    id: "go",
    names: ["Go"],
    suffixes: new Set([".go"]),
    skipDirs: new Set(),
    analyse: analyseGo,
    parses: parsesAsGo,
    stubPosition: "above",
    styles: ["godoc"],
    defaultStyle: "godoc",
  },
  {
    id: "java",
    names: ["Java"],
    suffixes: new Set([".java"]),
    skipDirs: new Set(),
    analyse: analyseJava,
    parses: parsesAsJava,
    stubPosition: "above",
    styles: ["javadoc"],
    defaultStyle: "javadoc",
  },
  {
    id: "kotlin",
    names: ["Kotlin"],
    suffixes: new Set([".kt", ".kts"]),
    skipDirs: new Set(),
    analyse: analyseKotlin,
    parses: parsesAsKotlin,
    stubPosition: "above",
    styles: ["kdoc"],
    defaultStyle: "kdoc",
  },
  {
    // One entry reads C and C++: a style names one language id, so the two cannot be two entries.
    id: "cpp",
    names: ["C", "C++"],
    suffixes: new Set([".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"]),
    skipDirs: new Set(),
    analyse: analyseCFamily,
    parses: parsesAsCFamily,
    stubPosition: "above",
    styles: ["doxygen"],
    defaultStyle: "doxygen",
  },
  {
    id: "php",
    names: ["PHP"],
    suffixes: new Set([".php"]),
    skipDirs: new Set(),
    analyse: analysePhp,
    parses: parsesAsPhp,
    stubPosition: "above",
    styles: ["phpdoc"],
    defaultStyle: "phpdoc",
  },
  {
    id: "ruby",
    names: ["Ruby"],
    suffixes: new Set([".rb"]),
    skipDirs: new Set(),
    analyse: analyseRuby,
    parses: parsesAsRuby,
    stubPosition: "above",
    styles: ["yard"],
    defaultStyle: "yard",
  },
];

/** The entry of the language `id`, or undefined. */
export function specOf(id: string): LanguageSpec | undefined {
  return LANGUAGES.find((spec) => spec.id === id);
}

/** The entry of the language of `path` by its suffix, or undefined when `docs` does not read it. */
export function specForPath(path: string): LanguageSpec | undefined {
  // The match is case-sensitive, as the census of `map` is.
  const suffix = suffixOf(path.slice(path.lastIndexOf("/") + 1));
  return LANGUAGES.find((spec) => spec.suffixes.has(suffix));
}

/** Every name of every language, joined for prose with `conjunction`: "A, B and C". */
export function languageNames(conjunction: "and" | "or" = "and"): string {
  const names = LANGUAGES.flatMap((spec) => spec.names);
  return names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} ${conjunction} ${names.at(-1)}`;
}
