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

/**
 * TODO: state what this does, in one active-voice sentence.
 *
 * @param a - TODO: state what it is. Do not repeat the type.
 * @param b - TODO: state what it is. Do not repeat the type.
 * @returns TODO: state what the caller gets back.
 */
export function sub(a: number, b: number): number {
  return a - b;
}

/**
 * TODO: state what this does, in one active-voice sentence.
 */
export class Counter {
  count = 0;

  increment(step: number): void {
    this.count += step;
  }
}

/**
 * TODO: state what this does, in one active-voice sentence.
 */
export interface Shape {
  area(): number;
}

/**
 * TODO: state what this does, in one active-voice sentence.
 */
export type Id = string;

export const twice = (n: number): number => n * 2;

function hidden(): void {}
