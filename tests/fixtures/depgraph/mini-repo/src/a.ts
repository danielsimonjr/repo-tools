/**
 * Lower-case name: sorts after `B.ts` in code-unit order.
 */
import { helper } from './_x.js';

/** Options for alpha. */
export interface AlphaOptions {
  loud: boolean;
}

/** Returns a greeting. */
export function alpha(name: string, options?: AlphaOptions): string {
  const text = helper(name);
  return options?.loud ? text.toUpperCase() : text;
}

export const unusedConstant = 42;
