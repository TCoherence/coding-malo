# Changelog

All notable changes to **Coding Malo** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [0.1.0] — 2026-05-29

First working version: a full interactive terminal coding agent plus a headless
NDJSON mode, talking directly to model HTTP APIs (no vendor CLI/SDK).

### Added

- **Agent engine** — one `async function*` event loop (`core/engine.ts`) feeding the
  Ink TUI, the headless JSON renderer, and the session JSONL writer ("one engine, N renderers").
- **Providers** — native Anthropic Messages API (streaming, prompt caching, extended thinking) and a
  generic OpenAI-compatible adapter (chat.completions SSE, tool-call assembly). Cost accounting and
  status-first error classification.
- **Built-in tools** — `Bash`, `Read`, `Write`, `Edit`, `MultiEdit`, `Grep`, `Glob`, `Ls`,
  `WebFetch`, `WebSearch`, `Image`, `update_plan`, `Task` (sub-agents), `Skill`.
- **Permissions & sandbox** — modes `plan` / `default` / `acceptEdits` / `bypass`, an interactive
  approval modal with remembered decisions, env sanitization, cwd confinement, opt-in macOS
  `sandbox-exec`. Headless gates auto-deny (never hangs).
- **Interactive TUI** — streaming text + thinking, live tool-call cards, plan panel, `/model` picker,
  slash commands (`/help` `/model` `/clear` `/cost` `/quit` + project commands), input history,
  cursor editing (←/→, Home/End), double-Ctrl-C to exit.
- **Banner & splash** — half-block truecolor logo from `~/.codingmalo/logo.{png,jpg,jpeg}` (near-white
  background dropped to transparent), with an animated startup splash that self-clears.
- **CJK input** — the real terminal cursor tracks the caret (via Ink 7 `useCursor`), so IME candidate
  windows anchor correctly.
- **Inline rendering** — renders in the normal terminal buffer (like Claude Code / Codex): native
  scrollback, mouse-wheel scrolling, and the session stays visible after exit. Clean repaint on resize.
- **Headless `--print`** — NDJSON event protocol (`init`, `text_delta`, `tool_start`, `tool_result`,
  `usage`, terminal `result`, …) with `stream-json` / `json` / `text` output formats and meaningful
  exit codes. See [docs/headless-protocol.md](docs/headless-protocol.md).
- **Sessions** — JSONL session store with `--resume` (workspace-validated).
- **Config** — layered (defaults → `~/.codingmalo` → project `.codingmalo` → env → flags), `${env:VAR}`
  interpolation, named model profiles. See [docs/configuration.md](docs/configuration.md).
- **Extensibility** — MCP client (stdio + http), Skills (progressive disclosure), project memory
  (`AGENTS.md` / `CLAUDE.md`), markdown slash commands, lifecycle hooks.
- **oh-my-agent integration** — a Python `OmcbCLIAgent` adapter (on the `codingmalo-integration`
  branch of that repo) drives Coding Malo as a drop-in for `claude` / `codex` / `gemini`.
- **Tests** — 84 unit tests (vitest) + 17 real-PTY end-to-end tests (`node-pty` + `@xterm/headless`,
  run via `npm run e2e`) covering the interactive TUI, headless protocol, and permission flows.

[Unreleased]: https://github.com/TCoherence/coding-malo/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/TCoherence/coding-malo/releases/tag/v0.1.0
