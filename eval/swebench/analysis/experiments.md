# SWE-bench Lite — optimization experiments log

Each entry: a single-variable change vs the standing baseline, measured on the **same deterministic
20-task repo-stratified subset** (`--subset 20 --model deepseek-v4-flash --max-turns 40 --workers 4`).

> ⚠️ Variance caveat: `deepseek-v4-flash` is non-deterministic, and 20 tasks give a wide CI (~±11% 1σ).
> A single run shows direction, not a precise delta. Trust a result more when a mechanism explains it.

| # | change | resolved | Δ vs baseline | cost (20) | turns | verdict |
|---|---|---|---|---|---|---|
| — | **v0.1.0 baseline** (generic prompt) | **12/20 = 60%** | — | $0.069 | — | standing baseline |
| 1 | v0.1.x "verify before done" prompt | 8/20 = 40% | **−20pt** | $0.082 | +~18% | ❌ reverted |

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

**Open follow-ups (pick a direction before more prompt tuning):**
- **Refined prompt:** keep only the read-only levers (read tests/hints to pin the API, minimal
  change, cover sibling sites); **drop "run tests"** until the env supports it. Re-measure.
- **Eval infra:** make tests runnable per instance (install deps / use the SWE-bench image) so the
  self-verification lever can be measured at all. Likely the higher-value fix.
- **Noise control:** run baseline + candidate 3× each to bound variance before trusting a delta.
