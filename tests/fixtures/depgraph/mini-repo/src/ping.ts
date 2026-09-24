import { pong } from './pong.js';

/** Runtime cycle with pong.ts. */
export function ping(n: number): number {
  return n <= 0 ? 0 : pong(n - 1);
}
