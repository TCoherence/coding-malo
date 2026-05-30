# Configuration

## Layering (low → high precedence)

1. Built-in defaults
2. Global `~/.codingmalo/config.json` (+ `config.local.json`)
3. Project `<workspace>/.codingmalo/config.json` (+ `.local.json`) — legacy `.omcb/` is still read at
   lower precedence
4. Environment variables (`CODINGMALO_*`, plus `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / …)
5. CLI flags

Objects deep-merge; later layers win. Every string value supports `${env:VAR}` interpolation, so
config files stay commitable without secrets.

> The home directory moved from `~/.omcb` to **`~/.codingmalo`**. An existing `~/.omcb` is migrated
> automatically on first launch.

## Model profiles

Define named profiles and switch between them with `/model <name>` (interactive) or `--model <name>`
(headless). Selecting a profile swaps the whole provider + endpoint + key + model in one step.

```jsonc
// ~/.codingmalo/config.json
{
  "defaultModel": "deepseek",
  "models": {
    "deepseek": {
      "provider": "anthropic",
      "model": "deepseek-v4-flash",
      "baseUrl": "https://api.deepseek.com/anthropic",
      "apiKey": "${env:DEEPSEEK_API_KEY}"
    },
    "gpt-4o": {
      "provider": "openai-compat",
      "model": "gpt-4o",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "${env:OPENAI_API_KEY}"
    }
  },
  "permissionMode": "acceptEdits",
  "sandbox": "workspace-write"
}
```

`defaultModel` / `--model` / `CODINGMALO_MODEL` may be a **profile name** (uses its provider/key/baseUrl)
or a **raw model id** (used on the current top-level provider). See `config.example.json` in the repo
root for a fuller example. Put real secrets in a gitignored `.env` (auto-loaded from the cwd) and
reference them via `${env:VAR}`.

## Banner logo & splash

Drop a `PNG`/`JPG` at `~/.codingmalo/logo.{png,jpg,jpeg,webp}` (or set `"logo": "/abs/path"`).

| Key | Default | Meaning |
|-----|---------|---------|
| `logo` | `~/.codingmalo/logo.*` | banner logo image path |
| `logoWidth` | `22` | logo width in columns (larger = more detail) |
| `logoBg` | `"transparent"` | `"transparent"` drops a near-white background; `"keep"` keeps it |
| `splash` | `true` | animated startup splash (any key skips it) |

## Environment variables

| Variable | Equivalent |
|----------|-----------|
| `CODINGMALO_HOME` | home dir (default `~/.codingmalo`) |
| `CODINGMALO_MODEL` | `--model` |
| `CODINGMALO_PROVIDER` | `--provider` (`anthropic` \| `openai-compat`) |
| `CODINGMALO_BASE_URL` | provider base URL |
| `CODINGMALO_MAX_TURNS` / `CODINGMALO_MAX_TOKENS` | turn / token budgets |
| `CODINGMALO_SPLASH` | `0` disables the startup splash |
| `CODINGMALO_SANDBOX_EXEC` | `1` enables macOS `sandbox-exec` wrapping |
| `CODINGMALO_PROMPT_CACHING`, `CODINGMALO_PARALLEL_TOOL_CALLS`, `CODINGMALO_PASSTHROUGH_ENV` | provider/tooling knobs |

Provider keys use the standard names: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (and `ANTHROPIC_BASE_URL`
/ `OPENAI_BASE_URL`).

## Other config keys

`permissionMode`, `sandbox`, `allowedTools`, `maxTurns`, `maxTokens`, `promptCaching`,
`parallelToolCalls`, `passthroughEnv`, `memory.files`, `mcpServers`, `hooks`. See
`src/config/schema.ts` for the authoritative schema.
