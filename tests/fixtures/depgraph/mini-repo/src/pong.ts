import { ping } from './ping.js';

export function pong(n: number): number {
  return n <= 0 ? 1 : ping(n - 1);
}
