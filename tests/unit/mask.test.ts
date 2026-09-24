import { describe, expect, test } from "bun:test";
import { blankCommentsAndStrings, stripComments } from "../../src/mask.ts";

/** The template interpolation opener, built so no string literal holds it. */
const O = "$" + "{";

describe("blankCommentsAndStrings", () => {
  test("blanks comments and string text and keeps offsets and line breaks", () => {
    const src = "const a = 'x // y'; // note\n/* block\n */ const b = \"q\";";
    const out = blankCommentsAndStrings(src);
    expect(out.length).toBe(src.length);
    expect(out.split("\n").length).toBe(src.split("\n").length);
    expect(out).toBe("const a = '      ';        \n        \n    const b = \" \";");
  });

  test("keeps the code inside a template interpolation", () => {
    const src = `\`a ${O}f({ k: 1 })} b\` + x`;
    expect(blankCommentsAndStrings(src)).toBe(`\`  ${O}f({ k: 1 })}  \` + x`);
  });

  test("handles escaped quotes and nested templates", () => {
    const src = `'it\\'s' + \`o ${O}\`i ${O}z}\`}\``;
    const out = blankCommentsAndStrings(src);
    expect(out).toBe(`'     ' + \`  ${O}\`  ${O}z}\`}\``);
  });
});

describe("stripComments", () => {
  test("removes comments and keeps string text", () => {
    const src = "a('//not'); // gone\nb(); /* gone */ c();";
    expect(stripComments(src)).toBe("a('//not'); \nb();  c();");
  });
});
