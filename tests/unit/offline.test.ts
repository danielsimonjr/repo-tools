/**
 * The tool stays offline. repo-tools analyses private repositories, so it must never send
 * repository content anywhere: no network module and no network global in `src/`.
 *
 * The scan is static, so a later change cannot add a network call without this test failing.
 * The positive controls prove that the scan finds each planted form.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { networkUses } from "./offline.ts";

const SRC = join(import.meta.dir, "../../src");

/** Every `.ts` file below `dir`. */
function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return tsFiles(full);
    return e.name.endsWith(".ts") ? [full] : [];
  });
}

describe("offline: src/ has no network use", () => {
  test("no source file imports a network module or uses a network global", () => {
    const files = tsFiles(SRC);
    expect(files.length).toBeGreaterThan(40);
    const found = files.flatMap((f) =>
      networkUses(readFileSync(f, "utf8")).map((u) => `${f.slice(SRC.length + 1)}: ${u}`),
    );
    expect(found).toEqual([]);
  });
});

describe("offline: the scan finds each planted form (positive controls)", () => {
  const plants = [
    'import { get } from "node:https";',
    "import http from 'http';",
    'import * as net from "node:net";',
    'import { createSocket } from "dgram";',
    'import tls from "node:tls";',
    'import { connect } from "node:http2";',
    'import { lookup } from "node:dns";',
    'export { request } from "undici";',
    'const h = await import("node:http");',
    'const h = require("https");',
    "const r = await fetch(url);",
    "const s = new WebSocket(url);",
    "const x = new XMLHttpRequest();",
    "await Bun.connect({ hostname, port });",
    "Bun.serve({ fetch() {} });",
    "Bun.listen({ port });",
    "await Bun.udpSocket({});",
    "navigator.sendBeacon(url, body);",
  ];
  for (const plant of plants) {
    test(`finds: ${plant}`, () => {
      expect(networkUses(plant).length).toBeGreaterThan(0);
    });
  }

  test("a comment or a string that names fetch is not a use", () => {
    expect(networkUses("// fetch the file from the cache\nconst t = 'fetch(x)';\n")).toEqual([]);
  });

  test("a file module is not a network module", () => {
    expect(
      networkUses('import { readFileSync } from "node:fs";\nimport path from "node:path";\n'),
    ).toEqual([]);
  });
});
