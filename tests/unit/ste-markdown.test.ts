/**
 * The Markdown harness of the STE checker (`checkMarkdown`): tiers, line numbers, blocks and the
 * text that the harness removes before a rule runs. Each expected string was checked against
 * the source checker (`ste_check.py` of the architecture-docs skill) on the same input.
 */
import { describe, expect, test } from "bun:test";
import { checkMarkdown } from "../../src/ste/markdown.ts";

const words = (n: number, w = "word"): string =>
  Array.from({ length: n }, (_, i) => `${w}${i}`).join(" ");

describe("checkMarkdown: sentence length", () => {
  test("a descriptive sentence may have 25 words, not 26", () => {
    expect(checkMarkdown("d.md", `# T\n\n${words(25)}.\n`)).toEqual([]);
    expect(checkMarkdown("d.md", `# T\n\n${words(26)}.\n`)).toEqual([
      `d.md:~3: 26 words (>25 descriptive): ${`${words(26)}.`.slice(0, 90)}`,
    ]);
  });

  test("a procedural block (a numbered step) may have 20 words, not 21", () => {
    expect(checkMarkdown("p.md", `1. ${words(20)}.\n`)).toEqual([]);
    expect(checkMarkdown("p.md", `1. ${words(21)}.\n`)).toEqual([
      // The splitter cuts after the "1." marker, so the finding quotes the text without it.
      `p.md:~1: 21 words (>20 procedural): ${`${words(21)}.`.slice(0, 90)}`,
    ]);
  });

  test("a wrapped paragraph is measured as one sentence", () => {
    const text = `# T\n\n${words(13)}\n${words(13, "more")}.\n`;
    expect(checkMarkdown("w.md", text)).toEqual([
      `w.md:~3: 26 words (>25 descriptive): ${`${words(13)} ${words(13, "more")}.`.slice(0, 90)}`,
    ]);
  });

  test("each list item is its own block", () => {
    const text = `- ${words(15)}\n- ${words(15)}\n`;
    expect(checkMarkdown("l.md", text)).toEqual([]);
  });

  test("a decimal number and bold text do not split or join sentences", () => {
    expect(
      checkMarkdown("n.md", "The value is 1.5 units. The tool reads **the file.** It ends.\n"),
    ).toEqual([]);
  });
});

describe("checkMarkdown: the rules and their line numbers", () => {
  test("a wordy form on a wrapped line names that line", () => {
    const text = "# T\n\nThe tool reads the file\nin order to write a report.\n";
    expect(checkMarkdown("w.md", text)).toEqual(["w.md:4: wordy: 'in order to' - prefer 'to'"]);
  });

  test("a wordy form is lower case only, so a capitalised name is not flagged", () => {
    expect(checkMarkdown("c.md", "In Order To Win is a game.\n")).toEqual([]);
  });

  test("an ambiguous reference at a clause start is flagged, a wrapped line is not", () => {
    expect(checkMarkdown("a.md", "The flag is set. This causes a reload.\n")).toEqual([
      "a.md:1: ambiguous reference: 'This causes'",
    ]);
    expect(checkMarkdown("a.md", "Step 3 applies when\nit does.\n")).toEqual([]);
  });

  test("passive voice with an agent is flagged with its line", () => {
    expect(checkMarkdown("v.md", "# T\n\nThe report is written by the generator.\n")).toEqual([
      "v.md:3: passive voice: 'is written by the'",
    ]);
  });

  test("the findings come in rule order: length, then wordy, ambiguous and passive per block", () => {
    const text = `This causes it in order to run.\n\n${words(26)}.\n`;
    expect(checkMarkdown("o.md", text)).toEqual([
      `o.md:~3: 26 words (>25 descriptive): ${`${words(26)}.`.slice(0, 90)}`,
      "o.md:1: wordy: 'in order to' - prefer 'to'",
      "o.md:1: ambiguous reference: 'This causes'",
    ]);
  });
});

describe("checkMarkdown: text that STE does not govern", () => {
  const bad = "This causes the file to be read in order to run.";

  test("code fences, tables, headings, quotes and comments are removed", () => {
    for (const text of [
      `\`\`\`\n${bad}\n\`\`\`\n`,
      `| ${bad} |\n`,
      `## ${bad}\n`,
      `> ${bad}\n`,
      `<!-- ${bad} -->\n`,
      `- Not: ${bad}\n`,
    ]) {
      expect({ text, found: checkMarkdown("x.md", text) }).toEqual({ text, found: [] });
    }
  });

  test("YAML frontmatter is removed", () => {
    expect(checkMarkdown("f.md", `---\ntitle: ${bad}\n---\nThe tool reads the file.\n`)).toEqual(
      [],
    );
  });

  test("inline code, calls, identifiers and link targets are not prose", () => {
    const text = "Run `in order to` and utiliseCache() via [the guide](in-order-to.md).\n";
    expect(checkMarkdown("i.md", text)).toEqual([]);
  });
});
