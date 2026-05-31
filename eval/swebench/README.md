# SWE-bench Lite smoke runner

Drives **Coding Malo** over [SWE-bench Lite](https://www.swebench.com/) and scores it with the
official Dockerized harness. SWE-bench never calls the agent: we run the agent ourselves, capture a
`git diff`, write a `predictions.jsonl`, and the harness applies the patch + runs the repo's tests
(`resolved` = the fix's `FAIL_TO_PASS` tests pass **and** `PASS_TO_PASS` tests don't regress).

This lives under `eval/` and is **dev-only** (the npm package only ships `dist/`).

## Prerequisites

- **Docker** running (each instance is scored in a container).
- **Python 3.10+**.
- A built CLI: `npm run build` (→ `dist/cli.js`).
- For a real agent run: a model key in the env, e.g. `export DEEPSEEK_API_KEY=…` (Coding Malo's
  config profiles reference it via `${env:…}`).

## Setup

```bash
cd eval/swebench
python3 -m venv .venv
.venv/bin/pip install -U pip swebench datasets
```

Run `./setup.sh` once (creates `.venv`, installs the harness, and downloads a linux-x64 node binary
used by docker-agent mode).

## Use

```bash
# 1) see instances grouped by repo (pick a light one for the first run)
.venv/bin/python run_smoke.py --list-repos

# 2) validate the harness itself — scores ground-truth patches, NO agent / NO API cost.
#    Expect resolved == true for the instance.
.venv/bin/python run_smoke.py --gold --instance-ids <instance_id> --run-id validate-gold

# 3) a real run: a repo-stratified subset of N instances, then score + summarize.
DEEPSEEK_API_KEY=… .venv/bin/python run_smoke.py \
  --subset 20 --model deepseek-v4-flash --max-turns 40 --workers 4 --run-id v0.1.0-baseline
#   (or --instance-ids A B C for specific ones)
```

`--subset N` picks a deterministic, repo-balanced sample. The runner captures per-instance
token usage + cost (via `--output-format stream-json`), runs the harness, then prints a summary:
**resolved rate (X/N), per-instance turns/tokens/cost, total cost, and a full-300 projection.**
The harness writes per-instance logs under `logs/` and a `coding-malo.<run-id>.json` report; agent
predictions go to `predictions.<run-id>.jsonl`.

> Disk: each repo's eval image is GBs; a 20-task spread touches ~all 12 repos. `docker image prune`
> after a run to reclaim space.

### Two agent environments

- **Default (host clone):** clone the repo @ base_commit on the host and run the agent there. Fast,
  but the repo's **dependencies are not installed**, so the agent cannot run the test suite.
- **`--agent-in-docker`:** run the agent **inside the SWE-bench instance image** — the same image the
  scorer uses, with `/testbed` @ base_commit and the `testbed` conda env (all deps installed). Here
  the agent's tests are **runnable**. The pure-JS agent is bind-mounted cross-arch (`dist/` +
  `node_modules/` + the linux-x64 node + your `~/.codingmalo/config.json`); no rebuild inside the
  container. Heavier (image pulls are GBs each; runs under emulation on Apple Silicon).

```bash
# baseline vs a prompt variant, SAME build — differ only by --extra-prompt-file (--append-system-prompt)
.venv/bin/python run_smoke.py --subset 20 --agent-in-docker --model deepseek-v4-flash \
  --max-turns 40 --run-id docker-baseline
.venv/bin/python run_smoke.py --subset 20 --agent-in-docker --model deepseek-v4-flash \
  --max-turns 40 --run-id docker-verify --extra-prompt-file prompts/verify-before-done.txt
```

> **Held-out tests:** SWE-bench's graded `FAIL_TO_PASS` tests are added by the gold `test_patch` and
> are **not** in `/testbed` at base_commit. So "verify by running tests" catches regressions
> (`PASS_TO_PASS`), crashes, and anything the agent can reproduce from the issue — but it cannot
> directly check the held-out `FAIL_TO_PASS` unless the agent writes its own reproduction.

## How the agent is invoked (per instance)

```
git clone https://github.com/<repo>.git <tmp> && git -C <tmp> checkout <base_commit>
node dist/cli.js -p --output-format text --workspace <tmp> \
  --permission-mode bypass --sandbox danger-full-access --max-turns N --model <model>
  # problem_statement is piped on stdin
git -C <tmp> add -A && git -C <tmp> diff --cached      # → model_patch
```

## Gotchas

- **arm64 (Apple Silicon):** SWE-bench's prebuilt images are x86_64; Docker runs them under
  emulation (slower). If an instance image fails, build locally with the harness's
  `--namespace ''` option (see SWE-bench docs).
- **Disk/time:** images are large (GBs) and the first build/pull per repo is slow.
- **Network during scoring:** the agent runs *before* the scored phase; the harness applies only the
  diff in a clean container, so the agent's network usage doesn't affect scoring.
- **Multi-file edits:** handled — `git diff --cached` captures all staged changes.
- **No global wall-clock in the CLI yet:** the runner enforces `--timeout` per instance itself.
