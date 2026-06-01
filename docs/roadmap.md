# Coding Malo — roadmap (draft)

A lightweight, evolving roadmap. Anchored to the **SWE-bench Lite baseline** so each milestone has a
measurable target. Details get refined per-milestone; this is the shape, not a contract.

## Where we are — v0.1.0 baseline (2026-05-31)

- **SWE-bench Lite, 20-task stratified subset: ~55–60% resolved**, `deepseek-v4-flash`, generic prompt.
  60% (12/20) host mode; 55% (11/20) in the faithful docker env (1-instance noise). ~$0.07/run,
  ~$1 projected full-300. Reproducible (`eval/swebench`).
- Failure analysis of the misses (`eval/swebench/analysis/v0.1.0-failure-analysis.md`): **tooling /
  localization is not the bottleneck** — 8/8 found the right file and applied cleanly, 0 regressions.
  The gap is the **agent loop**: it writes a plausible but partial/wrong fix and stops.

## What we tried and ruled out (experiments, see `eval/swebench/analysis/experiments.md`)

The two cheap knobs — a prompt nudge and a bigger model — were tested and **do not help**:

- ❌ **"verify before done" prompt** (understand-first / minimal / cover-sites / run-tests): refuted on
  v4-flash (host −20pt, confounded by a depless env; docker −1pt, clean) **and** v4-pro (no change).
- ❌ **Model tier (v4-pro)**: 9/20 (45%) — *worse* than v4-flash (11/20) at ~4× cost, solving a strict
  subset. The five runs' resolved sets are monotonically nested; a stronger model adds nothing here.

**Conclusion:** ~60% is the ceiling of model + prompt on the current scaffold. **Further gains require
a *structural* (harness/scaffold) change, not a knob twist.** Why prompt "verify" fails: SWE-bench's
graded `FAIL_TO_PASS` tests aren't in the repo at base_commit, so running the existing suite can't
catch the actual graded failure — the agent must *construct* the check itself.

## ✅ Delivered — faithful eval harness

- `run_smoke.py --agent-in-docker`: runs the agent **inside the SWE-bench instance image** (deps
  installed, tests runnable, same env the scorer uses). Pure-JS agent bind-mounted cross-arch.
- `--extra-prompt-file`: A/B prompt variants against the same build (one flag, no rebuild).
- This is the foundation every "verification"-style scaffold experiment now builds on.

## v0.2 — repro-first scaffold (next; the real lever)

Goal: turn "located + applied" into "correct" by giving the agent the check it's missing. Structural,
because prompt-level nudges were shown not to stick on these models.

1. **Repro-first loop** *(lead)* — the scaffold drives the agent to **write a failing reproduction
   from the issue, confirm it fails, fix, then confirm the repro passes** before finishing. This
   supplies the check the held-out `FAIL_TO_PASS` would, and directly attacks the dominant
   incomplete/wrong-fix mode.
2. **Structure in the loop, not the prompt** — orchestrate phases (locate → reproduce → fix →
   run repro + nearby tests → sweep sibling sites → done), possibly via sub-agents, rather than
   asking the model to self-discipline (which it ignores / over-thinks).
3. **Re-benchmark** in the docker env (baseline vs scaffold, same 20) → if it lifts, confirm on full
   Lite-300 for a defensible headline number.

## v0.3 — agent-loop hardening & eval breadth

- **Tooling**: add real `Grep`/`Glob`/`MultiEdit` (today only `Bash` exists; CHANGELOG over-listed
  them). Not the current bottleneck, but reduces turns/friction.
- **Convergence / robustness**: turn-budget awareness, reflection/replan; Bash 200KB output-cap
  safety for large test logs; a global `--timeout` wall-clock flag.
- **Eval breadth**: full SWE-bench Lite-300 standing number; multi-seed to bound the ±11% variance;
  a Terminal-Bench 2.0 / Harbor adapter (scoped in `omcb-evaluation`); Aider polyglot smoke.

## Parked / not yet scheduled

- **oh-my-agent integration** (branch `codingmalo-integration`) — deferred by request.
- Node 20 GitHub Actions deprecation; `package.json` `private` flag while unpublished.
