/**
 * dependency-graph.yaml: the dependency-graph.json object as YAML.
 *
 * Fix F4: the reporter uses js-yaml 5. js-yaml 5 has no default export and no `quotingType`
 * option.
 *
 * Fix F5: the quote option sets the quote character of every scalar that needs quotes. A
 * js-yaml copy that ignores the option gives a report that differs in quote characters only.
 * Before each report, a probe checks the behavior of the loaded copy, not its version string.
 */
import { dump } from "js-yaml";

/** The quote style of the report. It is the js-yaml 4 default, so the goldens keep their bytes. */
const QUOTE_STYLE = "single";

/**
 * Throws when `dumpFn` does not obey the `quoteStyle` option. The probe dumps one string that
 * needs quotes with each style and checks the quote character.
 */
export function probeQuoteStyle(dumpFn: typeof dump): void {
  const single = dumpFn({ probe: "a: b" }, { quoteStyle: "single" }).trim();
  const double = dumpFn({ probe: "a: b" }, { quoteStyle: "double" }).trim();
  if (single !== "probe: 'a: b'" || double !== 'probe: "a: b"') {
    throw new Error(
      "the loaded js-yaml ignores the quoteStyle option (quote-style probe failed).\n" +
        `  expected: probe: 'a: b'   and   probe: "a: b"\n` +
        `  got     : ${single}   and   ${double}\n` +
        "Install the js-yaml version that package.json pins (js-yaml 5), then run again.",
    );
  }
}

/** The dependency-graph.yaml text. `dumpFn` is the js-yaml `dump`; a test can replace it. */
export function generateYaml(json: object, dumpFn: typeof dump = dump): string {
  probeQuoteStyle(dumpFn);
  return dumpFn(json, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    quoteStyle: QUOTE_STYLE,
    forceQuotes: false,
  });
}
