/**
 * Env sanitization — the real boundary in M0 (full sandbox-exec arrives in M2). Mirrors
 * oh-my-agent's whitelist exactly. Model API keys are intentionally NOT forwarded to tool
 * subprocesses; the in-process model client reads them from process.env directly.
 */
const SAFE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "SHELL",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
];

export function sanitizeEnv(
  passthrough: string[] = [],
  extra: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of [...SAFE_ENV_KEYS, ...passthrough]) {
    const value = process.env[key];
    if (value !== undefined) out[key] = value;
  }
  Object.assign(out, extra);
  return out;
}
