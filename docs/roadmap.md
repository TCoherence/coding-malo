# Coding Malo — roadmap (draft)

A lightweight, evolving roadmap. Anchored to the **v0.1.0 SWE-bench Lite baseline** so each milestone
has a measurable target. Details get refined per-milestone; this is the shape, not a contract.

## Where we are — v0.1.0 baseline (2026-05-31)

- **SWE-bench Lite (20-task stratified subset): 60% resolved (12/20)**, $0.069 total (~$1 projected full-300),
  `deepseek-v4-flash`, generic prompt. Reproducible (`eval/swebench`, runner committed).
- Failure analysis of the 8 misses (`eval/swebench/analysis/v0.1.0-failure-analysis.md`):
  **tooling is not the bottleneck** — 8/8 located the right file and applied cleanly, 0 regressions.
  The gap is the **agent loop**: it writes a plausible but partial/wrong fix and **stops without
  verifying** (7/8 would be caught by running the target test once).

## v0.1.x — "verify before done" (next; cheap, prompt/scaffold, model-agnostic)

Goal: convert located-and-applied edits into *correct* edits. Target: lift the 20-subset and then
confirm on full Lite 300.

1. **Self-verification loop** *(addresses ~7/8)* — after editing, find & run the relevant tests (or
   write a reproduction from the issue) and iterate until green, before declaring done.
2. **Completeness sweep** *(addresses the 4 incomplete fixes)* — after the first edit, search for
   sibling call-sites / mirror paths (read↔write, all asserts of a kind) before finishing.
3. **Read tests + issue hints first** *(addresses the 2 spec misses)* — when a test file or
   `hints_text` exists, consult it to pin the exact symbol name / signature / output shape.
4. **Minimal-change bias** *(addresses over-engineering, incl. the only max_turns timeout)*.
5. **Re-benchmark** the same 20 → measure lift → run full Lite 300 for a headline number.

## v0.2 — agent-loop & scaffold hardening

- **Convergence**: turn-budget awareness ("running low → consolidate"), a reflection/replan step.
- **Test-running as a first-class affordance** (not just prompted) — make verification reliable.
- **Output-truncation safety**: the 200KB Bash output cap could truncate large test logs (latent
  risk, not yet a failure cause) — chunk/scroll or summarize.
- **Global `--timeout`** wall-clock flag (today: max-turns + per-Bash 120s + external kill).

## v0.3 — model & eval breadth

- **Model tier experiments**: try `deepseek-v4-pro` / reasoner on the reasoning-bound cases;
  compare resolved-rate vs cost (baseline pro projection ≈ $2.35 full-300).
- **Eval breadth**: full SWE-bench Lite 300 as the standing number; a Terminal-Bench 2.0 / Harbor
  adapter (already scoped — see the `omcb-evaluation` notes) for environment-based scoring;
  Aider polyglot as a light functional smoke.

## Parked / not yet scheduled

- **oh-my-agent integration** (branch `codingmalo-integration`) — deferred by request.
- Node 20 GitHub Actions deprecation; `package.json` `private` flag while unpublished.
