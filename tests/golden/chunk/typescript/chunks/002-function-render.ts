/**
 * A template literal that spans lines and holds braces.
 */
export function render(name: string): string {
  const body = `line one {
  ${name.replace(/"/g, "'")} and ${"nested } string"}
  line three }`;
  return body;
}
