/**
 * Reads the discovered files and runs the analyser of each language.
 *
 * Ported from `analyse_repo` of `code_docs.py`. A file that cannot be read is an unparsed file with
 * the reason in `error`, so it never counts as clean.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { discover, languageOf } from "./discovery.ts";
import { type FileReport, newReport } from "./model.ts";
import { analysePython } from "./python.ts";
import { analyseTypeScript } from "./typescript.ts";

const decoder = new TextDecoder("utf-8", { fatal: true });

/** Why a read failed, in words that do not depend on the operating system. */
function readFailure(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return "the file is tracked but missing from the work tree";
  if (error instanceof TypeError) return "the file is not valid UTF-8";
  return code ?? String(error);
}

/**
 * The text of a file, as the analysers read it: UTF-8 without a byte order mark, and with LF line
 * ends. The line numbers of the report are the line numbers of the file.
 */
export function readSourceText(path: string): string {
  return decoder.decode(readFileSync(path)).replace(/\r\n?/g, "\n");
}

/** Analyses one file. A read failure is a field of the report. */
export async function analyseFile(root: string, rel: string): Promise<FileReport> {
  const language = languageOf(rel);
  let source: string;
  try {
    source = readSourceText(join(root, rel));
  } catch (error) {
    const report = newReport(rel, language);
    report.error = `unreadable: ${readFailure(error)}`;
    return report;
  }
  return language === "python" ? analysePython(rel, source) : analyseTypeScript(rel, source);
}

/** The result of a run over a root. */
export interface RepoAnalysis {
  reports: FileReport[];
  provenance: string;
}

/** Analyses every source file that discovery finds below `root`. */
export async function analyseRepo(root: string): Promise<RepoAnalysis> {
  const { files, provenance } = discover(root);
  const reports: FileReport[] = [];
  for (const rel of files) reports.push(await analyseFile(root, rel));
  return { reports, provenance };
}
