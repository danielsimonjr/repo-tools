/**
 * The Markdown harness of the STE checker: a Markdown document in, gate findings out.
 *
 * Ported from the architecture-docs skill (`ste_check.py`). It removes the Markdown structure
 * that STE does not govern, joins the lines of a paragraph, and applies two sentence tiers
 * (20 words procedural, 25 descriptive), the wordy forms, the ambiguous references and the
 * passive voice. The rules come from `rules.ts`; the docstring harness (`prose.ts`) uses the same
 * rules with one tier.
 *
 * A finding names the file and the line: `name:line: text`. A sentence-length finding names the
 * first line of its paragraph as `name:~line`.
 */
import {
  B,
  D,
  headCodePoints,
  isAlnum,
  pyLstrip,
  pyRepr,
  pySplit,
  pySplitlines,
  pyStrip,
  reEscape,
  S,
} from "../py.ts";
import {
  AMBIGUOUS_SOURCE,
  IDENTIFIER_SOURCE,
  MAX_WORDS_DESCRIPTIVE,
  MAX_WORDS_PROCEDURAL,
  PASSIVE_SOURCE,
  rule,
  WORDY,
} from "./rules.ts";

/** One prose line: its line number (1-based) and its text. */
type Line = [line: number, text: string];

/**
 * The prose lines of `text`: YAML frontmatter, code fences, headings, tables, block quotes,
 * rules, HTML comments and "- Not:" counter-examples are removed.
 */
function stripNoise(text: string): Line[] {
  const out: Line[] = [];
  let inFence = false;
  const lines = pySplitlines(text);
  let start = 0;
  if (lines.length > 0 && pyStrip(lines[0] as string) === "---") {
    for (let j = 1; j < lines.length; j++) {
      if (pyStrip(lines[j] as string) === "---") {
        start = j + 1;
        break;
      }
    }
  }
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] as string;
    if (pyLstrip(line).startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const s = pyStrip(line);
    if (s === "" || s.startsWith("#") || s.startsWith("|") || s.startsWith(">")) continue;
    if (s.startsWith("---") || s.startsWith("<!--")) continue;
    // A "- Not:" line shows text that a writer must NOT copy, so it is wrong on purpose.
    if (s.startsWith("- Not:")) continue;
    out.push([i + 1, line]);
  }
  return out;
}

const LINK = /\[([^\]]*)\]\([^)]*\)/gu;
const IDENTIFIER = rule(IDENTIFIER_SOURCE, "g");

/**
 * `line` with the text that STE does not govern replaced by spaces of the same length: link
 * targets (the link text stays) and code-like tokens. The same length keeps each match offset
 * on its source line.
 */
function proseOnly(line: string): string {
  const s = line.replace(LINK, (m, text: string) => text + " ".repeat(m.length - text.length));
  return s.replace(IDENTIFIER, (m) => " ".repeat(m.length));
}

const EMPHASIS = /\*\*|__/gu;
const DECIMAL = rule(`(${D})\\.(${D})`, "g");
const SENTENCE_END = rule(`(?<=[.!?])${S}+`);

/** The sentences of a paragraph. A decimal number does not end a sentence. */
function sentences(block: string): string[] {
  const guarded = block.replace(EMPHASIS, "").replace(DECIMAL, "$1<DOT>$2");
  return guarded.split(SENTENCE_END).map((part) => part.replaceAll("<DOT>", "."));
}

