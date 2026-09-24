/**
 * Shared types for command output. Subcommand modules import `Io` from here, so they do not
 * import `cli.ts` and no import cycle can occur.
 */

/** Output sinks. Tests capture them; `bin.ts` connects them to the process. */
export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}
