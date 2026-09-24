import { readFileSync } from "node:fs";
import {
  join,
  dirname,
} from "node:path";
import type { Stats } from "node:fs";

// A top-level comment with braces { that } must not count.

/**
 * A template literal that spans lines and holds braces.
 */
export function render(name: string): string {
  const body = `line one {
  ${name.replace(/"/g, "'")} and ${"nested } string"}
  line three }`;
  return body;
}

/* A block comment with { an open brace */
export const QUOTE_RE = /"/g;

export function escaped(): string {
  const a = "a \"quoted\" { brace";
  const b = 'it\'s } here';
  return a + b; // trailing comment with { brace
}

/* A block comment
   that spans lines { and holds a brace
*/
export class Box {
  private value = 0;

  get size(): number {
    return this.value;
  }

  add(n: number): void {
    this.value += n;
  }
}

export interface Shape {
  kind: "box" | "ball";
}

export type Pair<T> = [T, T];

export enum Color {
  Red,
  Green,
}

const helper = (x: number) => {
  return `${x}`;
};

export const LIMIT = 10;
