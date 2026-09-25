import { describe, expect, test } from "bun:test";
import { main } from "../../src/cli.ts";
import { parseQueryArgs } from "../../src/query/args.ts";

/** Runs `repo-tools query` through `main` with captured output streams. */
async function query(argv: string[]) {
  let out = "";
  let err = "";
  const code = await main(["query", ...argv], {
    stdout: (s) => {
      out += s;
    },
    stderr: (s) => {
      err += s;
    },
  });
  return { code, out, err };
}

describe("repo-tools query: the command line (design section 3.5)", () => {
  test("query --help prints the query help and exits 0", async () => {
    const r = await query(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("repo-tools query");
    for (const word of [
      "dependents <file>",
      "symbol-users <symbol>",
      "is-public <pkg> <symbol>",
      "node-safety [pkg]",
      "cycles",
      "--emit",
      "--check-browser-safety",
      "--node-runtime=<pkg,...>",
      "--out=<dir>",
      "--root=<path>",
    ]) {
      expect(r.out).toContain(word);
    }
  });

  test("each command parses with its arguments", () => {
    expect(parseQueryArgs(["dependents", "src/a.ts"], "cwd").command).toEqual({
      name: "dependents",
      file: "src/a.ts",
    });
    expect(parseQueryArgs(["symbol-users", "add"], "cwd").command).toEqual({
      name: "symbol-users",
      symbol: "add",
    });
    expect(parseQueryArgs(["is-public", "core", "add"], "cwd").command).toEqual({
      name: "is-public",
      pkg: "core",
      symbol: "add",
    });
    expect(parseQueryArgs(["node-safety"], "cwd").command).toEqual({ name: "node-safety" });
    expect(parseQueryArgs(["node-safety", "core"], "cwd").command).toEqual({
      name: "node-safety",
      pkg: "core",
    });
    expect(parseQueryArgs(["cycles"], "cwd").command).toEqual({ name: "cycles" });
    expect(parseQueryArgs(["--emit"], "cwd").command).toEqual({ name: "emit" });
    expect(parseQueryArgs(["--check-browser-safety"], "cwd").command).toEqual({
      name: "check-browser-safety",
    });
  });

  test("the flags parse; the root defaults to the current directory", () => {
    const o = parseQueryArgs(["cycles", "--root=r", "--out=o/x", "--node-runtime=a,b"], "cwd");
    expect(o.root).toBe("r");
    expect(o.out).toBe("o/x");
    expect(o.nodeRuntimes).toEqual(["a", "b"]);
    const d = parseQueryArgs(["cycles"], "cwd");
    expect(d.root).toBe("cwd");
    expect(d.out).toBeUndefined();
    expect(d.nodeRuntimes).toBeUndefined();
  });

  const bad: [string, string[], string][] = [
    ["no command", [], "a command is missing"],
    ["an unknown command", ["frobnicate"], "unknown command 'frobnicate'"],
    ["an unknown flag", ["cycles", "--nope"], "unknown flag '--nope'"],
    ["dependents without a file", ["dependents"], "dependents needs <file>"],
    ["symbol-users without a symbol", ["symbol-users"], "symbol-users needs <symbol>"],
    ["is-public without a symbol", ["is-public", "core"], "is-public needs <pkg> <symbol>"],
    ["an extra argument", ["cycles", "x"], "cycles takes no more arguments"],
    ["node-safety with two packages", ["node-safety", "a", "b"], "node-safety takes"],
    ["a command and a mode", ["cycles", "--emit"], "use one command or mode"],
    ["two modes", ["--emit", "--check-browser-safety"], "use one command or mode"],
    ["a mode and an argument", ["--emit", "x"], "unknown command 'x'"],
    ["a flag without its value", ["cycles", "--out"], "flag --out needs a value"],
    ["an empty flag value", ["cycles", "--root="], "flag --root needs a value"],
    ["a value on a mode", ["--emit=1"], "flag --emit takes no value"],
    ["an empty runtime item", ["cycles", "--node-runtime=a,"], "empty item"],
    ["an absolute --out", ["cycles", "--out=/abs/out"], "flag --out holds an absolute path"],
    ["a second --root", ["cycles", "--root=a", "--root=b"], "the root is set twice"],
  ];
  for (const [name, argv, message] of bad) {
    test(`${name} exits 1 with a message`, async () => {
      const r = await query(argv);
      expect(r.code).toBe(1);
      expect(r.out).toBe("");
      expect(r.err).toContain(message);
      expect(r.err).toStartWith("repo-tools query: ");
    });
  }
});
