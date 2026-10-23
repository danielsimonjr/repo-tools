/**
 * The clone detector (design section 17.6): exact groups, shingle scores, the thresholds, the rare
 * shingle cap, the containment rule, the nesting rule and the order of the pairs. The units here
 * are label sequences; no source is parsed.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { type DetectParams, detect } from "../../src/clones/detect.ts";
import type { Unit } from "../../src/clones/units.ts";

const PARAMS: DetectParams = {
  shingleLength: 6,
  nearThreshold: 0.6,
  containmentThreshold: 0.9,
  containmentMinShingles: 20,
  rareShingleLimit: 60,
  minSharedShingles: 3,
};

/** Labels `prefix0 ... prefix(n-1)`: every shingle of the sequence is unique. */
function seq(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`);
}

/** Replaces the labels from `from` to `to - 1` with `x` labels. */
function mutate(labels: string[], from: number, to: number): string[] {
  return labels.map((l, i) => (i >= from && i < to ? `x${i}` : l));
}

let counter = 0;

/** A unit with the label sequence `labels`. */
function unit(
  labels: string[],
  extra: Partial<Pick<Unit, "file" | "startIndex" | "endIndex" | "names">> = {},
): Unit {
  counter += 1;
  return {
    file: extra.file ?? `f${counter}.ts`,
    name: `u${counter}`,
    container: "",
    kind: "function",
    exported: false,
    startLine: 1,
    endLine: 2,
    loc: 2,
    params: 0,
    async: false,
    nodes: labels.length,
    doc: "",
    exactHash: createHash("sha1").update(labels.join(" ")).digest("hex").slice(0, 16),
    textHash: `t${counter}`,
    startIndex: extra.startIndex ?? 0,
    endIndex: extra.endIndex ?? 100,
    labels,
    names: extra.names ?? new Set<string>(),
  };
}

describe("detect: exact groups", () => {
  test("units with one label sequence form a group; a lone unit does not", () => {
    const a = unit(seq("n", 60));
    const b = unit(seq("n", 60));
    const c = unit(seq("m", 60));
    const d = unit(seq("n", 60));
    const result = detect([a, b, c, d], PARAMS);
    expect(result.exactGroups).toEqual([[0, 1, 3]]);
  });

  test("text groups use the text hash", () => {
    const a = unit(seq("n", 60));
    const b = unit(seq("m", 60));
    b.textHash = a.textHash;
    expect(detect([a, b], PARAMS).textGroups).toEqual([[0, 1]]);
  });

  test("an exact group is also a near pair with jStruct 1", () => {
    const names = new Set(["a"]);
    const result = detect([unit(seq("n", 60), { names }), unit(seq("n", 60), { names })], PARAMS);
    expect(result.near).toEqual([{ a: 0, b: 1, jStruct: 1, contain: 1, jNames: 1 }]);
  });
});

describe("detect: near pairs", () => {
  const base = seq("n", 60);
  const near = mutate(base, 10, 15);

  test("a copy with a few changed labels is a near pair with the expected scores", () => {
    const result = detect([unit(base), unit(near), unit(seq("z", 60))], PARAMS);
    expect(result.exactGroups).toEqual([]);
    expect(result.near).toHaveLength(1);
    const pair = result.near[0];
    expect(pair?.a).toBe(0);
    expect(pair?.b).toBe(1);
    // 55 shingles each; the five changed labels break 10 of them, so 45 are shared.
    expect(pair?.jStruct).toBe(Number((45 / 65).toFixed(3)));
    expect(pair?.contain).toBe(Number((45 / 55).toFixed(3)));
  });

  test("the name sets give jNames", () => {
    const a = unit(base, { names: new Set(["a", "b", "c", "d"]) });
    const b = unit(near, { names: new Set(["c", "d", "e", "f"]) });
    expect(detect([a, b], PARAMS).near[0]?.jNames).toBe(Number((2 / 6).toFixed(3)));
  });

  test("two empty name sets give jNames 0, not NaN", () => {
    expect(detect([unit(base), unit(near)], PARAMS).near[0]?.jNames).toBe(0);
  });

  test("nearThreshold removes a pair that scores below it", () => {
    const units = [unit(base), unit(near)];
    expect(detect(units, { ...PARAMS, nearThreshold: 0.69 }).near).toHaveLength(1);
    expect(detect(units, { ...PARAMS, nearThreshold: 0.7, containmentThreshold: 1 }).near).toEqual(
      [],
    );
  });

  test("minSharedShingles removes a pair that shares fewer rare shingles", () => {
    const units = [unit(base), unit(near)];
    expect(detect(units, { ...PARAMS, minSharedShingles: 45 }).near).toHaveLength(1);
    expect(detect(units, { ...PARAMS, minSharedShingles: 46 }).near).toHaveLength(0);
  });

  test("rareShingleLimit skips a shingle that occurs in more units than the limit", () => {
    const units = [unit(base), unit(near)];
    expect(detect(units, { ...PARAMS, rareShingleLimit: 2 }).near).toHaveLength(1);
    expect(detect(units, { ...PARAMS, rareShingleLimit: 1 }).near).toHaveLength(0);
  });

  test("shingleLength changes the shingles: a unit shorter than it has none", () => {
    const short = seq("n", 5);
    expect(detect([unit(short), unit(short)], PARAMS).near).toEqual([]);
    expect(detect([unit(short), unit(short)], PARAMS).exactGroups).toEqual([[0, 1]]);
  });

  test("unrelated units give no pair", () => {
    expect(detect([unit(seq("a", 80)), unit(seq("b", 80))], PARAMS).near).toEqual([]);
  });
});

describe("detect: containment", () => {
  // The small unit is the first 30 labels of the big one: all 25 shingles of the small unit are in
  // the big one (75 shingles), so contain is 1 and jStruct is 25/75.
  const big = seq("n", 80);
  const small = big.slice(0, 30);

  test("a unit inside a bigger unit is a near pair by containment", () => {
    const result = detect([unit(big), unit(small)], PARAMS);
    expect(result.near).toHaveLength(1);
    expect(result.near[0]?.contain).toBe(1);
    expect(result.near[0]?.jStruct).toBeLessThan(0.6);
  });

  test("containmentMinShingles keeps a very small unit out", () => {
    expect(
      detect([unit(big), unit(small)], { ...PARAMS, containmentMinShingles: 26 }).near,
    ).toEqual([]);
  });

  test("containmentThreshold decides the rule", () => {
    const part = mutate(big, 20, 22).slice(0, 30);
    // The two changed labels break the 7 shingles that start at 15 to 21, so contain is 18/25.
    const units = [unit(big), unit(part)];
    expect(detect(units, { ...PARAMS, containmentThreshold: 0.72 }).near).toHaveLength(1);
    expect(detect(units, { ...PARAMS, containmentThreshold: 0.73 }).near).toHaveLength(0);
  });
});

describe("detect: nesting and order", () => {
  test("a unit never pairs with the unit that contains it", () => {
    const body = seq("n", 80);
    const outer = unit(body, { file: "same.ts", startIndex: 0, endIndex: 1000 });
    const inner = unit(body.slice(0, 40), { file: "same.ts", startIndex: 100, endIndex: 400 });
    expect(detect([outer, inner], PARAMS).near).toEqual([]);
  });

  test("the same two units in different files do pair", () => {
    const body = seq("n", 80);
    const outer = unit(body, { file: "a.ts", startIndex: 0, endIndex: 1000 });
    const inner = unit(body.slice(0, 40), { file: "b.ts", startIndex: 100, endIndex: 400 });
    expect(detect([outer, inner], PARAMS).near).toHaveLength(1);
  });

  test("two units side by side in one file do pair", () => {
    const body = seq("n", 80);
    const one = unit(body, { file: "same.ts", startIndex: 0, endIndex: 400 });
    const two = unit(body, { file: "same.ts", startIndex: 500, endIndex: 900 });
    expect(detect([one, two], PARAMS).near).toHaveLength(1);
  });

  test("the pairs are in the order of jStruct, then of the two ids", () => {
    const base = seq("n", 60);
    const units = [
      unit(base),
      unit(mutate(base, 10, 15)),
      unit(mutate(base, 30, 31)),
      unit(mutate(base, 10, 15)),
    ];
    const order = detect(units, PARAMS).near.map((p) => `${p.a}-${p.b}`);
    // 1 and 3 are exact copies (jStruct 1), then the one-label change, then the five-label change.
    expect(order[0]).toBe("1-3");
    const scores = detect(units, PARAMS).near.map((p) => p.jStruct);
    expect(scores).toEqual([...scores].sort((x, y) => y - x));
  });

  test("two runs give the same result", () => {
    const base = seq("n", 60);
    const units = [unit(base), unit(mutate(base, 10, 15)), unit(mutate(base, 3, 9))];
    expect(JSON.stringify(detect(units, PARAMS))).toBe(JSON.stringify(detect(units, PARAMS)));
  });
});
