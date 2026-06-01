# SWE-bench Lite — optimization experiments log

Each entry: a single-variable change vs the standing baseline, measured on the **same deterministic
20-task repo-stratified subset** (`--subset 20 --model deepseek-v4-flash --max-turns 40 --workers 4`).

> ⚠️ Variance caveat: `deepseek-v4-flash` is non-deterministic, and 20 tasks give a wide CI (~±11% 1σ).
> A single run shows direction, not a precise delta. Trust a result more when a mechanism explains it.

| # | change | env | resolved | Δ | cost (20) | verdict |
|---|---|---|---|---|---|---|
| — | **v0.1.0 baseline** (generic prompt) | host (no deps) | **12/20 = 60%** | — | $0.069 | standing baseline |
| 1 | "verify before done" prompt (baked in) | host (no deps) | 8/20 = 40% | −20pt | $0.082 | ❌ reverted (confounded by depless env) |
| 2a | baseline prompt, **agent-in-docker** | docker (deps) | 11/20 = 55% | ≈baseline (−1, noise) | $0.068 | docker mode validated ≈ host |
| 2b | verify prompt (`--append`), agent-in-docker | docker (deps) | 10/20 = 50% | **−1 vs docker-baseline** | $0.085 (+26%) | ❌ verify prompt doesn't help v4-flash |
| 3a | **deepseek-v4-pro** baseline, agent-in-docker | docker (deps) | 9/20 = 45% | −2 vs flash-docker | $0.274 (~4×) | ❌ pro worse than flash here |
| 3b | v4-pro + verify prompt, agent-in-docker | docker (deps) | 9/20 = 45% | 0 vs pro-baseline | $0.255 | ❌ verify doesn't help v4-pro either |

---

## Exp 1 — "verify before you finish" system prompt (REVERTED)

**Hypothesis:** the v0.1.0 failures were located+applied correctly but stopped at unverified partial
fixes (`v0.1.0-failure-analysis.md`). A 4-step prompt — understand-first (read tests/hints), minimal
change, cover all sites, verify by running tests — should lift resolved rate.

**Result:** **regressed 60% → 40%** (8/20). Net −4, zero new fixes; turns and cost up ~18%.
Lost 4 previously-passing: `seaborn-2848`, `pylint-5859`, `scikit-10297`, `sphinx-10325`.

**Mechanism (not noise — evidenced):**
- All 4 regressions failed on the **FAIL_TO_PASS** test (the fix got *worse*), **not** PASS_TO_PASS
  regressions. So the model produced worse patches despite more turns.
- **7/20 predictions contained test-run artifacts** (`.hypothesis/…/charmap.json.gz`, etc.) → proof
  the agent followed the "run tests" instruction and actually ran the suite.
- But the harness runs the agent in a **bare `git clone` with no installed dependencies**, so those
  test runs produce misleading errors (ImportError, etc.). The weak model over-reacted: it
  **relocated to the wrong file** (`seaborn-2848`: `_oldcore.py` → `axisgrid.py`) and **rewrote
  correct minimal patches into broken ones**.
- Total diff volume was unchanged (509 → 509 lines): this is a **quality** regression (wrong/worse
  edits), not an over-editing-by-volume regression.

