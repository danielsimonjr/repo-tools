/**
 * Shared golden helpers. The 1.x depgraph goldens are gone; `scripts/update-map-goldens.ts`
 * rewrites the map goldens. This module keeps the masking and the flag list those scripts share.
 */
export const GOLDEN_FLAGS = ["--no-extensions"];

/** The file name of the API-surface golden of the mini-repo fixture. */
export const API_SURFACE_FILE = "api-surface.json";

/** The golden masking: the fixture root in both separator forms, date-times and dates. */
export function maskGolden(text: string, root: string): string {
  return text
    .split(root)
    .join("<ROOT>")
    .split(root.split("\\").join("/"))
    .join("<ROOT>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<DATETIME>")
    .replace(/\d{4}-\d{2}-\d{2}/g, "<DATE>");
}
