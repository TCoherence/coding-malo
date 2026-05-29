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

/**
 * Symlink-aware containment check for the permission engine's acceptEdits boundary. Canonicalizes
 * the longest existing ancestor of `abs` so a symlink can't make an out-of-workspace path look
 * inside. Returns false for anything that resolves outside `cwd`.
 */
function canonicalize(p: string): string {
  // realpath the longest existing ancestor (resolving symlinks), then re-append the missing tail.
  let existing = p;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const real = realpathSafe(existing);
  const tail = path.relative(existing, p);
  return tail ? path.join(real, tail) : real;
}

export function isWithinWorkspace(cwd: string, abs: string): boolean {
  // Canonicalize BOTH sides the same way so a not-yet-created root (or a symlinked /tmp) compares
  // consistently with the target.
  const root = canonicalize(path.resolve(cwd));
  const target = canonicalize(abs);
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel));
}
