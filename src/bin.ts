#!/usr/bin/env node
/** Process entry for the bundle and the compiled executable. */
import { main } from "./cli.ts";

process.exitCode = await main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
