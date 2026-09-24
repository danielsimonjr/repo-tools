export function escaped(): string {
  const a = "a \"quoted\" { brace";
  const b = 'it\'s } here';
  return a + b; // trailing comment with { brace
}