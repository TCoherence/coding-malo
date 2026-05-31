#!/usr/bin/env python3
"""Drive Coding Malo over SWE-bench Lite instances and score with the official harness.

Two modes:
  --gold            Skip the agent; evaluate the ground-truth patches. Validates the whole
                    harness (Docker + scoring) with NO model/API cost. Expect resolved == true.
  (default)         Run `codingmalo` headlessly per instance, capture `git diff`, then evaluate.
                    Requires a working model + key in the env (e.g. DEEPSEEK_API_KEY).

The agent contract maps directly onto SWE-bench: the harness never calls the agent — we produce a
predictions JSONL ({instance_id, model_name_or_path, model_patch=<unified diff>}) and the Dockerized
`swebench.harness.run_evaluation` applies the patch and runs the repo's tests.

Examples:
  python run_smoke.py --list-repos                     # see instances grouped by repo (pick a light one)
  python run_smoke.py --gold --instance-ids <id>       # validate the harness (no agent)
  python run_smoke.py --instance-ids <id> --model deepseek-v4-flash --max-turns 30
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys
import tempfile
from collections import Counter

DATASET = "princeton-nlp/SWE-bench_Lite"  # redirects to SWE-bench/SWE-bench_Lite on HF
REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]  # eval/swebench/ -> repo root
CLI = REPO_ROOT / "dist" / "cli.js"
HERE = pathlib.Path(__file__).resolve().parent


def load_rows(instance_ids: list[str] | None) -> list[dict]:
    from datasets import load_dataset

    ds = load_dataset(DATASET, split="test")
    if instance_ids:
        wanted = set(instance_ids)
        rows = [r for r in ds if r["instance_id"] in wanted]
        missing = wanted - {r["instance_id"] for r in rows}
        if missing:
            sys.exit(f"instance_ids not found in {DATASET}: {sorted(missing)}")
        return rows
    return list(ds)


def list_repos() -> None:
    rows = load_rows(None)
    by_repo: dict[str, list[str]] = {}
    for r in rows:
        by_repo.setdefault(r["repo"], []).append(r["instance_id"])
    print(f"{DATASET}: {len(rows)} instances across {len(by_repo)} repos\n")
    for repo, ids in sorted(by_repo.items(), key=lambda kv: len(kv[1])):
        print(f"  {len(ids):3d}  {repo}   e.g. {ids[0]}")


def run_agent(row: dict, model: str | None, max_turns: int, timeout: int) -> str:
    """Clone the repo at base_commit, run Coding Malo, return the resulting unified diff."""
    repo, base, problem = row["repo"], row["base_commit"], row["problem_statement"]
    work = tempfile.mkdtemp(prefix="swebench-")
    subprocess.run(["git", "clone", "--quiet", f"https://github.com/{repo}.git", work], check=True)
    subprocess.run(["git", "-C", work, "checkout", "--quiet", base], check=True)

    prompt = (
        "You are resolving a GitHub issue in this repository. Make the minimal source-code change "
        "required to fix the issue. Do NOT modify or add tests.\n\n--- Issue ---\n" + problem
    )
    cmd = [
        "node", str(CLI), "-p",
        "--output-format", "text",
        "--workspace", work,
        "--permission-mode", "bypass",
        "--sandbox", "danger-full-access",
        "--max-turns", str(max_turns),
    ]
    if model:
        cmd += ["--model", model]
    print(f"  → running agent on {row['instance_id']} ({repo}@{base[:8]}) …", flush=True)
    try:
        subprocess.run(cmd, input=prompt, text=True, env=dict(os.environ), timeout=timeout)
    except subprocess.TimeoutExpired:
        print(f"  ! agent timed out after {timeout}s (using whatever it changed so far)", flush=True)

    subprocess.run(["git", "-C", work, "add", "-A"], check=True)
    diff = subprocess.run(
        ["git", "-C", work, "diff", "--cached"], capture_output=True, text=True, check=True
    ).stdout
    print(f"  ← captured diff: {len(diff.splitlines())} lines", flush=True)
    return diff


def main() -> None:
    ap = argparse.ArgumentParser(description="SWE-bench Lite smoke runner for Coding Malo")
    ap.add_argument("--list-repos", action="store_true", help="list instances grouped by repo and exit")
    ap.add_argument("--gold", action="store_true", help="evaluate ground-truth patches (no agent / no API)")
    ap.add_argument("--instance-ids", nargs="*", default=[], help="instance ids to run (default: all)")
    ap.add_argument("--model", default=None, help="Coding Malo model/profile (e.g. deepseek-v4-flash)")
    ap.add_argument("--max-turns", type=int, default=30)
    ap.add_argument("--timeout", type=int, default=900, help="per-instance agent wall-clock seconds")
    ap.add_argument("--workers", type=int, default=1, help="harness max_workers")
    ap.add_argument("--run-id", default="codingmalo-smoke")
    args = ap.parse_args()

    if args.list_repos:
        list_repos()
        return

    if args.gold:
        predictions_path = "gold"
    else:
        if not args.instance_ids:
            sys.exit("refusing to run the agent over the whole dataset; pass --instance-ids for a smoke")
        if not CLI.exists():
            sys.exit(f"built CLI not found at {CLI} — run `npm run build` first")
        rows = load_rows(args.instance_ids)
        preds = [
            {
                "instance_id": r["instance_id"],
                "model_name_or_path": "coding-malo" + (f":{args.model}" if args.model else ""),
                "model_patch": run_agent(r, args.model, args.max_turns, args.timeout),
            }
            for r in rows
        ]
        out = HERE / f"predictions.{args.run_id}.jsonl"
        out.write_text("\n".join(json.dumps(p) for p in preds) + "\n")
        empty = sum(1 for p in preds if not p["model_patch"].strip())
        print(f"\nwrote {len(preds)} predictions → {out}" + (f"  ({empty} empty diffs!)" if empty else ""))
        predictions_path = str(out)

    cmd = [
        sys.executable, "-m", "swebench.harness.run_evaluation",
        "--dataset_name", DATASET,
        "--predictions_path", predictions_path,
        "--max_workers", str(args.workers),
        "--run_id", args.run_id,
    ]
    if args.instance_ids:
        cmd += ["--instance_ids", *args.instance_ids]
    print("\n$ " + " ".join(cmd) + "\n", flush=True)
    sys.exit(subprocess.run(cmd).returncode)


if __name__ == "__main__":
    main()
