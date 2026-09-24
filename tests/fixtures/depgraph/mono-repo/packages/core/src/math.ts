import type { Pair } from './types.js';

/** Adds the two numbers of a pair. */
export function add(pair: Pair): number {
  return pair[0] + pair[1];
}

/** Used only by the worker. */
export function double(n: number): number {
  return n * 2;
}
