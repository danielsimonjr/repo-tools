/**
 * The docstring harness of the STE checker: a string of prose in, advisory findings out.
 *
 * Ported from the code-docs skill (`code_docs/ste.py`). It uses one sentence tier (20 words).
 * Every finding is advice (SHOULD), never a gate. The Markdown harness (`markdown.ts`) applies
 * the same rules as a gate, with two tiers.
 */
import {
  B,
  codePointLength,
  headCodePoints,
  pySplit,
  pySplitlines,
  pyStrip,
  reEscape,
  S,
} from "./py.ts";
import {
  AMBIGUOUS_SOURCE,
  MAX_WORDS_PROCEDURAL as MAX_WORDS,
  PASSIVE_SOURCE,
  rule,
  stripIdentifiers,
  WORDY,
} from "./rules.ts";

/** One finding: the rule id and its text. */
export type ProseFinding = [rule: string, detail: string];

const PASSIVE = rule(PASSIVE_SOURCE);
const AMBIGUOUS = rule(AMBIGUOUS_SOURCE);
const SENTENCE_END = rule(`(?<=[.!?])${S}+`);

/** Splits prose into sentences, crudely but predictably. */
function sentencesOf(text: string): string[] {
  const collapsed = pySplit(text).join(" ");
  return collapsed
    .split(SENTENCE_END)
    .map(pyStrip)
    .filter((s) => s !== "");
}

/** `text`, cut to `limit` code points with a closing ellipsis. */
function clip(text: string, limit = 60): string {
  return codePointLength(text) <= limit ? text : `${headCodePoints(text, limit - 1)}…`;
}

/**
 * Returns one `[rule, detail]` per STE deviation in `text`. Pass docstring text through
 * `proseOf` first. An empty list means the prose is clean.
 */
export function checkProse(text: string): ProseFinding[] {
  const findings: ProseFinding[] = [];
  for (const sentence of sentencesOf(text)) {
    const words = pySplit(sentence);
    if (words.length > MAX_WORDS) {
      findings.push([
        "STE-LEN",
        `sentence has ${words.length} words (limit ${MAX_WORDS}): '${clip(sentence)}'`,
      ]);
    }
    const passive = PASSIVE.exec(sentence);
    if (passive) {
      findings.push(["STE-VOICE", `possible passive voice '${passive[0]}' -- prefer active`]);
    }
    const ambiguous = AMBIGUOUS.exec(sentence);
    if (ambiguous) {
      findings.push(["STE-REF", `ambiguous '${ambiguous[1]}' -- name the thing it refers to`]);
    }
  }
  // Identifiers go first, so a word inside a symbol name ("utiliseCache()") is not reported.
  const prose = stripIdentifiers(text);
  for (const [phrase, better] of WORDY) {
    if (rule(`${B}${reEscape(phrase)}${B}`, "i").test(prose)) {
      findings.push(["STE-WORD", `'${phrase}' -- prefer '${better}'`]);
    }
  }
  return findings;
}

const SECTION_HEADER =
  /^(Args|Arguments|Returns|Raises|Yields|Examples|Attributes|Parameters|Notes?|See Also):?$/u;

/**
 * Returns only the prose of a docstring: tag lines (`@param`), doctest lines, section headers,
 * rules and fenced code are removed, and the remaining lines are joined with spaces.
 */
export function proseOf(doc: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const raw of pySplitlines(doc)) {
    const line = pyStrip(pyStrip(raw).replace(/^\*+/, ""));
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line.startsWith("@") || line.startsWith(">>>")) continue;
    if (SECTION_HEADER.test(line)) continue;
    if (/^-{3,}$/u.test(line)) continue;
    out.push(line);
  }
  return out.filter((p) => p !== "").join(" ");
}
