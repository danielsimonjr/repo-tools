/**
 * The generated-file banner of every Markdown report (fix F3): the verification marker line,
 * then the do-not-edit comment that names the regenerate command.
 */

/** The default marker line that tells the independent doc verifier to skip a generated report. */
export const VERIFICATION_MARKER = "<!-- repo-map:no-verification -->";

/** The default regenerate command that the banner names. */
export const DEFAULT_REGENERATE_COMMAND = "repo-tools depgraph";

/** The options of the banner of a Markdown report: the regenerate command and the marker line. */
export interface BannerOptions {
  /** The command that regenerates the reports. Default: `repo-tools depgraph`. */
  command?: string;
  /** The marker line. `null` omits it. Default: `VERIFICATION_MARKER`. */
  marker?: string | null;
}

/** Returns the banner text, with its trailing blank line. */
export function bannerFor(options: BannerOptions): string {
  const command = options.command ?? DEFAULT_REGENERATE_COMMAND;
  const marker = options.marker === undefined ? VERIFICATION_MARKER : options.marker;
  const comment = `<!-- GENERATED FILE -- do not edit by hand.\n     Regenerate with \`${command}\`. -->\n\n`;
  return marker === null ? comment : `${marker}\n${comment}`;
}

/** Returns `body` with the banner in front. */
export function withBanner(body: string, options: BannerOptions = {}): string {
  return bannerFor(options) + body;
}
