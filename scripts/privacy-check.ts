/**
 * Privacy check (design section 10.2).
 *
 * The check scans every tracked file and every commit message reachable from HEAD. It fails
 * on an absolute user path, an email address, a session URL, a tracked binary, or a word
 * token whose SHA-256 is in `scripts/privacy-denylist.sha256`. A report line names the file,
 * the line and the rule. A report line never holds the matched value.
 *
 * Usage:
 *   bun scripts/privacy-check.ts                    self-test, then scan the repository
 *   bun scripts/privacy-check.ts --commit-msg <f>   scan one commit message file (git hook)
 *
 * Limit: a hash denylist of short names is reversible with a dictionary. The list keeps the
 * names out of the published text. The list is not a secret.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Category = "person" | "private";
/** Token hash (SHA-256 hex of the lower-case token) to its category. */
export type Denylist = Map<string, Category>;

export type Rule =
  | "windows-user-path"
  | "posix-home-path"
  | "email"
  | "session-url"
  | "denylist"
  | "binary";

export interface Finding {
  file: string;
  /** 1-based line number; 0 for a finding about the file itself. */
  line: number;
  rule: Rule;
  /** For `denylist`: the first 12 hex digits of the token hash. Never the token. */
  detail?: string;
  /** Set when the path itself holds a finding: the report then prints this number, not the path. */
  pathId?: number;
}

/** The public owner org. It may appear in a GitHub URL and in the npm scope. */
const ORG = "danielsimonjr";
const MAX_TRACKED_BYTES = 5 * 1024 * 1024;

// A Windows profile path: with a drive letter and either slash, or drive-less with a backslash.
const WINDOWS_USER_PATH = /(?:\b[a-z]:[\\/]+|\\)users[\\/]+[^\\/\s]/i;
// A home or profile folder at the START of a path, also in the Git Bash drive form and the WSL
// mount form. The same segment after a host name is a URL, not a path, and does not match.
const POSIX_HOME_PATH =
  /(?:^|[\s"'`=(:,;[{<>|])\/(?:[a-z]\/|mnt\/[a-z]\/)?(?:home|users)\/[^/\s"'`]/i;
const EMAIL = /(?<![\w.%+-])[\w.%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
/** Whole-address allowance: GitHub noreply, a `noreply@` sender, and the GitHub SSH user. */
const ALLOWED_EMAIL =
  /^(?:[^@\s]+@users\.noreply\.github\.com|noreply@[a-z0-9.-]+|git@github\.com)$/i;
const SESSION_URL = /claude\.ai\/code\/session_/i;
const TOKEN = /[\p{L}\p{N}_-]+/gu;
/** Invisible characters that can split a word without changing how it reads. */
const INVISIBLE = /[\u00ad\u200b-\u200f\u2060\ufeff]/g;
const MAX_PARTS = 12;
const ORG_REFERENCE = new RegExp(`(github\\.com[/:]|@)${ORG}(?=/)`, "gi");
/** A copyright notice: the line starts (after punctuation) with the notice itself. */
const COPYRIGHT_LINE = /^\W*(?:copyright\b|©|\(c\)\s*\d{4})/i;
/** A license file at the repository root only. */
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.[a-z]+)?$/i;
const ATTRIBUTION_KEY = /"(?:author|owner|authors|contributors|maintainers)"\s*:/i;
/** The line git writes above the diff of `git commit -v`. */
const SCISSORS = /^# -+ >8 -+$/;
/** The CLI's floor for the denylist size. */
export const DENYLIST_FLOOR = 20;

/** Removes accents and invisible characters, so an accented spelling reads as the plain word. */
function normalize(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").replace(INVISIBLE, "");
}

/**
 * Returns the strings to look up for one token: the token itself, and every contiguous span of
 * its parts, split at `-`, `_` and camelCase boundaries, joined with `-` and with `_`. So
 * `NameSmith`, `name_q` and `x-private-name-2` all expose the denylisted part.
 */
export function tokenCandidates(token: string): string[] {
  const parts = token
    .split(/[-_]+/)
    .flatMap((p) => p.split(/(?<=[\p{Ll}\p{N}])(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u))
    .filter(Boolean)
    .slice(0, MAX_PARTS);
  const out = new Set([token]);
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j <= parts.length; j++) {
      const span = parts.slice(i, j);
      out.add(span.join("-"));
      out.add(span.join("_"));
    }
  }
  return [...out];
}

/** Returns the denylist hash of one word token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token.toLowerCase()).digest("hex");
}

/** Parses the denylist file: one `<sha256-hex> <category>` pair per line; `#` starts a comment. */
export function parseDenylist(text: string): Denylist {
  const list: Denylist = new Map();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(/#.*/, "").trim();
    if (line === "") return;
    const fields = line.split(/\s+/);
    const [hash, category] = fields;
    if (
      fields.length !== 2 ||
      !hash ||
      !/^[0-9a-f]{64}$/.test(hash) ||
      (category !== "person" && category !== "private")
    ) {
      // The line number only: a plaintext line pasted by mistake must not reach a CI log.
      throw new Error(`privacy-denylist: malformed line ${index + 1}`);
    }
    list.set(hash, category);
  });
  return list;
}

