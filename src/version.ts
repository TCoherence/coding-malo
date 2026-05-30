import pkg from "../package.json";

/**
 * The Coding Malo version, shown by `--version` and in the TUI banner.
 * Single source of truth = package.json's "version" (inlined at build time). Bump with `npm version`.
 */
export const VERSION: string = pkg.version;
