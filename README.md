# Coding Malo

> 命令 `codingmalo`（亦保留别名 `omcb`）。配置与会话目录在 `~/.codingmalo`（旧的 `~/.codingmalo` 首次启动自动迁移）。
> 环境变量前缀为 `CODINGMALO_`（如 `CODINGMALO_MODEL`）。内部类型名仍沿用 `Omcb*`。

A terminal coding agent that talks **directly to model APIs** (Anthropic Messages API today; a
generic OpenAI-compatible adapter next) — no dependency on any vendor CLI/SDK. It is both an
interactive Ink TUI and a headless `--print` mode that emits a clean NDJSON event protocol, so it
can drop in behind orchestrators like `oh-my-agent` in place of `claude`/`codex`/`gemini`.

## Architecture: one engine, N renderers

A single agent loop — `core/engine.ts`, `async function* run(): AsyncIterable<OmcbEvent>` — is the
only producer of protocol events. The Ink TUI, the headless JSON renderer, and the session JSONL
writer are independent consumers of that one stream, so interactive and headless can never drift.

```
cli.tsx → modes.ts ─┬─ interactive → Ink TUI (store + App)
                    └─ --print     → JsonRenderer (NDJSON)   both drain the same OmcbEvent stream
                                   ↓
                        core/engine.ts (the loop)
                                   ↓
              providers/* (anthropic | openai-compat)   tools/* (registry + builtins)
                                                          permissions/* (modes + sandbox)
```

## Develop

```bash
npm install
npm run build      # → dist/cli.js (executable, shebang)
npm run typecheck
npm test           # vitest

# run it
node dist/cli.js                       # interactive (needs a TTY)
node dist/cli.js -p "list files"       # headless NDJSON
echo "summarize README" | node dist/cli.js
```

**Models & secrets.** Put API keys in `.env` (gitignored, auto-loaded — copy `.env.example`). Define
named **model profiles** in `config.json` (global `~/.codingmalo/config.json` or project `.codingmalo/config.json`),
each with its own `provider` / `model` / `baseUrl` / `apiKey` — reference keys via `${env:VAR}` so the
file stays commitable (no secrets). See `config.example.json`. Switch with `/model <name>` (interactive)
or `--model <name>` (headless): this swaps the whole provider + endpoint + key + model in one step.

**Interactive commands:** `/model [name]`, `/help`, `/clear`, `/cost`, `/quit`, plus markdown commands in
`.codingmalo/commands/`. `↑/↓` recall history. Tool calls render as live cards; the header shows the model.

**Banner logo + splash.** Drop a PNG/JPG at `~/.codingmalo/logo.{png,jpg,jpeg}` (or set
`"logo": "/abs/path"` in config.json) and it renders as half-block truecolor in any 24-bit terminal.
A near-white background is dropped to transparent by default (set `"logoBg": "keep"` to keep it);
`"logoWidth"` (default 22) controls detail. On an interactive launch a larger animated **splash** of
the same logo plays first (any key skips it; `"splash": false` or `CODINGMALO_SPLASH=0` disables it).
With no image, a built-in block-art monkey is shown.

## Headless protocol (NDJSON)

Events: `init`, `message_start`, `thinking_delta`, `text_delta`, `tool_start`, `tool_result`,
`plan`, `message_stop`, `usage` (per-turn), and exactly one terminal `result` (cumulative `usage`,
optional `error` + `error_kind`). `usage`/`error_kind`/`session_id` field names map directly onto
oh-my-agent's `AgentResponse`. Exit code is non-zero when `error_kind` is set.
`--output-format`: `stream-json` (default), `json` (init+result only), `text` (final text only).

## Status — all milestones shipped (M0–M7)

- **M0** — engine spine: Anthropic streaming, agent loop, builtin tools (Bash/Read/Write/Edit), session store + `--resume`, headless print mode, Ink TUI.
- **M1** — providers: Anthropic prompt-caching + extended thinking, OpenAI-compatible adapter, cost accounting, status-first error classification.
- **M2** — permissions + sandbox: modes (plan/default/acceptEdits/bypass), interactive approval modal + remembered decisions, env sanitization, opt-in macOS `sandbox-exec`.
- **M3** — oh-my-agent integration: a Python `OmcbCLIAgent` adapter (`/Users/yanghanzhi/repos/oh-my-agent`) that drives omcb as a drop-in for claude/codex/gemini.
- **M4** — layered config (`${env:}`, zod), project memory (AGENTS.md/CLAUDE.md), markdown slash commands, lifecycle hooks (Pre/PostToolUse, UserPromptSubmit, Session*, Stop).
- **M5** — MCP client (stdio + http) + Skills (SKILL.md progressive disclosure).
- **M6** — sub-agents (`Task`, fg/bg via `TaskManager`) + planning (`update_plan` + live plan panel).
- **M7** — TUI polish (delta coalescing, input history, double-Ctrl-C) + npm packaging.

83 tests pass; typecheck + build clean; both provider paths and the oh-my-agent integration verified
live against DeepSeek. Full plan: `~/.claude/plans/mighty-whistling-nest.md`.
