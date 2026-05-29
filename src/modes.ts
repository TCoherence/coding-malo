export type RunMode = "print" | "interactive";

/** Print mode if asked explicitly or if stdin is piped (no TTY for an interactive editor). */
export function detectMode(opts: { print: boolean; stdinIsTty: boolean }): RunMode {
  if (opts.print) return "print";
  if (!opts.stdinIsTty) return "print";
  return "interactive";
}
