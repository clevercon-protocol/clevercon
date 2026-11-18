#!/usr/bin/env bash
# Runs `tsc --noEmit` for every workspace package that has its own
# tsconfig.json. The frontend (apps/web) runs its own typecheck via
# `npm run build -w @clevercon/web` and is out of scope here.
set -e

# @clevercon/db's dist is built in the root postinstall; @clevercon/agent-sdk's is
# not, yet the mcp typecheck (and the sdk's own examples) resolve its subpath exports
# (@clevercon/agent-sdk/provider, /prover, ...) through its published dist. Build it
# first so a fresh CI checkout (no dist) type-resolves exactly like a real consumer.
echo "==> build @clevercon/agent-sdk (for downstream type resolution)"
npm run build -w @clevercon/agent-sdk >/dev/null

for dir in packages/common packages/db packages/agent-sdk packages/mcp services/api services/indexer services/workers; do
  dir="${dir%/}"
  if [ -f "$dir/tsconfig.json" ]; then
    echo "==> typecheck $dir"
    npx tsc --noEmit -p "$dir/tsconfig.json"
  fi
done
