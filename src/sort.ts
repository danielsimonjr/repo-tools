/**
 * Code-unit ordering (design fix F22).
 *
 * Every sort in repo-tools uses this order. `localeCompare` depends on the ICU data of the
 * runtime, so two machines can order the same names differently. Code-unit order depends on the
 * strings only.
 */

/** Compares two strings by UTF-16 code unit. Returns a negative, zero or positive number. */
export function compareCodeUnits(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Returns a sorted copy of `values` in code-unit order. The input is not changed. */
export function sortCodeUnits(values: readonly string[]): string[] {
  return [...values].sort(compareCodeUnits);
}
