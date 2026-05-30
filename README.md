# Coding Malo 🐒

A terminal coding agent that talks **directly to model HTTP APIs** — no dependency on any vendor
CLI or SDK. It's both an interactive [Ink](https://github.com/vadimdemedes/ink) TUI (like Claude Code
/ Codex) and a headless `--print` mode that emits a clean NDJSON event protocol, so it can also drop
in behind orchestrators in place of `claude` / `codex` / `gemini`.

Command: **`codingmalo`** (alias `omcb`). Config & sessions live in `~/.codingmalo`.

## Features

- **Direct to model APIs** — native Anthropic Messages API (streaming, prompt caching, extended
  thinking) + a generic OpenAI-compatible adapter (OpenAI, DeepSeek, Gemini, gateways).
- **Real coding agent** — Bash / Read / Write / Edit / Grep / Glob / Web / sub-agents (`Task`) /
  planning, with a permission engine + sandbox.
- **Polished TUI** — streaming text & thinking, live tool cards, `/model` picker, slash commands,
  input history & cursor editing, correct CJK/IME caret, inline rendering (keeps native scrollback).
- **Headless NDJSON** — a stable [event protocol](docs/headless-protocol.md) with exit codes, for
  scripting and orchestration.
- **Extensible** — MCP (stdio + http), Skills, project memory (`AGENTS.md`/`CLAUDE.md`), markdown
  slash commands, lifecycle hooks, layered config with model profiles.

## Quickstart

Requires Node ≥ 20.

```bash
npm install
npm run build                          # → dist/cli.js

node dist/cli.js                       # interactive (needs a TTY)
node dist/cli.js -p "list files"       # headless, NDJSON on stdout
echo "summarize the README" | node dist/cli.js -p
```

Put a key in a gitignored `.env` (auto-loaded — copy `.env.example`) and a model profile in
`~/.codingmalo/config.json` (see `config.example.json`):

```jsonc
{
  "defaultModel": "deepseek",
  "models": {
    "deepseek": { "provider": "anthropic", "model": "deepseek-v4-flash",
                  "baseUrl": "https://api.deepseek.com/anthropic", "apiKey": "${env:DEEPSEEK_API_KEY}" }
  }
}
```

Switch models live with `/model <name>` (or `--model <name>` headless). Full reference:
[docs/configuration.md](docs/configuration.md).

## Interactive commands

`/model [name]` · `/help` · `/clear` · `/cost` · `/quit`, plus markdown commands in
`.codingmalo/commands/`. `↑/↓` recall history; `←/→`, `Ctrl+A`/`Ctrl+E` move the caret; double
`Ctrl+C` exits.

**Banner & splash.** Drop a `PNG`/`JPG` at `~/.codingmalo/logo.{png,jpg,jpeg}` for a half-block
truecolor logo (near-white background dropped automatically; animated splash on launch). Tunable via
`logo` / `logoWidth` / `logoBg` / `splash` — see [docs/configuration.md](docs/configuration.md).

## Headless protocol

```bash
codingmalo -p "list files then read package.json" --output-format stream-json
```

Emits `init` → per-turn events (`text_delta`, `tool_start`, `tool_result`, `usage`, …) → exactly one
terminal `result`. `--output-format` is `stream-json` (default) / `json` / `text`; exit code is
non-zero when `result.error_kind` is set. Full spec: [docs/headless-protocol.md](docs/headless-protocol.md).

## Documentation

- [Architecture](docs/architecture.md) — "one engine, N renderers", module layout, rendering model
- [Configuration](docs/configuration.md) — layering, model profiles, env vars, logo/splash
- [Headless protocol](docs/headless-protocol.md) — the NDJSON event contract
- [Permissions & sandbox](docs/permissions-and-sandbox.md) — modes, approval flow, sandbox tiers
- [Contributing](CONTRIBUTING.md) · [Releasing](RELEASING.md) · [Changelog](CHANGELOG.md)

## Development

```bash
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest — unit
npm run e2e         # real-PTY end-to-end (node-pty + @xterm/headless): builds, then drives the
                    # built CLI in a pseudo-terminal and asserts the rendered screen + cursor
```

CI runs all of these on every PR (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Status

All milestones shipped (M0–M7): engine + providers + tools + permissions/sandbox + interactive TUI +
headless protocol + sessions/`--resume` + MCP + Skills + sub-agents/planning + memory/commands/hooks.
**84 unit tests + 17 end-to-end tests** green; typecheck + build clean; both provider paths verified
live against DeepSeek.

## License

[MIT](LICENSE) © Hanzhi Yang