/** Fails when the denylist holds fewer than `floor` hashes, so an emptied list cannot pass. */
export function assertDenylistFloor(deny: Denylist, floor = 1): void {
  if (deny.size < floor) {
    throw new Error(`privacy-denylist: ${deny.size} hashes, expected at least ${floor}`);
  }
}

/**
 * Returns the 0-based numbers of the JSON lines that hold an attribution key, or that lie inside
 * that key's object or array value. Other lines get no attribution exemption.
 */
function attributionLines(file: string, text: string): Set<number> {
  const out = new Set<number>();
  if (!file.toLowerCase().endsWith(".json")) return out;
  const blankStrings = (s: string) => s.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const balance = (s: string) => (s.match(/[{[]/g)?.length ?? 0) - (s.match(/[}\]]/g)?.length ?? 0);
  let depth = 0;
  text.split(/\r?\n/).forEach((line, index) => {
    if (depth > 0) {
      out.add(index);
      depth = Math.max(0, depth + balance(blankStrings(line)));
      return;
    }
    const key = ATTRIBUTION_KEY.exec(line);
    if (!key) return;
    out.add(index);
    depth = Math.max(0, balance(blankStrings(line.slice(key.index + key[0].length))));
  });
  return out;
}

/**
 * Returns the hash of the first denylisted token candidate on a line, or undefined. `exempt`
 * applies only to `person` candidates; `private` candidates are never exempt.
 */
function denylistHit(line: string, deny: Denylist, exempt: boolean): string | undefined {
  for (const [token] of line.matchAll(TOKEN)) {
    for (const candidate of tokenCandidates(token)) {
      const hash = hashToken(candidate);
      const category = deny.get(hash);
      if (!category) continue;
      if (category === "person" && exempt) continue;
      return hash;
    }
  }
  return undefined;
}

interface ScanOptions {
  /** Apply the attribution exemptions for `person` tokens. False for commit messages. */
  exemptions: boolean;
}

function scan(file: string, text: string, deny: Denylist, opts: ScanOptions): Finding[] {
  const findings: Finding[] = [];
  const licenseFile = opts.exemptions && !file.includes("/") && LICENSE_FILE.test(file);
  const attribution = opts.exemptions ? attributionLines(file, text) : new Set<number>();
  text.split(/\r?\n/).forEach((raw, index) => {
    const at = (rule: Rule, detail?: string) =>
      findings.push({ file, line: index + 1, rule, ...(detail ? { detail } : {}) });
    const line = normalize(raw);
    if (WINDOWS_USER_PATH.test(line)) at("windows-user-path");
    else if (POSIX_HOME_PATH.test(line)) at("posix-home-path");
    if ([...line.matchAll(EMAIL)].some((m) => !ALLOWED_EMAIL.test(m[0]))) at("email");
    if (SESSION_URL.test(line)) at("session-url");

    const masked = opts.exemptions ? line.replace(ORG_REFERENCE, "$1") : line;
    const lineExempt =
      licenseFile || attribution.has(index) || (opts.exemptions && COPYRIGHT_LINE.test(line));
    const hit = denylistHit(masked, deny, lineExempt);
    if (hit) at("denylist", hit.slice(0, 12));
  });
  return findings;
}

/** Scans the text of one tracked file. `file` is its repository-relative path. */
export function scanText(file: string, text: string, deny: Denylist): Finding[] {
  return scan(file, text, deny, { exemptions: true });
}

