import type { SandboxTier } from "./types";

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

/**
 * Generate a macOS seatbelt (sandbox-exec) profile. Best-effort defense-in-depth: starts permissive
 * ("allow default") then confines file writes to the workspace + TMPDIR and gates network by tier.
 * The real boundaries remain env sanitization + cwd confinement; sandbox-exec is deprecated by Apple.
 */
function escapeProfilePath(s: string): string {
  // seatbelt string literals are double-quoted; escape backslashes and quotes to prevent
  // a path like /tmp/work"space from breaking (or escaping) the profile.
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildSandboxProfile(tier: SandboxTier, workspace: string, tmpdir: string): string {
  const ws = escapeProfilePath(workspace);
  const tmp = escapeProfilePath(tmpdir);
  const devWrites = '(literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr") (regex #"^/dev/tty")';
  const writeAllow =
    tier === "read-only"
      ? `(allow file-write*\n    (subpath "${tmp}")\n    ${devWrites})`
      : `(allow file-write*\n    (subpath "${ws}")\n    (subpath "${tmp}")\n    ${devWrites})`;
  const network = tier === "read-only" ? "(deny network*)" : "(allow network*)";
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    writeAllow,
    network,
  ].join("\n");
}

export interface BashInvocation {
  file: string;
  args: string[];
}

/**
 * Decide how to spawn a bash command. With OMCB_SANDBOX_EXEC=1 on macOS (and a non-danger tier),
 * wrap it in sandbox-exec; otherwise run bash directly. Opt-in so the default path is unchanged.
 */
export function bashInvocation(
  command: string,
  opts: { tier: SandboxTier; workspace: string },
): BashInvocation {
  const enabled = process.env.OMCB_SANDBOX_EXEC === "1";
  if (enabled && process.platform === "darwin" && opts.tier !== "danger-full-access") {
    const profile = buildSandboxProfile(opts.tier, opts.workspace, process.env.TMPDIR ?? "/tmp");
    return { file: "sandbox-exec", args: ["-p", profile, "bash", "-c", command] };
  }
  return { file: "bash", args: ["-c", command] };
}
