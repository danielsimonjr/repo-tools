/* A license header block comment
   that spans two lines. */

import { helper } from "./helper";

/** The default entry. */
export default function main(): number {
  return helper(1);
}


/* A plain block comment before an abstract class. */
export abstract class Shape {
  /** The area of the shape. */
  abstract area(): number;

  describe(): string {
    return `area ${this.area()}`;
  }
}

declare const VERSION: string;
declare function external(x: number): void;
export declare namespace Tools {
  const level: number;
}

// A line comment between statements.
console.log(main());

module.exports = {
  main,
  Shape,
};

if (VERSION) {
  external(1);
}

export const enum Mode {
  Fast,
  Slow,
}

function noSemicolons() {
  return 1
}
const asi = noSemicolons()
export const after = asi + 1

// A trailing comment at the end of the file.
