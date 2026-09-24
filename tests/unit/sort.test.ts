import { describe, expect, test } from "bun:test";
import { compareCodeUnits, sortCodeUnits } from "../../src/sort.ts";

describe("code-unit order (F22)", () => {
  test("upper case sorts before lower case, and '_' between them", () => {
    expect(sortCodeUnits(["a.ts", "B.ts", "_x.ts", "Z", "b.ts"])).toEqual([
      "B.ts",
      "Z",
      "_x.ts",
      "a.ts",
      "b.ts",
    ]);
  });

  test("the order is independent of the input order and of the locale", () => {
    const names = ["é", "e", "f", "E", "10", "9"];
    const a = sortCodeUnits(names);
    const b = sortCodeUnits([...names].reverse());
    expect(a).toEqual(b);
    expect(a).toEqual(["10", "9", "E", "e", "f", "é"]);
  });

  test("sortCodeUnits does not change its input", () => {
    const names = ["b", "a"];
    sortCodeUnits(names);
    expect(names).toEqual(["b", "a"]);
  });

  test("compareCodeUnits is a total order", () => {
    expect(compareCodeUnits("a", "a")).toBe(0);
    expect(compareCodeUnits("a", "b")).toBeLessThan(0);
    expect(compareCodeUnits("b", "a")).toBeGreaterThan(0);
  });
});
