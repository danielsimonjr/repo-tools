/**
 * Test helper: finds each network use in the text of a TypeScript source file.
 *
 * Two scans. The import scan reads the raw text, because a module specifier is a string. The
 * global scan reads the text with comments and strings blanked (`src/mask.ts`), so a comment or
 * a string that names `fetch` is not reported.
 */
import { blankCommentsAndStrings } from "../../src/mask.ts";

/** The modules that can reach the network. */
const NETWORK_MODULES = ["http", "https", "http2", "net", "dgram", "tls", "dns", "undici", "ws"];

const MODULE = `(?:node:)?(?:${NETWORK_MODULES.join("|")})`;

/** A static or dynamic import, a re-export or a require of a network module. */
const IMPORT = new RegExp(
  `(?:\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\brequire\\s*\\(\\s*|^\\s*import\\s+)["'\`]${MODULE}["'\`]`,
  "gm",
);

/** A call or a construction of a network global. */
const GLOBAL =
  /\bfetch\s*\(|\bnew\s+(?:WebSocket|XMLHttpRequest|EventSource)\b|\bBun\s*\.\s*(?:connect|listen|serve|udpSocket)\b|\bnavigator\s*\.\s*sendBeacon\b/g;

/** Returns one text per network use in `source`; empty when there is none. */
export function networkUses(source: string): string[] {
  const uses = [...source.matchAll(IMPORT)].map((m) => `imports ${m[0].trim()}`);
  const code = blankCommentsAndStrings(source);
  for (const m of code.matchAll(GLOBAL)) uses.push(`uses ${m[0]}`);
  return uses;
}
