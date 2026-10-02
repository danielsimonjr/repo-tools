// Fixture extension for the smoke test (design 12.1 step 7), in the shape of design section 6.
// `preflight` writes a marker file under the root; `report` writes through `ctx.write`.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export default {
  name: "probe",
  preflight(ctx) {
    writeFileSync(join(ctx.root, "preflight-ran.txt"), "preflight ran\n");
  },
  report(ctx) {
    const files = ctx.graph && typeof ctx.graph === "object" ? "a graph" : "no graph";
    ctx.write("probe-report.txt", `report ran with ${files}\n`);
  },
};
