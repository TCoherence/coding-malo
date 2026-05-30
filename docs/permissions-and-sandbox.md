# Permissions & sandbox

Two orthogonal axes guard what tools may do.

## Permission modes (`--permission-mode`)

| Mode | Behavior |
|------|----------|
| `plan` | read-only; mutations are recorded as proposed and auto-denied with an explanatory result |
| `default` | gate risky operations (execute, network, out-of-workspace) via the approval flow |
| `acceptEdits` | auto-allow low-danger in-workspace file edits; still gate execute / network |
| `bypass` | allow everything (also via `--dangerously-skip-permissions`) |

**Evaluation order** (`src/permissions/`): allowlist (`--allowed-tools`) → compute resource + effects
→ protected-path deny (`.git/`, `~/.ssh/`, `*.env`, `**/secrets*` for write/execute, even under bypass)
→ explicit deny rules → `bypass` allow → `plan` read-only → sandbox-tier gate → explicit allow rules →
remembered approvals → mode auto-allow → otherwise prompt.

- **Interactive:** an approval modal — `[a]` allow once, `[s]` allow this session, `[p]` allow +
  remember (persisted to `~/.codingmalo/approvals/`), `[d]` deny.
- **Headless:** never prompts — a gate that would prompt **auto-denies** with an explanatory
  `tool_result`, so the loop always terminates.

## Sandbox tiers (`--sandbox`)

`read-only` · `workspace-write` (default) · `danger-full-access`.

Layered defense:

- **Layer 0 — env sanitization (always):** subprocess env is a whitelist (`PATH`, `HOME`, `USER`,
  `LANG`, `TERM`, `SHELL`, `TMPDIR`, `XDG_*`, …) + configured `passthroughEnv` + injected
  `OMA_AGENT_HOME`. **Model API keys are stripped from tool subprocesses** (the model client keeps
  them in-process).
- **Layer 1 — cwd confinement (always):** path tools reject traversal outside the workspace
  (symlink-aware).
- **Layer 2 — macOS `sandbox-exec` (opt-in):** set `CODINGMALO_SANDBOX_EXEC=1` on a non-danger tier to
  wrap Bash in a generated profile (file-write only under workspace + TMPDIR, network denied unless
  allowed). Best-effort defense-in-depth (Apple-deprecated); Layers 0 and 1 are the real boundary.

Linux `bwrap` is not yet implemented.
