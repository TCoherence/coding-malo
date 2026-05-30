# Headless protocol (`--print`)

In headless mode Coding Malo writes a line-delimited JSON (NDJSON) event stream to stdout — one JSON
object per line. It's designed to be trivial to parse from another process (e.g. an orchestrator that
shells out to Coding Malo in place of `claude` / `codex` / `gemini`).

```bash
codingmalo -p "list files then read package.json" --output-format stream-json
echo "summarize the README" | codingmalo -p
```

## Output formats

`--output-format`:

- `stream-json` (default under `-p`) — every event, one per line.
- `json` — only the `init` and terminal `result` events.
- `text` — only the final `result.text` on stdout (errors go to stderr).

## Events

| `type` | Notes |
|--------|-------|
| `init` | once, first. `session_id`, `model`, `provider`, `workspace`, `tools`, `mcp_servers`, `max_turns` |
| `message_start` | assistant message begins (`agent_id`) |
| `thinking_delta` | extended-thinking text chunk |
| `text_delta` | assistant text chunk (`text`) |
| `tool_start` | `tool_id`, `name`, `input`, `source`, `agent_id`, optional `parent_tool_id` |
| `tool_result` | `tool_id`, `name`, `output`, `is_error` |
| `plan` | current plan state (from `update_plan`) |
| `message_stop` | assistant message ends (`stop_reason`) |
| `usage` | **per-turn** tokens: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `cost_usd` |
| `result` | exactly one, **terminal**, last. `session_id`, `text`, `terminal_reason`, `turns_used`, cumulative `usage`, optional `partial_text`, `error`, `error_kind` |

**Ordering contract:** `init` first; then per-turn events; then exactly one terminal `result` as the
last line.

## Errors & exit codes

On success, exit code `0` and `result` has no `error`. On failure, `result.error` is set and
`result.error_kind` is one of:

`max_turns` · `timeout` · `rate_limit` · `api_5xx` · `auth` · `cli_error`

Exit code is non-zero when `error_kind` is set. Error strings also *contain* the classifiable marker
(e.g. `429 rate limit`, `401 unauthorized`) so a consumer can re-derive the kind if needed.

## Non-interactive permissions

Headless never prompts. A tool that would require approval is **auto-denied** with an explanatory
`tool_result` (the loop continues and the model adapts), so a run can never hang. Pick the gating
posture with `--permission-mode` (e.g. `acceptEdits` gates execute/network; `bypass` auto-allows).

## Relevant flags

`-p, --print [prompt]` · `--output-format` · `--model` · `--provider` · `--resume <session_id>` ·
`--max-turns` · `--system` · `--append-system-prompt` · `--allowed-tools` · `--permission-mode` ·
`--sandbox` · `--image <path>` · `--workspace <dir>` · `--force-workspace`. Run `codingmalo --help`
for the full surface.

## Sessions & resume

Each run is persisted to `~/.codingmalo/sessions/<id>.jsonl`. `--resume <session_id>` reconstructs the
prior conversation (validated against the current workspace) and continues it.