const CODE_SPAN = /`[^`]*`/gu;
const EMPHASIS_CHARS = /[*_]/gu;
const LIST_MARKER = rule(`^${S}*[-*${D}.]+${S}*`);

/** The words of a sentence. Inline code counts as one word; a link counts as its text. */
function wordCount(sentence: string): number {
  const s = sentence
    .replace(CODE_SPAN, "X")
    .replace(LINK, "$1")
    .replace(EMPHASIS_CHARS, "")
    .replace(LIST_MARKER, "");
  return pySplit(s).filter((w) => Array.from(w).some(isAlnum)).length;
}

/** A paragraph: its first line, its joined text, and the source line of each character. */
type Block = [start: number, text: string, lineMap: number[]];

/** Joins the lines of a paragraph and maps each character of the result to its source line. */
function join(parts: Line[], start: number): Block {
  const chunks: string[] = [];
  const lineMap: number[] = [];
  parts.forEach(([n, body], i) => {
    if (i > 0) {
      chunks.push(" ");
      lineMap.push(n);
    }
    chunks.push(body);
    for (let k = 0; k < body.length; k++) lineMap.push(n);
  });
  return [start, chunks.join(""), lineMap];
}

/** The source line of a match, from its offset in the joined paragraph. */
function lineAt(index: number, lineMap: number[]): number {
  return lineMap.length > 0 ? (lineMap[Math.min(index, lineMap.length - 1)] as number) : 0;
}

const LIST_ITEM = rule(`^${S}*(?:[-*+]|${D}+\\.)${S}`);
const PROCEDURAL_STARTS = ["- [", "1.", "2.", "3.", "4.", "5.", "6."];
const WORDY_RULES = WORDY.map(
  ([phrase, better]) =>
    [phrase, better, rule(`(?<![\\p{L}\\p{N}_-])${reEscape(phrase)}${B}`, "g")] as const,
);
const AMBIGUOUS = rule(AMBIGUOUS_SOURCE, "g");
const PASSIVE = rule(PASSIVE_SOURCE, "g");

/** The paragraphs of a document. A list item starts a new paragraph. */
function paragraphs(text: string): Block[] {
  const blocks: Block[] = [];
  let para: Line[] = [];
  let paraStart = 0;
  let prevLine = -2;
  for (const [n, line] of stripNoise(text)) {
    const startsItem = LIST_ITEM.test(line);
    if ((n !== prevLine + 1 || startsItem) && para.length > 0) {
      blocks.push(join(para, paraStart));
      para = [];
    }
    if (para.length === 0) paraStart = n;
    para.push([n, pyStrip(line)]);
    prevLine = n;
  }
  if (para.length > 0) blocks.push(join(para, paraStart));
  return blocks;
}

/**
 * Returns the STE findings of the Markdown document `text`, in this order: the sentence lengths
 * of all paragraphs, then per paragraph the wordy forms, the ambiguous references and the
 * passive voice. `name` is the file name that each finding starts with.
 */
export function checkMarkdown(name: string, text: string): string[] {
  const problems: string[] = [];
  const blocks = paragraphs(text);
  for (const [start, block] of blocks) {
    const procedural = PROCEDURAL_STARTS.some((p) => pyLstrip(block).startsWith(p));
    const limit = procedural ? MAX_WORDS_PROCEDURAL : MAX_WORDS_DESCRIPTIVE;
    for (const sentence of sentences(block)) {
      const n = wordCount(sentence);
      if (n > limit) {
        const tier = procedural ? "procedural" : "descriptive";
        problems.push(
          `${name}:~${start}: ${n} words (>${limit} ${tier}): ${headCodePoints(pyStrip(sentence), 90)}`,
        );
      }
    }
  }
  // The rules scan the joined paragraph, not one line: a wrapped line is not a clause start.
  for (const [, block, lineMap] of blocks) {
    const bare = proseOnly(block);
    for (const [phrase, better, re] of WORDY_RULES) {
      // Lower case only: a capitalised form is how a technical name looks.
      for (const m of bare.matchAll(re)) {
        problems.push(
          `${name}:${lineAt(m.index, lineMap)}: wordy: ${pyRepr(phrase)} - prefer ${pyRepr(better)}`,
        );
      }
    }
    for (const m of bare.matchAll(AMBIGUOUS)) {
      problems.push(
        `${name}:${lineAt(m.index, lineMap)}: ambiguous reference: ${pyRepr(pyStrip(m[0]))}`,
      );
    }
    for (const m of bare.matchAll(PASSIVE)) {
      problems.push(`${name}:${lineAt(m.index, lineMap)}: passive voice: ${pyRepr(pyStrip(m[0]))}`);
    }
  }
  return problems;
}
