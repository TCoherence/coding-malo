# Architecture

Coding Malo is built on one structural rule: **one engine, N renderers.**

A single agent loop is the only thing that produces protocol events. The interactive TUI, the
headless JSON renderer, and the session writer are independent *consumers* of that one event stream —
so interactive and headless mode can never drift.

```
 stdin / TTY ─► cli.tsx ─► modes.ts ─┬─ interactive ─► Ink TUI (store + App)
                                     └─ --print      ─► JsonRenderer (NDJSON)
                                              │  both drain the same OmcbEvent stream
                                              ▼
                                   core/engine.ts  ── async function* run(): OmcbEvent
                                              │                    └─► session JSONL writer (3rd drain)
                          ┌───────────────────┴───────────────────┐
                          ▼                                        ▼
                  providers/* (anthropic | openai-compat)   tools/* (registry + builtins)
                                                             permissions/* (modes + sandbox)
```

## The loop (`src/core/engine.ts`)

`run()` is an async generator: it emits one `init`, then loops up to `maxTurns` —
`provider.stream()` → re-emit normalized events (`text_delta` / `thinking_delta` / `tool_start` /
per-turn `usage`) → on `tool_use`, run hooks → permission gate → execute tools in parallel → emit
`tool_result` → continue; on `end_turn`, emit the terminal `result` and return. One `AbortSignal`
threads into the provider `fetch` and every tool subprocess. `result.usage` is cumulative.

## Module layout

| Path | Responsibility |
|------|----------------|
| `src/core/` | engine, event types/protocol, store, session store, usage/cost, errors, driver |
| `src/providers/` | `anthropic`, `openai-compat`, request/response mappers, registry |
| `src/tools/` | tool registry + builtins (Bash, Read, Write, Edit, Grep, …) |
| `src/permissions/` | permission engine, modes, rules, approvals, sandbox, prompters |
| `src/agent/` | sub-agents (`Task`) + `TaskManager` |
| `src/mcp/` | MCP client (stdio + http) + manager |
| `src/skills/` | Skills discovery + progressive disclosure |
| `src/memory/`, `src/commands/`, `src/hooks/`, `src/config/` | memory walk-up, slash commands, lifecycle hooks, layered config |
| `src/ui/` | **all** Ink/React — nothing else imports react |
| `src/headless/` | `JsonRenderer` (OmcbEvent → NDJSON) |

## Rendering model

The TUI renders **inline** in the normal terminal buffer (no alternate screen), like Claude Code and
Codex: completed turns go into Ink's `<Static>` (terminal scrollback), and only the live region +
prompt are repainted at the bottom. This keeps native scrollback and mouse-wheel scrolling, and the
session stays visible after exit. On a width *decrease* the app does a clean full repaint (the
terminal reflows old lines, which Ink's relative erase can't fully clear), re-emitting the transcript
at the new width.

State lives in a framework-agnostic vanilla `Store` (`src/core/store.ts`); the engine and session
writer read/write it without React, and Ink subscribes via `useSyncExternalStore`.

## Why direct-to-API

Coding Malo calls model HTTP APIs directly (native Anthropic + a generic OpenAI-compatible adapter)
rather than depending on any vendor CLI or SDK, so it can serve as a stable, self-contained drop-in
behind orchestrators. See [headless-protocol.md](headless-protocol.md) for the integration contract.
