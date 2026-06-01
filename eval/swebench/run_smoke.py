#!/usr/bin/env python3
"""Run Coding Malo over a SWE-bench Lite subset, score with the official harness, and summarize
resolved rate + cost. SWE-bench never calls the agent — we run it, capture `git diff`, write a
predictions JSONL ({instance_id, model_name_or_path, model_patch}), and the Dockerized harness
applies the patch and runs the repo's tests.

Modes:
  --gold                Evaluate ground-truth patches (validates the harness; no agent / no API).
  --instance-ids A B    Run specific instances.
  --subset N            Run a deterministic, repo-stratified sample of N instances.

Examples:
  python run_smoke.py --list-repos
  python run_smoke.py --gold --instance-ids pallets__flask-4045 --run-id validate-gold
  python run_smoke.py --subset 20 --model deepseek-v4-flash --max-turns 40 --workers 4 --run-id v0.1.0-baseline
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys
import tempfile

DATASET = "princeton-nlp/SWE-bench_Lite"
REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
CLI = REPO_ROOT / "dist" / "cli.js"
HERE = pathlib.Path(__file__).resolve().parent
MODEL_TAG = "coding-malo"  # model_name_or_path → report file is f"{MODEL_TAG}.{run_id}.json"

# --- docker agent mode (tests are RUNNABLE inside the SWE-bench instance image) ---
# Default host mode clones a bare repo (no deps → the agent can't run the suite). Docker mode runs
# the agent inside the same image the scorer uses (/testbed @ base_commit + the `testbed` conda env
# with all deps), so the "verify by running tests" lever actually works. The agent (pure-JS runtime)
# is bind-mounted in cross-arch: host dist/ + node_modules/ + a linux-x64 node + ~/.codingmalo config.
NODE_LINUX = HERE / ".node-linux-x64"          # `setup.sh`-downloaded linux-x64 node (bin/node)
HOST_CONFIG = pathlib.Path.home() / ".codingmalo" / "config.json"  # model→provider profiles
KEY_ENVS = ["DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]
# untracked test/build artifacts the agent's test runs create — keep them out of the captured diff
JUNK = [".hypothesis/", ".pytest_cache/", "__pycache__/", "*.pyc", "*.egg-info/",
        ".coverage", ".coverage.*", "htmlcov/", "build/", "dist/", ".tox/", "node_modules/"]


def all_rows() -> list[dict]:
    from datasets import load_dataset

    return list(load_dataset(DATASET, split="test"))


def by_repo(rows: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(r["repo"], []).append(r)
    return out


def list_repos() -> None:
    rows = all_rows()
    grouped = by_repo(rows)
    print(f"{DATASET}: {len(rows)} instances across {len(grouped)} repos\n")
    for repo, ids in sorted(grouped.items(), key=lambda kv: len(kv[1])):
        print(f"  {len(ids):3d}  {repo}   e.g. {sorted(r['instance_id'] for r in ids)[0]}")


def stratified_subset(n: int) -> list[dict]:
    """Deterministic, repo-balanced sample: round-robin one instance per repo until n collected."""
    buckets = [sorted(v, key=lambda r: r["instance_id"]) for _, v in sorted(by_repo(all_rows()).items())]
    picked: list[dict] = []
    while len(picked) < n:
        progressed = False
        for b in buckets:
            if b and len(picked) < n:
                picked.append(b.pop(0))
                progressed = True
        if not progressed:
            break
    return picked


def pick_rows(ids: list[str]) -> list[dict]:
    wanted = set(ids)
    rows = [r for r in all_rows() if r["instance_id"] in wanted]
    missing = wanted - {r["instance_id"] for r in rows}
    if missing:
        sys.exit(f"instance_ids not found: {sorted(missing)}")
    return rows


def _build_prompt(problem: str) -> str:
    return (
        "You are resolving a GitHub issue in this repository. Make the minimal source-code change "
        "required to fix the issue. Do NOT modify or add tests.\n\n--- Issue ---\n" + problem
    )


def run_agent(row: dict, model: str | None, max_turns: int, timeout: int,
              extra_prompt: str | None = None) -> dict:
    """Clone repo@base_commit, run Coding Malo headless, return {patch, turns, error_kind, usage}."""
    repo, base, problem = row["repo"], row["base_commit"], row["problem_statement"]
    work = tempfile.mkdtemp(prefix="swebench-")
    subprocess.run(["git", "clone", "--quiet", f"https://github.com/{repo}.git", work], check=True)
    subprocess.run(["git", "-C", work, "checkout", "--quiet", base], check=True)
    # Keep test-run / build artifacts out of the captured diff: if the agent runs the test suite,
    # pytest/hypothesis/etc. drop caches that `git add -A` would otherwise sweep into the patch
    # (e.g. .hypothesis/…/charmap.json.gz), polluting the prediction. Excluded files won't be staged.
    pathlib.Path(work, ".git", "info", "exclude").write_text("\n".join(JUNK) + "\n")
    prompt = _build_prompt(problem)
    cmd = [
        "node", str(CLI), "-p", "--output-format", "stream-json",
        "--workspace", work, "--permission-mode", "bypass",
        "--sandbox", "danger-full-access", "--max-turns", str(max_turns),
    ]
    if extra_prompt:
        cmd += ["--append-system-prompt", extra_prompt]
    if model:
        cmd += ["--model", model]
    print(f"  → {row['instance_id']} ({repo}@{base[:8]}) …", flush=True)
    result_event = None
    try:
        proc = subprocess.run(cmd, input=prompt, text=True, capture_output=True, env=dict(os.environ), timeout=timeout)
        for line in proc.stdout.splitlines():
            try:
                e = json.loads(line)
            except Exception:
                continue
            if e.get("type") == "result":
                result_event = e
    except subprocess.TimeoutExpired:
        print(f"    ! agent timed out after {timeout}s", flush=True)

    subprocess.run(["git", "-C", work, "add", "-A"], check=True)
    patch = subprocess.run(
        ["git", "-C", work, "diff", "--cached"], capture_output=True, text=True, check=True
    ).stdout
    usage = result_event.get("usage", {}) if result_event else {}
    meta = {
        "patch": patch,
        "turns": (result_event or {}).get("turns_used"),
        "error_kind": (result_event or {}).get("error_kind"),
        "usage": usage,
    }
    print(f"    ← {len(patch.splitlines())} diff lines, turns={meta['turns']}, "
          f"err={meta['error_kind']}, cost=${usage.get('cost_usd', 0):.4f}", flush=True)
    return meta


def _result_event(stream_text: str) -> dict | None:
    last = None
    for line in stream_text.splitlines():
        try:
            e = json.loads(line)
        except Exception:
            continue
        if e.get("type") == "result":
            last = e
    return last


def _meta(result_event: dict | None, patch: str, iid: str) -> dict:
    usage = result_event.get("usage", {}) if result_event else {}
    meta = {
        "patch": patch,
        "turns": (result_event or {}).get("turns_used"),
        "error_kind": (result_event or {}).get("error_kind"),
        "usage": usage,
    }
    print(f"    ← {len(patch.splitlines())} diff lines, turns={meta['turns']}, "
          f"err={meta['error_kind']}, cost=${usage.get('cost_usd', 0):.4f}", flush=True)
    return meta


def _instance_image(row: dict) -> str:
    """The exact image the scorer uses (handles the __ → _1776_ tag normalization + namespace)."""
    from swebench.harness.test_spec.test_spec import make_test_spec

    return make_test_spec(row, namespace="swebench").instance_image_key


def ensure_image(image: str) -> None:
    if subprocess.run(["docker", "image", "inspect", image], capture_output=True).returncode == 0:
        return
    print(f"    · pulling {image} …", flush=True)
    subprocess.run(["docker", "pull", "--platform", "linux/amd64", image], check=True)


def run_agent_docker(row: dict, model: str | None, max_turns: int, timeout: int,
                     extra_prompt: str | None = None) -> dict:
    """Run Coding Malo INSIDE the SWE-bench instance image, where the repo's tests are runnable.

    /testbed is the repo @ base_commit with the `testbed` conda env (deps installed) on PATH. The
    pure-JS agent is bind-mounted cross-arch (arm64 host → x86_64 image): dist/ + node_modules/ + a
    linux-x64 node + the host ~/.codingmalo config (model→provider profiles). The agent runs tests
    via its Bash tool against that env; we then capture `git -C /testbed diff` as the prediction.
    """
    iid, repo, base, problem = row["instance_id"], row["repo"], row["base_commit"], row["problem_statement"]
    image = _instance_image(row)
    print(f"  → {iid} ({repo}@{base[:8]}) [docker {image}] …", flush=True)
    ensure_image(image)
    out = tempfile.mkdtemp(prefix="swebench-docker-")
    pathlib.Path(out, "prompt.txt").write_text(_build_prompt(problem))
    model_flag = f"--model {model} " if model else ""
    # variant guidance is injected via --append-system-prompt (read from a mounted file inside the
    # container) so baseline vs candidate differ by ONE flag against the SAME dist — no rebuild.
    append_flag = ""
    if extra_prompt:
        pathlib.Path(out, "extra.txt").write_text(extra_prompt)
        append_flag = '--append-system-prompt "$(cat /out/extra.txt)" '
    # inner script: keep test-run junk out of the diff, run the agent, then capture the diff
    inner = (
        'printf "%s\\n" ' + " ".join(f"'{p}'" for p in JUNK) + ' > /testbed/.git/info/exclude; '
        f"/opt/node/bin/node /cm/dist/cli.js -p --output-format stream-json "
        f"--workspace /testbed --permission-mode bypass --sandbox danger-full-access "
        f"--max-turns {max_turns} {model_flag}{append_flag}< /out/prompt.txt > /out/stream.jsonl 2>/out/stderr.txt; "
        "cd /testbed && git add -A && git diff --cached > /out/patch.diff"
    )
    cmd = ["docker", "run", "--rm", "--platform", "linux/amd64"]
    for k in KEY_ENVS:
        if os.environ.get(k):
            cmd += ["-e", k]
    cmd += [
        "-v", f"{REPO_ROOT/'dist'}:/cm/dist:ro",
        "-v", f"{REPO_ROOT/'node_modules'}:/cm/node_modules:ro",
        "-v", f"{REPO_ROOT/'package.json'}:/cm/package.json:ro",
        "-v", f"{NODE_LINUX}:/opt/node:ro",
        "-v", f"{HOST_CONFIG}:/root/.codingmalo/config.json:ro",
        "-v", f"{out}:/out",
        image, "bash", "-lc", inner,
    ]
    try:
        subprocess.run(cmd, env=dict(os.environ), timeout=timeout)
    except subprocess.TimeoutExpired:
        print(f"    ! agent timed out after {timeout}s", flush=True)
    stream = pathlib.Path(out, "stream.jsonl")
    patch_file = pathlib.Path(out, "patch.diff")
    result_event = _result_event(stream.read_text()) if stream.exists() else None
    patch = patch_file.read_text() if patch_file.exists() else ""
    return _meta(result_event, patch, iid)


def run_harness(predictions_path: str, ids: list[str], workers: int, run_id: str) -> int:
    cmd = [
        sys.executable, "-m", "swebench.harness.run_evaluation",
        "--dataset_name", DATASET, "--predictions_path", predictions_path,
        "--max_workers", str(workers), "--run_id", run_id,
    ]
    if ids:
        cmd += ["--instance_ids", *ids]
    print("\n$ " + " ".join(cmd) + "\n", flush=True)
    return subprocess.run(cmd).returncode


def summarize(report_path: pathlib.Path, metas: dict[str, dict], model: str) -> None:
    if not report_path.exists():
        print(f"\n! report not found at {report_path} — see harness output above")
        return
    rep = json.loads(report_path.read_text())
    resolved = set(rep.get("resolved_ids", []))
    total = rep.get("total_instances", 0)
    n_resolved = rep.get("resolved_instances", 0)
    print("\n" + "=" * 78)
    print(f"SWE-bench Lite — Coding Malo {('('+model+')') if model else ''}")
    print("=" * 78)
    if metas:
        print(f"{'instance':<34} {'resolved':<9} {'turns':>5} {'in':>7} {'out':>6} {'cacheR':>8} {'$':>8}")
        tot_in = tot_out = tot_cache = 0
        tot_cost = 0.0
        for iid, m in metas.items():
            u = m.get("usage", {})
            i, o, c = u.get("input_tokens", 0), u.get("output_tokens", 0), u.get("cache_read_input_tokens", 0)
            cost = u.get("cost_usd", 0.0)
            tot_in += i; tot_out += o; tot_cache += c; tot_cost += cost
            mark = "✓" if iid in resolved else ("ERR" if m.get("error_kind") else "✗")
            print(f"{iid:<34} {mark:<9} {str(m.get('turns')):>5} {i:>7} {o:>6} {c:>8} {cost:>8.4f}")
        print("-" * 78)
        print(f"{'TOTAL':<34} {str(n_resolved)+'/'+str(total):<9} {'':>5} {tot_in:>7} {tot_out:>6} {tot_cache:>8} {tot_cost:>8.4f}")
        rate = (100.0 * n_resolved / total) if total else 0.0
        avg = tot_cost / total if total else 0.0
        print(f"\n  resolved: {n_resolved}/{total} = {rate:.1f}%   "
              f"empty-patch: {rep.get('empty_patch_instances',0)}   errors: {rep.get('error_instances',0)}")
        print(f"  cost: ${tot_cost:.4f} total, ${avg:.4f}/instance  →  full Lite (300) ≈ ${avg*300:.2f}")
    else:
        print(f"  resolved: {n_resolved}/{total} (gold validation)")
    print("=" * 78)


def main() -> None:
    ap = argparse.ArgumentParser(description="SWE-bench Lite runner for Coding Malo")
    ap.add_argument("--list-repos", action="store_true")
    ap.add_argument("--gold", action="store_true", help="evaluate ground-truth patches (no agent)")
    ap.add_argument("--instance-ids", nargs="*", default=[])
    ap.add_argument("--subset", type=int, default=0, help="run a repo-stratified sample of N instances")
    ap.add_argument("--model", default=None)
    ap.add_argument("--max-turns", type=int, default=40)
    ap.add_argument("--timeout", type=int, default=900, help="per-instance agent wall-clock seconds")
    ap.add_argument("--workers", type=int, default=4, help="harness max_workers (parallel Docker scoring)")
    ap.add_argument("--run-id", default="codingmalo-smoke")
    ap.add_argument("--agent-in-docker", action="store_true",
                    help="run the agent INSIDE the SWE-bench instance image (tests runnable), not a bare clone")
    ap.add_argument("--extra-prompt-file", default=None,
                    help="file whose contents are injected via --append-system-prompt (A/B prompt variants, same dist)")
    args = ap.parse_args()

    if args.list_repos:
        list_repos()
        return

    # resolve target rows
    if args.subset:
        rows = stratified_subset(args.subset)
    elif args.instance_ids:
        rows = pick_rows(args.instance_ids)
    elif args.gold:
        rows = []  # gold over the whole dataset is allowed but slow; usually pair with --instance-ids
    else:
        sys.exit("pass --subset N, --instance-ids …, or --gold (+ ids)")
    ids = [r["instance_id"] for r in rows]
    if rows:
        print(f"instances ({len(ids)}): {', '.join(ids)}\n")

    metas: dict[str, dict] = {}
    if args.gold:
        predictions_path = "gold"
        model_tag = "gold"
    else:
        if not CLI.exists():
            sys.exit(f"built CLI not found at {CLI} — run `npm run build`")
        if not any(os.environ.get(k) for k in KEY_ENVS):
            print("! warning: no model API key in env — agent runs will fail", flush=True)
        if args.agent_in_docker:
            # preflight: the cross-arch bind-mounts must exist on the host
            if not (NODE_LINUX / "bin" / "node").exists():
                sys.exit(f"missing linux-x64 node at {NODE_LINUX}/bin/node — run ./setup.sh (or see README)")
            if not HOST_CONFIG.exists():
                sys.exit(f"missing model config at {HOST_CONFIG} — needed to map --model to a provider")
            print(f"agent mode: docker (tests runnable inside the instance image)\n", flush=True)
        extra_prompt = pathlib.Path(args.extra_prompt_file).read_text() if args.extra_prompt_file else None
        if extra_prompt:
            print(f"append-system-prompt: {args.extra_prompt_file} ({len(extra_prompt)} chars)\n", flush=True)
        run = run_agent_docker if args.agent_in_docker else run_agent
        for r in rows:
            try:
                metas[r["instance_id"]] = run(r, args.model, args.max_turns, args.timeout, extra_prompt)
            except Exception as exc:  # one bad instance (image pull, docker error) shouldn't kill the batch
                print(f"    ! {r['instance_id']} failed: {exc}", flush=True)
                metas[r["instance_id"]] = {"patch": "", "turns": None, "error_kind": "runner_error", "usage": {}}
        preds = [
            {"instance_id": iid, "model_name_or_path": MODEL_TAG, "model_patch": m["patch"]}
            for iid, m in metas.items()
        ]
        out = HERE / f"predictions.{args.run_id}.jsonl"
        out.write_text("\n".join(json.dumps(p) for p in preds) + "\n")
        empty = sum(1 for m in metas.values() if not m["patch"].strip())
        print(f"\nwrote {len(preds)} predictions → {out}" + (f"  ({empty} empty diffs)" if empty else ""))
        predictions_path = str(out)
        model_tag = MODEL_TAG

    code = run_harness(predictions_path, ids, args.workers, args.run_id)
    summarize(HERE / f"{model_tag}.{args.run_id}.json", metas, args.model or "")
    sys.exit(code)


if __name__ == "__main__":
    main()
