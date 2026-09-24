import type { Loop } from './loop.js';

/** A shape. */
export interface ZedShape {
  loop?: Loop;
}

export function zed(): ZedShape {
  return {};
}