/** Scans one commit message. Commit messages get no attribution exemption. */
export function scanCommitMessage(sha: string, message: string, deny: Denylist): Finding[] {
  return scan(`commit ${sha.slice(0, 12)}`, message, deny, { exemptions: false });
}

/** Checks one tracked path for the binary rule. */
export function scanTrackedFile(file: string, sizeBytes: number): Finding[] {
  if (/\.exe$/i.test(file) || sizeBytes > MAX_TRACKED_BYTES) {
    return [{ file, line: 0, rule: "binary" }];
  }
  return [];
}

/**
 * Formats one finding. A path that itself holds a finding is never printed: it is named by its
 * index and a hash. A denylisted token in any other path is masked.
 */
export function formatFinding(f: Finding, deny: Denylist = new Map()): string {
  const file =
    f.pathId === undefined
      ? f.file.replace(TOKEN, (t) => (deny.has(hashToken(t)) ? "***" : t))
      : `tracked path #${f.pathId} (sha256 ${hashToken(f.file).slice(0, 12)})`;
  return `${file}:${f.line}: ${f.rule}${f.detail ? ` [token sha256 ${f.detail}]` : ""}`;
}

/**
 * Feeds one planted finding per rule into the checker. Returns the rules that did NOT fire.
 * An empty result means the checker can fail. The plants are built from fragments.
 */
export function selfTest(): Rule[] {
  const word = "plantedtoken";
  const deny: Denylist = new Map([[hashToken(word), "person"]]);
  const plants: [Rule, () => Finding[]][] = [
    ["windows-user-path", () => scanText("x.md", `C:${"\\"}Users${"\\"}u${"\\"}x`, deny)],
    ["posix-home-path", () => scanText("x.md", ` /${"home"}/u/x`, deny)],
    ["email", () => scanText("x.md", `u${"@"}example.net`, deny)],
    ["session-url", () => scanCommitMessage("0", `claude.ai/code/${"session"}_x`, deny)],
    ["denylist", () => scanText("README.md", `by ${word}`, deny)],
    ["binary", () => scanTrackedFile("x.exe", 1)],
  ];
  return plants.filter(([rule, run]) => !run().some((f) => f.rule === rule)).map(([r]) => r);
}

