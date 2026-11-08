import { expect, test } from "bun:test";
import { analysePhp, parsesAsPhp } from "../../src/docs/php.ts";
import { applyInsertions, planTypeScript, splitLines } from "../../src/docs/stub.ts";

/** One documented symbol of the analysed file. */
type Sym = Awaited<ReturnType<typeof analysePhp>>["symbols"][number];

/** Analyse one PHP source text and return its symbols. */
async function symbols(source: string): Promise<Sym[]> {
  return (await analysePhp("a.php", source)).symbols;
}

/** Return the named symbol and throw when it is absent. */
async function byName(source: string, name: string): Promise<Sym> {
  const found = (await symbols(source)).find((symbol) => symbol.name === name);
  if (found === undefined) throw new Error(`missing symbol: ${name}`);
  return found;
}

test("parses HTML around a PHP block", async () => {
  const source = "<html>\n<?php\nfunction add($a) { return $a; }\n?>\n<p>x</p>\n";
  const report = await analysePhp("a.php", source);
  expect(report.error).toBe("");
  expect((await byName(source, "add")).kind).toBe("function");
});

test("maps each declaration to a kind", async () => {
  const source =
    "<?php\nfunction add() {}\nclass Box {\n  public function get() {}\n}\ninterface I {}\ntrait T {}\nenum Suit {\n  case Hearts;\n}\n";
  expect((await byName(source, "add")).kind).toBe("function");
  expect((await byName(source, "Box")).kind).toBe("class");
  expect((await byName(source, "get")).kind).toBe("method");
  expect((await byName(source, "I")).kind).toBe("interface");
  expect((await byName(source, "T")).kind).toBe("trait");
  expect((await byName(source, "Suit")).kind).toBe("enum");
});

test("ignores a closure", async () => {
  const source = "<?php\n$c = function ($p) {};\n";
  expect(await symbols(source)).toHaveLength(0);
});

test("marks private members as not exported", async () => {
  const source =
    "<?php\nclass Box {\n  public function get() {}\n  function noModifier() {}\n  protected static function prot() {}\n  private function priv() {}\n}\n";
  expect((await byName(source, "get")).exported).toBe(true);
  expect((await byName(source, "noModifier")).exported).toBe(true);
  expect((await byName(source, "prot")).exported).toBe(true);
  expect((await byName(source, "priv")).exported).toBe(false);
});

test("marks implicit interface methods as exported", async () => {
  const source = "<?php\ninterface I {\n  function implicit();\n}\n";
  expect((await byName(source, "implicit")).exported).toBe(true);
});

test("marks anonymous class methods as not exported", async () => {
  const source = "<?php\n$o = new class {\n  public function anon() {}\n};\n";
  expect((await byName(source, "anon")).exported).toBe(false);
});

test("marks nested functions as not exported", async () => {
  const source = "<?php\nfunction outer() {\n  function inner() {}\n}\n";
  expect((await byName(source, "inner")).exported).toBe(false);
});

test("marks namespaced functions as exported", async () => {
  const source = "<?php\nnamespace A {\n  function f() {}\n}\n";
  expect((await byName(source, "f")).exported).toBe(true);
});

test("detects an adjacent doc comment", async () => {
  expect((await byName("<?php\n/** Doc. */\nfunction f() {}\n", "f")).hasDoc).toBe(true);
  expect((await byName("<?php\n# hash\nfunction g() {}\n", "g")).hasDoc).toBe(false);
  expect((await byName("<?php\n// plain\nfunction h() {}\n", "h")).hasDoc).toBe(false);
  expect((await byName("<?php\n/** Blank. */\n\nfunction b() {}\n", "b")).hasDoc).toBe(true);
});

test("anchors a function below its attribute list", async () => {
  const source = "<?php\n/** Before attr. */\n#[Pure]\nfunction w() {}\n";
  const symbol = await byName(source, "w");
  expect(symbol.hasDoc).toBe(true);
  expect(symbol.anchorLine).toBe(3);
});

test("uses only the nearest doc comment", async () => {
  const source = "<?php\n/** file doc. */\n\n/** class doc. */\nclass A {}\n";
  expect((await byName(source, "A")).summary).toBe("class doc.");
});

