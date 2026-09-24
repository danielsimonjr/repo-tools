/**
 * The generated-file banner of every Markdown report: the verification marker line, then the
 * do-not-edit comment.
 *
 * Port note: the regenerate command is the pre-port text. Fix F3 makes it configurable.
 */

/** The marker line that tells the independent doc verifier to skip a generated report. */
export const VERIFICATION_MARKER = "<!-- repo-map:no-verification -->";

/** The banner text, with its trailing blank line. */
export const GENERATED_REPORT_BANNER = `${VERIFICATION_MARKER}
<!-- GENERATED FILE -- do not edit by hand.
     Regenerate with \`npm run docs:deps\`. -->

`;

/** Returns `body` with the banner in front. */
export function withBanner(body: string): string {
  return GENERATED_REPORT_BANNER + body;
}
