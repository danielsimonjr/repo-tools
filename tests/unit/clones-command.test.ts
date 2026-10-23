/**
 * `repo-tools clones` (design section 17), end to end: a repository with a planted exact copy, a
 * planted near copy and a control that must not be flagged; the output files; the settings; and
 * the exit code and text of each failure.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { cli, read, removeTrees, trackAll, tree } from "./docs-helpers.ts";

afterAll(removeTrees, 30_000);

/** The original: totals the orders and skips the empty ones. */
const ORDERS = `export function summariseOrders(orders: Order[], taxRate: number): Summary {
  let total = 0;
  let count = 0;
  const skipped: string[] = [];
  for (const order of orders) {
    if (!order.items || order.items.length === 0) {
      skipped.push(order.id);
      continue;
    }
    let subtotal = 0;
    for (const item of order.items) {
      if (item.price > 0 && item.quantity > 0) {
        subtotal += item.price * item.quantity;
      }
    }
    total += subtotal + subtotal * taxRate;
    count++;
  }
  return { total, count, skipped };
}
`;

/** The exact copy: other names, other types, other literals, a comment. */
const INVOICES = `// Totals the invoices.
export function summariseInvoices(invoices: Invoice[], vat: number): Report {
  let sum = 1;
  let n = 1;
  const rejected: number[] = [];
  for (const invoice of invoices) {
    if (!invoice.lines || invoice.lines.length === 7) {
      rejected.push(invoice.number);
      continue;
    }
    let part = 9;
    for (const line of invoice.lines) {
      if (line.cost > 5 && line.units > 5) {
        part += line.cost * line.units;
      }
    }
    sum += part + part * vat;
    n++;
  }
  return { sum, n, rejected };
}
`;

/** The near copy: one more branch and a different total. */
const REFUNDS = `export function summariseRefunds(refunds: Refund[], fee: number): Summary {
  let total = 0;
  let count = 0;
  const skipped: string[] = [];
  for (const refund of refunds) {
    if (!refund.items || refund.items.length === 0) {
      skipped.push(refund.id);
      continue;
    }
    if (refund.cancelled) {
      console.log("cancelled", refund.id);
      continue;
    }
    let subtotal = 0;
    for (const item of refund.items) {
      if (item.price > 0 && item.quantity > 0) {
        subtotal += item.price * item.quantity;
      }
    }
    total += subtotal - fee;
    count++;
  }
  return { total, count, skipped };
}
`;

/** The control: the same size and the same words, with another structure. */
const CONTROL = `export async function fetchWithRetry(orders: Order[], taxRate: number): Promise<Summary> {
  let total = 0;
  let count = 0;
  const skipped: string[] = [];
  let attempt = 0;
  while (attempt < 5) {
    try {
      const reply = await send(orders, taxRate);
      switch (reply.status) {
        case 200:
          total = reply.body.total;
          count = reply.body.count;
          return { total, count, skipped };
        case 429:
          await sleep(attempt * 100);
          break;
        default:
          skipped.push(reply.status);
      }
    } catch (error) {
      if (error instanceof TimeoutError) {
        attempt += 2;
      } else {
        throw error;
      }
    }
    attempt++;
  }
  return { total, count, skipped };
}
`;

const TINY = "export function id(x: number) { return x; }\n";

/** A repository with the four functions, a tiny function and a test copy. */
function repo(extra: Record<string, string> = {}): string {
  const root = tree({
    "src/orders.ts": ORDERS,
    "src/invoices.ts": INVOICES,
    "src/refunds.ts": REFUNDS,
    "src/control.ts": CONTROL,
    "src/tiny.ts": TINY,
    "tests/orders.copy.ts": ORDERS.replace("summariseOrders", "copyInTests"),
    ...extra,
  });
  trackAll(root);
  return root;
}