test("reads the parameter names", async () => {
  expect((await byName("<?php\nfunction f(int $a, $b) {}\n", "f")).params).toEqual(["a", "b"]);
  expect((await byName("<?php\nfunction v(string ...$rest) {}\n", "v")).params).toEqual(["rest"]);
  const promoted =
    "<?php\nclass P {\n  public function __construct(private string $name, protected ?int $age = null) {}\n}\n";
  expect((await byName(promoted, "__construct")).params).toEqual(["name", "age"]);
  expect((await byName("<?php\nfunction r(array &$arr) {}\n", "r")).params).toEqual(["arr"]);
});

test("reports a documented parameter that is absent", async () => {
  const source =
    "<?php\n/**\n * Does.\n * @param int $a x\n * @param array<string, int> $opts y\n * @param string $gone z\n */\nfunction f(int $a, array $opts) {}\n";
  const symbol = await byName(source, "f");
  expect(symbol.docParams).toEqual(["a", "opts", "gone"]);
  const stale = symbol.issues.filter((issue) => issue.rule === "M3");
  expect(stale).toHaveLength(1);
  expect(stale[0]?.detail).toContain("gone");
});

test("marks the phpdoc dialect", async () => {
  const tagged = "<?php\n/**\n * Runs.\n * @param int $a x\n */\nfunction f($a) {}\n";
  expect((await byName(tagged, "f")).dialect).toBe("phpdoc");
  expect((await byName("<?php\n/** Runs it. */\nfunction f() {}\n", "f")).dialect).toBe("");
});

test("reads the return value flag", async () => {
  expect((await byName("<?php\nfunction f(): int {}\n", "f")).returnsValue).toBe(true);
  expect((await byName("<?php\nfunction f(): void {}\n", "f")).returnsValue).toBe(false);
  expect((await byName("<?php\nfunction f(): never {}\n", "f")).returnsValue).toBe(false);
  expect((await byName("<?php\nfunction f(): ?string {}\n", "f")).returnsValue).toBe(true);
  expect((await byName("<?php\nfunction f() {}\n", "f")).returnsValue).toBeUndefined();
});

test("plans a phpdoc block for a typed function", async () => {
  const source = "<?php\nfunction add($a): int { return $a; }\n";
  const plan = planTypeScript(await byName(source, "add"), splitLines(source), "phpdoc");
  if (plan === null) throw new Error("no plan for add");
  const expected = `/**
 * TODO: state what this does, in one active-voice sentence.
 *
 * @param $a TODO: state what it is. Do not repeat the type.
 * @return TODO: state what the caller gets back.
 */
`;
  expect(plan.text).toBe(expected);
  const applied = applyInsertions(source, [plan], (text) => parsesAsPhp("a.php", text));
  expect(applied.ok).toBe(true);
  const again = await byName(applied.text, "add");
  expect(again.issues.some((issue) => issue.rule === "M1")).toBe(false);
  expect(again.issues.some((issue) => issue.rule === "M4")).toBe(true);
  expect(again.dialect).toBe("phpdoc");
});

test("plans no return tag for a void function", async () => {
  const source = "<?php\nfunction v(): void {}\n";
  const plan = planTypeScript(await byName(source, "v"), splitLines(source), "phpdoc");
  if (plan === null) throw new Error("no plan for v");
  expect(plan.text).not.toContain("@return");
});

test("ignores a function inside a heredoc", async () => {
  const source = "<?php\n$s = <<<EOT\nfunction fake() {}\nEOT;\n";
  expect((await symbols(source)).some((symbol) => symbol.name === "fake")).toBe(false);
});

test("reports a parse error", async () => {
  const report = await analysePhp("a.php", "<?php function f( {}");
  expect(report.error).toMatch(/^parse error/);
  expect(report.symbols).toHaveLength(0);
});

test("marks the phpdoc dialect for psalm and phpstan tags", async () => {
  for (const tag of ["psalm-pure", "phpstan-return int"]) {
    const sym = await byName(`<?php\n/**\n * Adds.\n * @${tag}\n */\nfunction add() {}\n`, "add");
    expect(sym.dialect).toBe("phpdoc");
  }
});

test("gives an empty summary to an inline-tag-only doc", async () => {
  const sym = await byName(
    "<?php\nclass B {\n  /** {@inheritDoc} */\n  public function get() {}\n}\n",
    "get",
  );
  expect(sym.summary).toBe("");
});
