/**
 * dependency-graph.yaml: the dependency-graph.json object as YAML.
 *
 * Port note: js-yaml is pinned to 4.3.2, the version of the goldens. Fixes F4 and F5 move to
 * js-yaml 5 with a quote-style probe.
 */
import yaml from "js-yaml";

/** The dependency-graph.yaml text. */
export function generateYaml(json: object): string {
  return yaml.dump(json, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    forceQuotes: false,
  });
}
