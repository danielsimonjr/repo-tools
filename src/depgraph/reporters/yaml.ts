/**
 * dependency-graph.yaml: the dependency-graph.json object as YAML.
 *
 * Fix F4: the reporter uses js-yaml 5. js-yaml 5 has no default export and no `quotingType`
 * option.
 */
import { dump } from "js-yaml";

/** The dependency-graph.yaml text. */
export function generateYaml(json: object): string {
  return dump(json, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    forceQuotes: false,
  });
}