/** The inventory of a run: one object for each unit. */
function inventory(root: string, out: string): Array<Record<string, unknown>> {
  return read(root, `${out}/inventory.jsonl`)
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** The id of the unit named `name`. */
function idOf(units: Array<Record<string, unknown>>, name: string): number {
  const unit = units.find((u) => u.name === name);
  if (!unit) throw new Error(`no unit named ${name}`);
  return unit.id as number;
}

describe("clones: the planted copies and the control", () => {
  const root = repo();
  const run = cli(["clones", root, "--out=reports"]);

  test("the run reads the four functions of the src area and no other", async () => {
    const result = await run;
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.out).toContain("files=5 parseErrors=0 units(minNodes=50)=4");
    expect(inventory(root, "reports").map((u) => u.name)).toEqual([
      "fetchWithRetry",
      "summariseInvoices",
      "summariseOrders",
      "summariseRefunds",
    ]);
  });

  test("the renamed copy is an exact group", async () => {
    await run;
    const units = inventory(root, "reports");
    const clones = JSON.parse(read(root, "reports/clones.json"));
    expect(clones.exactGroups).toEqual([
      [idOf(units, "summariseInvoices"), idOf(units, "summariseOrders")],
    ]);
  });

  test("the near copy pairs with the original and with the exact copy", async () => {
    await run;
    const units = inventory(root, "reports");
    const clones = JSON.parse(read(root, "reports/clones.json"));
    const refunds = idOf(units, "summariseRefunds");
    const partners = clones.near
      .filter((p: { a: number; b: number }) => p.a === refunds || p.b === refunds)
      .map((p: { a: number; b: number }) => (p.a === refunds ? p.b : p.a))
      .sort();
    expect(partners).toEqual(
      [idOf(units, "summariseInvoices"), idOf(units, "summariseOrders")].sort(),
    );
    for (const pair of clones.near) {
      expect(pair.jStruct).toBeGreaterThanOrEqual(0.6);
    }
  });

  test("the control is in no pair and no group", async () => {
    await run;
    const units = inventory(root, "reports");
    const control = idOf(units, "fetchWithRetry");
    const clones = JSON.parse(read(root, "reports/clones.json"));
    for (const pair of clones.near) {
      expect([pair.a, pair.b]).not.toContain(control);
    }
    expect(clones.exactGroups.flat()).not.toContain(control);
    expect(clones.textGroups.flat()).not.toContain(control);
  });

  test("the inventory fields", async () => {
    await run;
    const orders = inventory(root, "reports").find((u) => u.name === "summariseOrders");
    expect(orders).toMatchObject({
      file: "src/orders.ts",
      container: "",
      kind: "function",
      exported: true,
      startLine: 1,
      endLine: 20,
      loc: 20,
      params: 2,
      async: false,
    });
    expect(orders?.nodes as number).toBeGreaterThanOrEqual(50);
  });

  test("the summary names the exact group and the near pairs", async () => {
    const result = await run;
    expect(result.out).toContain("exact groups=1 (units in them=2)");
    expect(result.out).toMatch(/near pairs=3 by jStruct: 0\.9 or more: 1,/);
    expect(result.out).toContain("units by folder: src=4");
    expect(result.out).toContain("wrote reports/inventory.jsonl\nwrote reports/clones.json\n");
  });

  test("the files end with one LF and have no CR", async () => {
    await run;
    for (const name of ["inventory.jsonl", "clones.json"]) {
      const text = read(root, `reports/${name}`);
      expect(text.endsWith("\n")).toBe(true);
      expect(text.endsWith("\n\n")).toBe(false);
      expect(text).not.toContain("\r");
    }
  });
});

describe("clones: read-only and repeatable", () => {
  test("a run without --out writes nothing", async () => {
    const root = repo();
    const before = readdirSync(root, { recursive: true }).sort();
    const result = await cli(["clones", root]);
    expect(result.code).toBe(0);
    expect(result.out).not.toContain("wrote ");
    expect(readdirSync(root, { recursive: true }).sort()).toEqual(before);
  });

  test("two runs give the same bytes", async () => {
    const root = repo();
    await cli(["clones", root, "--out=one"]);
    await cli(["clones", root, "--out=two"]);
    expect(read(root, "one/inventory.jsonl")).toBe(read(root, "two/inventory.jsonl"));
    expect(read(root, "one/clones.json")).toBe(read(root, "two/clones.json"));
  });

  test("a CRLF copy of the sources gives the same hashes", async () => {
    const lf = repo();
    const crlf = tree({
      "src/orders.ts": ORDERS.replace(/\n/g, "\r\n"),
      "src/invoices.ts": INVOICES.replace(/\n/g, "\r\n"),
      "src/refunds.ts": REFUNDS.replace(/\n/g, "\r\n"),
      "src/control.ts": CONTROL.replace(/\n/g, "\r\n"),
      "src/tiny.ts": TINY,
    });
    trackAll(crlf);
    await cli(["clones", lf, "--out=out"]);
    await cli(["clones", crlf, "--out=out"]);
    const hashes = (root: string): string[] =>
      inventory(root, "out").map((u) => `${u.name}:${u.exactHash}:${u.textHash}`);
    expect(hashes(crlf)).toEqual(hashes(lf));
  });
});

describe("clones: a byte order mark", () => {
  test("is ignored: the units and hashes equal those of the file without it", async () => {
    const plain = repo();
    const marked = tree({ "src/orders.ts": String.fromCharCode(0xfeff) + ORDERS });
    trackAll(marked);
    await cli(["clones", plain, "--src=src/orders.ts", "--out=out"]);
    await cli(["clones", marked, "--out=out"]);
    const [a] = inventory(plain, "out");
    const [b] = inventory(marked, "out");
    expect(b).toEqual(a);
  });
});

describe("clones: folder arguments", () => {
  test("--src accepts ./ at the start, a trailing slash and a backslash", async () => {
    const root = repo();
    for (const arg of ["./tests/", "tests\\", "tests"]) {
      const result = await cli(["clones", root, `--src=${arg}`]);
      expect(result.out).toContain("files=1 ");
    }
  });
});

