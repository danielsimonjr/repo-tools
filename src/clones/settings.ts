/**
 * The settings of `repo-tools clones` (design section 17.5).
 * This module is the only place that holds a default.
 * The merge takes a flag first, then the `clones` section of the config file, then the default.
 */
import type { ClonesSettings } from "../config.ts";

/** The merged settings of one run. */
export interface ClonesConfig {
  /** The folders to read, relative to the root, or `"auto"` for the `src` area. */
  src: string[] | "auto";
  /** The folder for the two JSON files, relative to the root. `null`: write no file. */
  out: string | null;
  /** The smallest number of labels of a unit. */
  minNodes: number;
  /** The labels in one shingle. */
  shingleLength: number;
  /** The smallest Jaccard score of a near pair. */
  nearThreshold: number;
  /** The smallest containment of a near pair. */
  containmentThreshold: number;
  /** The smallest shingle count of the smaller unit, for the containment rule. */
  containmentMinShingles: number;
  /** A shingle in more units than this number does not pick candidate pairs. */
  rareShingleLimit: number;
  /** The rare shingles that a candidate pair must share. */
  minSharedShingles: number;
}

/** The default of each setting. A caller never changes this object. */
export const CLONES_DEFAULTS: Readonly<ClonesConfig> = Object.freeze({
  src: "auto",
  out: null,
  minNodes: 50,
  shingleLength: 6,
  nearThreshold: 0.6,
  containmentThreshold: 0.9,
  containmentMinShingles: 20,
  rareShingleLimit: 60,
  minSharedShingles: 3,
});

/**
 * Merges the command-line settings `cli`, the config-file settings `file` and the defaults.
 * A source that leaves out a setting (`undefined`) passes the setting to the next source.
 * A `null` in `out` is a value. The value `null` means that the run writes no file.
 */
export function mergeClonesConfig(cli: ClonesSettings, file: ClonesSettings): ClonesConfig {
  const d = CLONES_DEFAULTS;
  const src = cli.src ?? file.src ?? d.src;
  return {
    src: src === "auto" ? src : [...src],
    out: cli.out !== undefined ? cli.out : file.out !== undefined ? file.out : d.out,
    minNodes: cli.minNodes ?? file.minNodes ?? d.minNodes,
    shingleLength: cli.shingleLength ?? file.shingleLength ?? d.shingleLength,
    nearThreshold: cli.nearThreshold ?? file.nearThreshold ?? d.nearThreshold,
    containmentThreshold:
      cli.containmentThreshold ?? file.containmentThreshold ?? d.containmentThreshold,
    containmentMinShingles:
      cli.containmentMinShingles ?? file.containmentMinShingles ?? d.containmentMinShingles,
    rareShingleLimit: cli.rareShingleLimit ?? file.rareShingleLimit ?? d.rareShingleLimit,
    minSharedShingles: cli.minSharedShingles ?? file.minSharedShingles ?? d.minSharedShingles,
  };
}
