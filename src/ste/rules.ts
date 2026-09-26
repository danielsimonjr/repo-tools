/**
 * The ASD-STE100 rule core: the one set of rules that both STE harnesses use.
 *
 * Ported from `ste_rules.py`, which the architecture-docs and code-docs skills kept as two
 * byte-identical copies. This module holds rules only: no I/O, no file walk and no severity. The
 * Markdown harness (`markdown.ts`) and the docstring harness (`prose.ts`) apply them.
 *
 * Every list is the union of two sets that the two skills developed separately; neither set held
 * the other. A regex here is a source string, so each harness can add the flags that it needs.
 * All of them need the `u` flag, because `W`, `B` and `S` use Unicode property classes.
 */
import { B, ci, S, W } from "../py.ts";

/** Past participles with no -ed or -en end ("The tests are run by CI"). */
export const IRREGULAR_PARTICIPLES =
  "read|built|sent|held|kept|made|found|put|set|run|lost|left|met|paid|told" +
  "|thrown|drawn|given|taken|shown|known|grown|blown" +
  "|cut|meant|dealt|felt|sold|said|spent|split|shut|hit|let|bred|fed|led";

/** Words that start a noun phrase, so the word after "by" is an agent, not an adverbial. */
export const DETERMINERS =
  "the|a|an|its|their|this|that|our|your|each|every" + "|his|her|my|these|those";

/**
 * A form of "be", a past participle, "by" and an agent that looks like a noun phrase.
 *
 * Two guards: "by" separates the passive from a state ("the file is closed"), and the noun
 * phrase separates an agent from an adverbial ("sorted by name"). Only the word lists match
 * without case (`ci`); a global case flag would make `[A-Z]` match lower case and defeat guard 2.
 */
export const PASSIVE_SOURCE =
  `${B}(?:${ci("is|are|was|were|be|been|being")})${S}+` +
  `(?:${W}+(?:${ci("ed|en")})|(?:${ci(IRREGULAR_PARTICIPLES)}))${S}+` +
  `by${S}+(?:(?:${ci(DETERMINERS)})${B}|[A-Z\`])`;

/** The verbs that can follow a demonstrative in an ambiguous reference. */
const AMBIGUOUS_VERBS =
  "is|are|was|were|be|will|can|may|must|does|do|has|have|should|shall" +
  "|disables?|enables?|causes?|returns?|means?|allows?|prevents?|makes?" +
  "|sets?|gets?|adds?|removes?|creates?|requires?|affects?|applies|happens?";

/**
 * A demonstrative with no noun after it, at the start of a clause: the start of the text, or
 * after `. ! ? , ; :`, with an optional conjunction between ("..., and this causes ...").
 * Group 1 is the demonstrative.
 */
export const AMBIGUOUS_SOURCE =
  `(?:^|(?<=[.!?,;:])${S})${S}*(?:(?:${ci("and|but|or|so|then|yet")})${S}+)?` +
  `(${ci("it|this|that|these|those")})${S}+(?:${AMBIGUOUS_VERBS})${B}`;

/**
 * Wordy constructions with a shorter approved form, in the order of the source map. Each entry
 * is a construction or a spelling variant with one clear replacement, not a vocabulary.
 */
export const WORDY: readonly (readonly [string, string])[] = [
  ["in order to", "to"],
  ["at this point in time", "now"],
  ["in the event that", "if"],
  ["due to the fact that", "because"],
  ["a number of", "some"],
  ["utilise", "use"],
  ["utilize", "use"],
  ["prior to", "before"],
  ["subsequent to", "after"],
  ["in the case of", "for"],
  ["in spite of the fact that", "although"],
  ["for the purpose of", "to"],
  ["has the ability to", "can"],
  ["is able to", "can"],
];

/**
 * Code-like tokens, removed before a prose rule runs: an inline code span, a call, a camelCase or
 * PascalCase name, a snake_case name and a dotted path. STE governs sentences, not symbol names.
 */
export const IDENTIFIER_SOURCE =
  "`[^`]*`" +
  `|${B}${W}+\\(\\)` +
  `|${B}${W}*[a-z]${W}*[A-Z]${W}*${B}` +
  `|${B}${W}+_${W}+${B}` +
  `|${B}${W}+\\.${W}+${B}`;

/** The word limit of a procedural sentence. */
export const MAX_WORDS_PROCEDURAL = 20;
/** The word limit of a descriptive sentence. */
export const MAX_WORDS_DESCRIPTIVE = 25;

/** A new regex from a rule source, with the `u` flag and the extra flags `flags`. */
export function rule(source: string, flags = ""): RegExp {
  return new RegExp(source, `u${flags}`);
}

/** `text` with each code-like token replaced by one space. */
export function stripIdentifiers(text: string): string {
  return text.replace(rule(IDENTIFIER_SOURCE, "g"), " ");
}
