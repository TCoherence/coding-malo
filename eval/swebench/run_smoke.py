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


def run_agent(row: dict, model: str | None, max_turns: int, timeout: int) -> dict:
    """Clone repo@base_commit, run Coding Malo headless, return {patch, turns, error_kind, usage}."""
    repo, base, problem = row["repo"], row["base_commit"], row["problem_statement"]
    work = tempfile.mkdtemp(prefix="swebench-")
    subprocess.run(["git", "clone", "--quiet", f"https://github.com/{repo}.git", work], check=True)
    subprocess.run(["git", "-C", work, "checkout", "--quiet", base], check=True)
    # Keep test-run / build artifacts out of the captured diff: if the agent runs the test suite,
    # pytest/hypothesis/etc. drop caches that `git add -A` would otherwise sweep into the patch
    # (e.g. .hypothesis/…/charmap.json.gz), polluting the prediction. Excluded files won't be staged.
    junk = [".hypothesis/", ".pytest_cache/", "__pycache__/", "*.pyc", "*.egg-info/",
            ".coverage", ".coverage.*", "htmlcov/", "build/", "dist/", ".tox/", "node_modules/"]
    pathlib.Path(work, ".git", "info", "exclude").write_text("\n".join(junk) + "\n")
    prompt = (
        "You are resolving a GitHub issue in this repository. Make the minimal source-code change "
        "required to fix the issue. Do NOT modify or add tests.\n\n--- Issue ---\n" + problem
    )
    cmd = [
        "node", str(CLI), "-p", "--output-format", "stream-json",
        "--workspace", work, "--permission-mode", "bypass",
        "--sandbox", "danger-full-access", "--max-turns", str(max_turns),
    ]
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
        if not os.environ.get("DEEPSEEK_API_KEY") and not os.environ.get("ANTHROPIC_API_KEY") and not os.environ.get("OPENAI_API_KEY"):
            print("! warning: no model API key in env — agent runs will fail", flush=True)
        for r in rows:
            metas[r["instance_id"]] = run_agent(r, args.model, args.max_turns, args.timeout)
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
