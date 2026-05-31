#!/usr/bin/env bash
# Set up the SWE-bench Lite eval environment for Coding Malo.
#   - a Python venv with the swebench harness + datasets
#   - (for --agent-in-docker) a linux-x64 node binary, bind-mounted into the x86_64 instance images
set -euo pipefail
cd "$(dirname "$0")"

echo "== python venv =="
python3 -m venv .venv
.venv/bin/pip install -q -U pip swebench datasets

echo "== linux-x64 node (for --agent-in-docker) =="
NODE_VER="v20.18.1"
if [ -x .node-linux-x64/bin/node ]; then
  echo "  already present ($(.node-linux-x64/bin/node --version))"
else
  mkdir -p .node-linux-x64
  curl -fsSL "https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-linux-x64.tar.xz" -o /tmp/cm-node-linux.tar.xz
  tar -xJf /tmp/cm-node-linux.tar.xz -C .node-linux-x64 --strip-components=1
  rm -f /tmp/cm-node-linux.tar.xz
  echo "  installed $(.node-linux-x64/bin/node --version) (linux-x64)"
fi

echo
echo "setup done. Build the CLI from repo root: npm run build"
echo "Docker-mode run also needs ~/.codingmalo/config.json (model→provider profiles)."
