/**
 * Upper-case name: sorts before `a.ts` in code-unit order.
 */
import type { AlphaOptions } from './a.js';

export class Bravo {
  constructor(readonly options: AlphaOptions) {}

  async load(): Promise<string> {
    const mod = await import('./dyn.js');
    return mod.dynamicValue;
  }
}
