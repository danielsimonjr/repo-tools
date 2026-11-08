/**
 * Adds two numbers.
 *
 * @param a - The first number.
 * @param b - The second number.
 * @returns The sum.
 */
export function add(a: number, b: number): number {
  return a + b;
}

export function sub(a: number, b: number): number {
  return a - b;
}

export class Counter {
  count = 0;

  increment(step: number): void {
    this.count += step;
  }
}

export interface Shape {
  area(): number;
}

export type Id = string;

export const twice = (n: number): number => n * 2;

function hidden(): void {}
