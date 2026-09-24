/** Reachable only through the `./util` exports subpath. */
export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
