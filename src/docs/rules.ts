/**
 * The rules of the docstring spec that both language analysers apply, in one place.
 *
 * Ported from the `_apply_rules` functions of `python_lang.py` and `ts_lang.py`. The two copies
 * were equal except for two detail texts and the S5 test, so the port has one function that takes
 * those three as options. The MUST tier holds exactly what a tool can decide from a parse:
 *
 * - M1: an exported symbol has a doc.
 * - M2: the doc has a summary line.
 * - M3: no documented parameter is absent from the signature.
 * - M4: no unfilled stub marker.
 *
 * Rule M5 (one dialect per file) is a property of the file, so the gate checks it.
 */
import { checkProse } from "../ste/prose.ts";
import { type DocSymbol, STUB_MARKER } from "./model.ts";

/**
 * A path of a test file. A test file is exempt from M1 only: its name documents it, and a required
 * doc comment would be filler. M3, M4 and M5 still apply, because a stale doc is wrong anywhere.
 */
const TEST_PATH =
  /(^|\/)(tests?|__tests__|spec)\/|(^|\/)test_[^/]*$|_test\.[^/]+$|\.(test|spec)\.[^/]+$/;

/** True when `path` holds tests, not shipped source. */
export function isTestFile(path: string): boolean {
  return TEST_PATH.test(path.replace(/\\/g, "/"));
}

/** How a language words its details, and the two checks that only it can decide. */
export interface RuleOptions {
  /** The noun in the M1 and M2 details: `docstring` or `doc comment`. */
  noun: string;
  /** The detail of S5 when the doc restates a type that the signature holds, otherwise null. */
  restatesType: string | null;
  /** The prose of the doc, without delimiters and tags, for the STE check (S6). */
  prose: string;
}

/**
 * Adds the issues of `doc` to `sym`, in the order M1, M2, M3, M4, S2, S5, S6. An exported symbol
 * with no doc gets M1 and nothing else, because every other rule reads the doc.
 */
export function applyRules(sym: DocSymbol, doc: string, path: string, options: RuleOptions): void {
  if (sym.exported && !sym.hasDoc && !isTestFile(path)) {
    sym.issues.push({ rule: "M1", tier: "MUST", detail: `exported symbol has no ${options.noun}` });
    return;
  }
  if (!sym.hasDoc) return;
  if (!sym.summary) {
    sym.issues.push({ rule: "M2", tier: "MUST", detail: `${options.noun} has no summary line` });
  }
  for (const p of sym.docParams) {
    if (!sym.params.includes(p)) {
      sym.issues.push({
        rule: "M3",
        tier: "MUST",
        detail: `documents parameter '${p}' which is not in the signature`,
      });
    }
  }
  if (doc.includes(STUB_MARKER)) {
    sym.issues.push({
      rule: "M4",
      tier: "MUST",
      detail: "unfilled stub marker left by `stub`",
    });
  }
  // The SHOULD tier is reported and never gated.
  if (sym.summary && !sym.summary.endsWith(".")) {
    sym.issues.push({ rule: "S2", tier: "SHOULD", detail: "summary does not end with a period" });
  }
  if (options.restatesType !== null) {
    sym.issues.push({ rule: "S5", tier: "SHOULD", detail: options.restatesType });
  }
  for (const [rule, detail] of checkProse(options.prose)) {
    sym.issues.push({ rule: `S6/${rule}`, tier: "SHOULD", detail });
  }
}
