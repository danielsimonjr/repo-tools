// Fixture extension for the compiled-executable probe (design 13.3 step 7).
import { join } from "node:path";

export async function preflight(ctx) {
  ctx.log("preflight ran");
}

export async function report(ctx) {
  await ctx.write("probe-report.txt", `report ran in ${join("a", "b")}\n`);
}