function git(root: string, args: string[], stdin?: string): Buffer {
  const r = Bun.spawnSync(["git", "-C", root, ...args], {
    stdin: stdin === undefined ? undefined : Buffer.from(stdin),
  });
  if (r.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr.toString().trim()}`);
  return r.stdout;
}

/**
 * Reads git objects with `git cat-file --batch`. The objects are parsed by their byte sizes, so
 * no content byte can act as a separator.
 */
function readObjects(root: string, ids: string[]): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  if (ids.length === 0) return out;
  const raw = git(root, ["cat-file", "--batch"], `${ids.join("\n")}\n`);
  let at = 0;
  while (at < raw.length) {
    const eol = raw.indexOf(0x0a, at);
    const header = raw.subarray(at, eol).toString("utf8").split(" ");
    const [id, , size] = header;
    if (!id || size === undefined)
      throw new Error(`git cat-file: bad header '${header.join(" ")}'`);
    const start = eol + 1;
    const end = start + Number(size);
    out.set(id, raw.subarray(start, end));
    at = end + 1; // Skip the LF after the content.
  }
  if (out.size !== new Set(ids).size) throw new Error("git cat-file: object count mismatch");
  return out;
}

/**
 * Decodes blob bytes for scanning. UTF-16 text (with a byte order mark) is decoded. Other bytes
 * that hold a NUL are binary: the printable runs of 4 or more characters are scanned, one per
 * line, like `strings`.
 */
export function decodeForScan(bytes: Buffer): { text: string; binary: boolean } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: bytes.subarray(2).toString("utf16le"), binary: false };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2));
    swapped.swap16();
    return { text: swapped.toString("utf16le"), binary: false };
  }
  if (!bytes.includes(0)) return { text: bytes.toString("utf8"), binary: false };
  const runs = bytes.toString("latin1").match(/[\x20-\x7e\t]{4,}/g) ?? [];
  return { text: runs.join("\n"), binary: true };
}

export interface CheckResult {
  findings: Finding[];
  files: number;
  commits: number;
  denylist: Denylist;
}

/**
 * Scans the repository at `root`: every blob in the git index (the content that is or will be
 * committed, symlink targets included) and the message of every commit reachable from HEAD.
 */
export async function collect(root: string): Promise<CheckResult> {
  const findings: Finding[] = [];
  const entries = git(root, ["ls-files", "-s", "-z"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      const [, id] = line.slice(0, tab).split(" ");
      return { id: id ?? "", file: line.slice(tab + 1) };
    });
  const blobs = readObjects(
    root,
    entries.map((e) => e.id),
  );
  const denylistEntry = entries.find((e) => e.file === "scripts/privacy-denylist.sha256");
  const denylistBlob = denylistEntry && blobs.get(denylistEntry.id);
  if (!denylistBlob) throw new Error("privacy: scripts/privacy-denylist.sha256 is not tracked");
  const deny = parseDenylist(denylistBlob.toString("utf8"));

  entries.forEach(({ id, file }, index) => {
    const bytes = blobs.get(id) ?? Buffer.alloc(0);
    // The path itself can hold a private value. Then no report line may print the path.
    const inPath = scanCommitMessage("", file, deny).map((f) => ({ ...f, file, line: 0 }));
    const { text, binary } = decodeForScan(bytes);
    const inText = scanText(file, text, deny).map((f) => (binary ? { ...f, line: 0 } : f));
    const all = [...scanTrackedFile(file, bytes.length), ...inPath, ...inText];
    findings.push(...(inPath.length > 0 ? all.map((f) => ({ ...f, pathId: index + 1 })) : all));
  });

  let commits = 0;
  if (Bun.spawnSync(["git", "-C", root, "rev-parse", "--verify", "-q", "HEAD"]).exitCode === 0) {
    const ids = git(root, ["rev-list", "HEAD"]).toString("utf8").split("\n").filter(Boolean);
    const objects = readObjects(root, ids);
    for (const id of ids) {
      const body = (objects.get(id) ?? Buffer.alloc(0)).toString("utf8");
      const split = body.indexOf("\n\n");
      const message = split === -1 ? "" : body.slice(split + 2);
      commits++;
      findings.push(...scanCommitMessage(id, message, deny));
    }
    const expected = Number(git(root, ["rev-list", "--count", "HEAD"]).toString("utf8").trim());
    if (commits !== expected) throw new Error(`privacy: scanned ${commits} of ${expected} commits`);
  }
  return { findings, files: entries.length, commits, denylist: deny };
}

/** Returns the findings for the repository at `root`. */
export async function runCheck(root: string): Promise<Finding[]> {
  return (await collect(root)).findings;
}

async function cli(argv: string[]): Promise<number> {
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).toString("utf8").trim();
  if (argv[0] === "--commit-msg") {
    const path = argv[1];
    if (!path) {
      console.error("usage: privacy-check.ts --commit-msg <file>");
      return 1;
    }
    const deny = parseDenylist(readFileSync(join(root, "scripts/privacy-denylist.sha256"), "utf8"));
    // Every line is scanned, "#" lines too: a cleanup mode can keep them in the commit. The diff
    // that `git commit -v` appends below the scissors line is not part of the message.
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    const cut = lines.findIndex((l) => SCISSORS.test(l));
    const message = (cut === -1 ? lines : lines.slice(0, cut)).join("\n");
    const found = scanCommitMessage("new", message, deny);
    if (found.length === 0) return 0;
    for (const f of found) console.error(`privacy: ${formatFinding(f, deny)}`);
    console.error("privacy: commit rejected. Remove the finding and commit again.");
    return 1;
  }
  const broken = selfTest();
  if (broken.length > 0) {
    console.error(`privacy self-test FAILED: these rules cannot fail: ${broken.join(", ")}`);
    return 1;
  }
  console.log("privacy self-test: every rule fires on its plant.");
  const result = await collect(root);
  assertDenylistFloor(result.denylist, DENYLIST_FLOOR);
  for (const f of result.findings) console.error(`privacy: ${formatFinding(f, result.denylist)}`);
  console.log(
    `privacy check: ${result.files} tracked files, ${result.commits} commit messages, ` +
      `${result.denylist.size} denylisted hashes, ${result.findings.length} findings.`,
  );
  return result.findings.length > 0 ? 1 : 0;
}

if (import.meta.main) {
  process.exitCode = await cli(process.argv.slice(2));
}
