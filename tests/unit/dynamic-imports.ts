/**
 * Test fixtures of fix F25, shared with fix F26: source bodies that hold one `import('./c.js')`.
 * Each body is the text of a file that sits beside `c.ts`.
 */

/** The runtime fixtures: each `import()` loads the module when the code runs. */
export const RUNTIME_IMPORTS: Readonly<Record<string, string>> = {
  "await import()":
    "export async function f(): Promise<unknown> {\n  return await import('./c.js');\n}\n",
  "import().then()": "export function f(): void {\n  import('./c.js').then((m) => m.run());\n}\n",
  "bare import();": "export function f(): void {\n  import('./c.js');\n}\n",
  "const p = import()":
    "export function f(): Promise<unknown> {\n  const p = import('./c.js');\n  return p;\n}\n",
  "Promise.all([import()])":
    "export function f(): Promise<unknown> {\n  return Promise.all([import('./c.js')]);\n}\n",
  "return import()": "export function f(): Promise<unknown> {\n  return import('./c.js');\n}\n",
};

/** The type fixtures: each `import()` names a type only and is erased at run time. */
export const TYPE_IMPORTS: Readonly<Record<string, string>> = {
  "type alias": "export type T = import('./c.js').C;\n",
  annotation: "export let x: import('./c.js').C | undefined;\n",
  "typeof import()": "export type M = typeof import('./c.js');\n",
  "interface member": "export interface I {\n  c: import('./c.js').C;\n}\n",
};
