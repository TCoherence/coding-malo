# Contributing to Coding Malo

Thanks for helping out! This is a TypeScript + [Ink](https://github.com/vadimdemedes/ink) project
(Node ≥ 20).

## Setup

```bash
npm install
npm run build      # → dist/cli.js
node dist/cli.js   # try it
```

## Checks (run before opening a PR)

```bash
npm run typecheck  # tsc --noEmit, strict
npm test           # vitest — fast unit suite
npm run e2e        # builds, then real-PTY end-to-end tests (node-pty + @xterm/headless)
```

All three must pass. CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the same on
every PR (typecheck + build + unit on Node 20/22, plus the real-PTY e2e) and **gates merges**.

> Heads up: `node-pty`'s prebuilt `spawn-helper` sometimes lands without the executable bit; the e2e
> harness re-`chmod +x`'s it on startup, so `npm run e2e` works on a fresh `npm install`.

## Architecture rules

Read [docs/architecture.md](docs/architecture.md) first. The non-negotiable one:

- **One engine, N renderers.** `core/engine.ts`'s `run()` generator is the *only* producer of
  protocol events. The TUI, headless renderer, and session writer are independent consumers. Don't
  add side channels that let interactive and headless drift.
- **All Ink/React lives in `src/ui/`** — nothing else imports `react`.
- Prefer the dedicated tool/event types over ad-hoc shapes; keep the headless protocol
  (`src/core/events.ts`) stable — it's a contract (see [docs/headless-protocol.md](docs/headless-protocol.md)).

## Code style

- TypeScript `strict` (+ `noUncheckedIndexedAccess`, `verbatimModuleSyntax`). Use `import type` for
  type-only imports.
- Match the surrounding code's naming, comment density, and idioms.
- New behavior needs a test. UI/terminal behavior that unit tests can't see (cursor, scroll, alt
  screen, resize) goes in the e2e suite — drive the real CLI and assert the rendered screen + cursor.

## Commits & PRs

- Small, focused commits with a clear subject line. Conventional-commit-ish prefixes are welcome but
  not required.
- A PR should keep typecheck + unit + e2e green and update `CHANGELOG.md` (`## [Unreleased]`) when it
  changes user-facing behavior.
- Releases follow [RELEASING.md](RELEASING.md).
