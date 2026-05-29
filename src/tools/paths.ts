import fs from "node:fs";
import path from "node:path";

import { OmcbError } from "../core/errors";

function realpathSafe(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Resolve a path and reject anything that escapes the workspace root — including via symlinks.
 * The longest existing ancestor is canonicalized with realpath (so a symlink can't point out of
 * the workspace), while not-yet-created paths (e.g. Write targets) are still allowed.
 */
export function resolveInsideWorkspace(cwd: string, p: string): string {
  const root = realpathSafe(path.resolve(cwd));
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(root, p);

  let existing = abs;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const realExisting = realpathSafe(existing);
  const tail = path.relative(existing, abs);
  const canonical = tail ? path.join(realExisting, tail) : realExisting;

  const rel = path.relative(root, canonical);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    throw new OmcbError("cli_error", `path escapes the workspace: ${p}`);
  }
  return canonical;
}

/** Resolve without throwing — for permission `resource()` display/matching. */
export function resolveForDisplay(cwd: string, p: string): string {
  return path.isAbsolute(p) ? path.resolve(p) : path.resolve(cwd, p);
}