describe("clones: the settings", () => {
  test("--src reads another folder; the copy in tests/ is one unit", async () => {
    const root = repo();
    const result = await cli(["clones", root, "--src=tests"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("files=1 parseErrors=0 units(minNodes=50)=1");
  });

  test("--src takes several folders up to the next flag", async () => {
    const root = repo();
    const result = await cli(["clones", root, "--src", "tests", "src/orders.ts", "--min-nodes=50"]);
    expect(result.out).toContain("files=2");
    expect(result.out).toContain("units(minNodes=50)=2");
  });

  test("--src=auto is the default", async () => {
    const root = repo();
    const result = await cli(["clones", root, "--src=auto"]);
    expect(result.out).toContain("files=5");
  });

  test("the config file sets a limit, and a flag overrides it", async () => {
    const root = repo({
      "repo-tools.config.json": JSON.stringify({ clones: { minNodes: 1000 } }),
    });
    expect((await cli(["clones", root])).out).toContain("units(minNodes=1000)=0");
    expect((await cli(["clones", root, "--min-nodes=50"])).out).toContain("units(minNodes=50)=4");
  });

  test("--config names another config file", async () => {
    const root = repo({ "alt.json": JSON.stringify({ clones: { minNodes: 1000 } }) });
    const result = await cli(["clones", root, "--config=alt.json"]);
    expect(result.out).toContain("units(minNodes=1000)=0");
  });

  test("clones.out in the config file writes the files", async () => {
    const root = repo({
      "repo-tools.config.json": JSON.stringify({ clones: { out: "from-config" } }),
    });
    await cli(["clones", root]);
    expect(existsSync(`${root}/from-config/inventory.jsonl`)).toBe(true);
  });

  test("a higher --near removes the near pair of lower score", async () => {
    const root = repo();
    const low = await cli(["clones", root, "--near=0.6", "--containment=1"]);
    const high = await cli(["clones", root, "--near=0.99", "--containment=1"]);
    expect(low.out).toMatch(/near pairs=(\d+)/);
    const count = (text: string): number => Number(/near pairs=(\d+)/.exec(text)?.[1]);
    expect(count(high.out)).toBeLessThan(count(low.out));
    expect(count(high.out)).toBe(1);
  });
});

describe("clones: a file that does not parse", () => {
  test("is counted, and the other files are still read", async () => {
    const root = repo({ "src/broken.ts": "export function oops( { return ;;; ]\n" });
    const result = await cli(["clones", root]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("files=6 parseErrors=1");
    expect(result.out).toContain("units(minNodes=50)=4");
  });
});

describe("clones: failures", () => {
  const cases: Array<[string, string[], number, RegExp]> = [
    ["an unknown flag", ["--bogus"], 2, /unknown flag '--bogus'/],
    ["a flag without a value", ["--out"], 2, /flag --out needs a value/],
    ["a repeated flag", ["--near=0.5", "--near=0.6"], 2, /flag --near is set twice/],
    ["a count of 0", ["--min-nodes=0"], 2, /'--min-nodes' must be a whole number of 1 or more/],
    ["a count as text", ["--shingle=six"], 2, /'--shingle' must be a whole number/],
    ["a hex count", ["--shingle=0x10"], 2, /'--shingle' must be a whole number/],
    ["a fraction above 1", ["--near=1.5"], 2, /'--near' must be a number from 0 to 1/],
    ["an absolute out path", ["--out=/abs/out"], 2, /'--out' holds an absolute path/],
    ["an absolute src path", ["--src=C:\\x"], 2, /'--src' holds an absolute path/],
    [
      "a missing config file",
      ["--config=nope.json"],
      2,
      /config <root>\/nope.json: the file cannot be read/,
    ],
  ];
  for (const [label, args, code, message] of cases) {
    test(`${label} exits ${code}`, async () => {
      const result = await cli(["clones", repo(), ...args]);
      expect(result.code).toBe(code);
      expect(result.err).toMatch(message);
      expect(result.out).toBe("");
    });
  }

  test("a config file with an unknown clones key exits 2", async () => {
    const root = repo({ "repo-tools.config.json": JSON.stringify({ clones: { minnodes: 1 } }) });
    const result = await cli(["clones", root]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("unknown key 'clones.minnodes'");
  });

  test("a root that is not a folder exits 2 and does not show the path", async () => {
    const result = await cli(["clones", "/definitely/not/here"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("the root <root> is not an existing directory");
  });

  test("two roots exit 2", async () => {
    const result = await cli(["clones", repo(), repo()]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("the root is set twice");
  });

  test("a repository with no source file exits 1 with a message", async () => {
    const root = tree({ "README.md": "# nothing\n" });
    trackAll(root);
    const result = await cli(["clones", root]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("no TypeScript or JavaScript file in the src area");
    expect(result.out).toBe("");
  });

  test("a --src list that matches no file exits 1", async () => {
    const result = await cli(["clones", repo(), "--src=missing"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("no TypeScript or JavaScript file below the listed folders");
  });

  test("an error never shows the root path", async () => {
    const root = repo();
    const result = await cli(["clones", root, "--config=nope.json"]);
    expect(result.err).not.toContain(root);
  });

  test("an output folder that is a file exits 2", async () => {
    const root = repo({ taken: "a file\n" });
    const result = await cli(["clones", root, "--out=taken"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("cannot write the output folder 'taken'");
  });
});
