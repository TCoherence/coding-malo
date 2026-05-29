# oh-my-coding-buddy (omcb)

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

Set `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_BASE_URL` / `OMCB_BASE_URL` for a gateway).

## Headless protocol (NDJSON)

Events: `init`, `message_start`, `thinking_delta`, `text_delta`, `tool_start`, `tool_result`,
`plan`, `message_stop`, `usage` (per-turn), and exactly one terminal `result` (cumulative `usage`,
optional `error` + `error_kind`). `usage`/`error_kind`/`session_id` field names map directly onto
oh-my-agent's `AgentResponse`. Exit code is non-zero when `error_kind` is set.
`--output-format`: `stream-json` (default), `json` (init+result only), `text` (final text only).

## Status

**M0 shipped** (thin end-to-end vertical slice): Anthropic streaming provider, agent loop, builtin
tools (Bash/Read/Write/Edit), minimal permission engine + env sandbox, session store + `--resume`,
headless print mode, and a minimal Ink TUI. 22 tests pass; typecheck + build clean.

Roadmap: **M1** providers hardening (prompt caching, thinking, OpenAI-compat, cost) · **M2**
permissions + sandbox · **M3** oh-my-agent `OmcbCLIAgent` adapter · **M4** config/memory/slash/hooks
· **M5** MCP + Skills · **M6** sub-agents + planning · **M7** TUI polish + packaging. See the plan at
`~/.claude/plans/mighty-whistling-nest.md`.
