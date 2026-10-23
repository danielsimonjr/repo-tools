/**
 * The clone detector (design section 17.6) finds exact groups.
 * It groups items by hash.
 * It finds near pairs by shingle overlap.
 * It compares shingle sets of two label sequences.
 */
import type { Unit } from "./units.ts";

/** The settings that the detector reads. */
export interface DetectParams {
  shingleLength: number;
  nearThreshold: number;
  containmentThreshold: number;
  containmentMinShingles: number;
  rareShingleLimit: number;
  minSharedShingles: number;
}

/** A pair of units that look alike. `a` is the lower unit id. */
export interface NearPair {
  a: number;
  b: number;
  /** The Jaccard score of the two shingle sets. */
  jStruct: number;
  /** The shared shingles divided by the size of the smaller set. */
  contain: number;
  /** The Jaccard score of the two identifier name sets. */
  jNames: number;
}

/** The result of `detect`. A unit id is the index of the unit in the input. */
export interface Detection {
  exactGroups: number[][];
  textGroups: number[][];
  near: NearPair[];
}

/** The 32-bit FNV-1a hash of `text`. */
function fnv1a(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The groups of two or more unit ids that share the value `key` gives, in order of first member. */
function groupsBy(units: readonly Unit[], key: (unit: Unit) => string): number[][] {
  const groups = new Map<string, number[]>();
  units.forEach((unit, id) => {
    const ids = groups.get(key(unit));
    if (ids) ids.push(id);
    else groups.set(key(unit), [id]);
  });
  return [...groups.values()].filter((ids) => ids.length > 1);
}

/** The set of the hashed shingles of `labels`. */
function shinglesOf(labels: readonly string[], length: number): Set<number> {
  const set = new Set<number>();
  for (let i = 0; i + length <= labels.length; i++) {
    set.add(fnv1a(labels.slice(i, i + length).join("|")));
  }
  return set;
}

/** True when one unit lies inside the other in one file. */
function nested(a: Unit, b: Unit): boolean {
  if (a.file !== b.file) return false;
  const aInB = b.startIndex <= a.startIndex && a.endIndex <= b.endIndex;
  const bInA = a.startIndex <= b.startIndex && b.endIndex <= a.endIndex;
  return aInB || bInA;
}

/** The size of the intersection of two sets. */
function overlap<T>(small: ReadonlySet<T>, big: ReadonlySet<T>): number {
  let shared = 0;
  for (const item of small) if (big.has(item)) shared++;
  return shared;
}

/** Rounds a score to three decimals, as the report shows it. */
function round3(value: number): number {
  return Number(value.toFixed(3));
}

/** Finds the exact groups, the text groups and the near pairs of `units`. */
export function detect(units: readonly Unit[], params: DetectParams): Detection {
  const exactGroups = groupsBy(units, (u) => u.exactHash);
  const textGroups = groupsBy(units, (u) => u.textHash);

  const shingles = units.map((u) => shinglesOf(u.labels, params.shingleLength));
  const index = new Map<number, number[]>();
  shingles.forEach((set, id) => {
    for (const shingle of set) {
      const ids = index.get(shingle);
      if (ids) ids.push(id);
      else index.set(shingle, [id]);
    }
  });

  const near: NearPair[] = [];
  units.forEach((unit, id) => {
    const mine = shingles[id] as Set<number>;
    const shared = new Map<number, number>();
    for (const shingle of mine) {
      const ids = index.get(shingle) as number[];
      if (ids.length > params.rareShingleLimit) continue;
      for (const other of ids) if (other > id) shared.set(other, (shared.get(other) ?? 0) + 1);
    }
    for (const [other, count] of shared) {
      if (count < params.minSharedShingles) continue;
      const peer = units[other] as Unit;
      if (nested(unit, peer)) continue;
      const theirs = shingles[other] as Set<number>;
      const [small, big] = mine.size <= theirs.size ? [mine, theirs] : [theirs, mine];
      const inter = overlap(small, big);
      const jaccard = inter / (mine.size + theirs.size - inter);
      const contain = inter / small.size;
      const byContainment =
        contain >= params.containmentThreshold && small.size >= params.containmentMinShingles;
      if (jaccard < params.nearThreshold && !byContainment) continue;
      const common = overlap(unit.names, peer.names);
      const union = unit.names.size + peer.names.size - common;
      near.push({
        a: id,
        b: other,
        jStruct: round3(jaccard),
        contain: round3(contain),
        jNames: round3(common / (union || 1)),
      });
    }
  });
  near.sort((x, y) => y.jStruct - x.jStruct || x.a - y.a || x.b - y.b);
  return { exactGroups, textGroups, near };
}
