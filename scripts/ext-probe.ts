/**
 * Extension-load probe (design 13.3 step 7).
 *
 *   ext-probe <extension.mjs> <outdir>
 *
 * CI compiles this file with the same `bun build --compile` flags as the product, then runs it
 * on a fixture extension. It proves that a compiled executable can import an external `.mjs`
 * module at runtime and run its `preflight` and `report` hooks. When the product gains its
 * extension loader, the smoke test runs the product itself instead.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function probe(extension: string, outdir: string): Promise<string[]> {
  const ran: string[] = [];
  mkdirSync(outdir, { recursive: true });
  const mod = await import(pathToFileURL(resolve(extension)).href);
  const ctx = {
    log: (text: string) => ran.push(`log:${text}`),
    write: async (name: string, text: string) => writeFileSync(join(outdir, name), text),
  };
  if (typeof mod.preflight === "function") {
    await mod.preflight(ctx);
    ran.push("preflight");
  }
  if (typeof mod.report === "function") {
    await mod.report(ctx);
    ran.push("report");
  }
  if (existsSync(join(outdir, "probe-report.txt"))) ran.push("report-file");
  return ran;
}

if (import.meta.main) {
  const [extension, outdir] = process.argv.slice(2);
  if (!extension || !outdir) {
    console.error("usage: ext-probe <extension.mjs> <outdir>");
    process.exit(1);
  }
  const ran = await probe(extension, outdir);
  const want = ["log:preflight ran", "preflight", "report", "report-file"];
  const missing = want.filter((w) => !ran.includes(w));
  if (missing.length > 0) {
    console.error(`ext-probe FAILED: missing ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log("ext-probe passed: preflight and report ran; the report file exists.");
}