**Key takeaway — an eval blind spot, not just a bad prompt:** the headline lever ("verify by running
tests / reproducing") **cannot be fairly evaluated in this harness** because tests aren't runnable
(no deps). The "run tests" instruction is actively harmful here. To test self-verification properly,
the eval must run the agent in an environment where the repo's tests can actually run (install deps,
or run inside SWE-bench's prepared Docker image).

**Fixes kept from this round (independent of the revert):**
- `run_smoke.py` now writes `.git/info/exclude` for test/build junk so `git add -A` can't sweep
  `.hypothesis/`, `__pycache__/`, `*.egg-info`, etc. into the captured diff.

## Exp 2 — docker-agent mode + verify prompt in a faithful env (deps installed)

Built `--agent-in-docker` (agent runs inside the SWE-bench instance image; tests runnable) to remove
exp-1's confound. Then A/B'd baseline vs the verify prompt (injected via `--append-system-prompt`,
same dist) on the same 20.

- **2a docker-baseline = 11/20 (55%)** — matches host-baseline (12/20) within 1 instance (only
  `sphinx-10325` differs; run-to-run noise). **Confirms docker mode ≈ host regime** for the baseline
  prompt, and validates the infra.
- **2b docker-verify = 10/20 (50%)** — vs docker-baseline: **lost `seaborn-2848`, gained nothing,
  +26% cost, +1 empty patch.** The verify prompt does **not** help `deepseek-v4-flash` even when
  tests are runnable.

**Conclusion — "verify before done" is not the lever for v4-flash on Lite.** Refuted in BOTH
environments (host −20pt confounded; docker −1pt clean). Why it doesn't pay off here:
- **Held-out tests:** the graded `FAIL_TO_PASS` aren't in the repo at base_commit, so running the
  existing suite can't catch the actual graded failure; "verify" mostly adds turns/cost.
- **Weak model:** v4-flash spends the extra deliberation wandering (more turns, occasional empty/worse
  patch) rather than converging.

**Where this leaves optimization (no clear prompt lever for v4-flash):**
- **Repro-first scaffold** (more promising than "run tests"): have the agent *write a failing
  reproduction from the issue text*, then make it pass — this creates the check that the held-out
  test would provide. More involved than a prompt nudge.
- **Model tier:** re-run the SAME A/B on `deepseek-v4-pro` / reasoner — a stronger model may actually
  use the verify/completeness levers (and justify the cost). Cheap to try now that infra exists.
- **Noise control:** the deltas here are 1 instance on 20 (±11% 1σ). Any future candidate worth
  shipping should be confirmed with multi-seed or the full Lite-300.

The base system prompt stays at the v0.1.0 baseline. `prompts/verify-before-done.txt` is retained as
the tested (negative) artifact, reusable for the model-tier A/B.

## Exp 3 — model tier (deepseek-v4-pro), same docker A/B

Does a stronger/pricier model use the verify/completeness levers? Re-ran the exact docker A/B on
`deepseek-v4-pro` (~4× the per-token price), reusing the same 20 instance images.

- **3a pro-baseline = 9/20 (45%)**, $0.274 (~4× flash's $0.068).
- **3b pro-verify = 9/20 (45%)**, $0.255 (+1 empty patch). Verify makes no difference for pro either.

**The five resolved sets are monotonically nested** (each ⊆ the one with a higher count):
`pro (9) ⊆ flash-docker-verify (10) ⊆ flash-docker (11) ⊆ flash-host (12)`. All five share the same
core 9. flash additionally solves seaborn-2848 / requests-1963 / sphinx-10325; **v4-pro solves a
strict subset of flash and adds nothing** — it missed seaborn-2848 and requests-1963 that flash got.

**Conclusions (two clean negatives):**
1. **The verify-before-done prompt does not help** — refuted on v4-flash AND v4-pro.
2. **v4-pro is not worth it here** — strictly worse than v4-flash on this subset at ~4× cost. Likely
   over-thinking simple Lite tasks (the same wander/over-edit failure mode), and/or noise — but
   clearly not a win.

> Variance: 20 tasks, ±~11% (1σ); the exact 12/11/10/9 ordering spans ~3 instances. But the strict
> *nesting* (no run ever solves something a better-scoring run missed) is a strong structural signal,
> not the pattern you'd expect from pure noise.

**Net:** the cheap optimization knobs are exhausted — neither a prompt nudge nor a bigger model beats
**v4-flash + the baseline prompt (~55–60%)**, which is the cost/quality sweet spot. Getting higher on
this scaffold needs a *structural* change, not a knob twist. Best remaining candidate: a **repro-first
scaffold** (agent writes a failing reproduction from the issue, then makes it pass — supplying the
check the held-out test would). That's real work; worth a deliberate decision before starting.
