#!/usr/bin/env bash
# Runs `tsc --noEmit` for every workspace package that has its own
# tsconfig.json. packages/dashboard is intentionally excluded — it has its
# own frontend tooling and is out of scope for backend hardening.
set -e

for dir in packages/common packages/agent-sdk packages/mcp packages/registry packages/orchestrator packages/agents/*/; do
  dir="${dir%/}"
  if [ -f "$dir/tsconfig.json" ]; then
    echo "==> typecheck $dir"
    npx tsc --noEmit -p "$dir/tsconfig.json"
  fi
done
