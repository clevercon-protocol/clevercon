#!/usr/bin/env bash
# CleverCon — Start all services
# Usage: ./scripts/start.sh [--no-build]

set -e

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="$REPO/logs"
mkdir -p "$LOGS"

NO_BUILD=0
for arg in "$@"; do [[ $arg == --no-build ]] && NO_BUILD=1; done

# ── Load nvm ──────────────────────────────────────────────────────────────────
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
source "$NVM_DIR/nvm.sh"
nvm use 20 --silent

# ── Load .env ─────────────────────────────────────────────────────────────────
if [[ -f "$REPO/.env" ]]; then
  set -a; source "$REPO/.env"; set +a
else
  echo "[warn] .env not found"
fi

TSX="$REPO/node_modules/.bin/tsx"

# ── Kill anything on our ports first ─────────────────────────────────────────
for port in 3000 4000 4001 4002 4003 4004 4005; do
  pid=$(lsof -ti :"$port" 2>/dev/null || true)
  if [[ -n "$pid" ]]; then
    echo "[start] Freeing port $port (PID $pid)"
    kill "$pid" 2>/dev/null || true
  fi
done
sleep 1

# ── Build dashboard ───────────────────────────────────────────────────────────
if [[ $NO_BUILD -eq 0 ]]; then
  echo "[start] Building dashboard..."
  (cd "$REPO" && npm run build --workspace=packages/dashboard) \
    && echo "[start] Dashboard built ✓" \
    || echo "[warn] Dashboard build failed — using existing build"

  echo "[start] Compiling orchestrator..."
  "$REPO/node_modules/.bin/esbuild" \
    "$REPO/packages/orchestrator/src/server.ts" \
    --bundle \
    --platform=node \
    --format=esm \
    '--banner:js=import{createRequire}from"module";const require=createRequire(import.meta.url);' \
    --external:dotenv \
    --external:express \
    --external:cors \
    --external:ws \
    --external:uuid \
    "--outfile=$REPO/packages/orchestrator/dist/server.js" \
    --log-level=warning \
    && echo "[start] Orchestrator compiled ✓" \
    || { echo "[warn] esbuild failed — will use tsx for orchestrator"; USE_TSX=1; }
fi

# ── Launch a background service ───────────────────────────────────────────────
launch() {
  local name=$1 script=$2
  local log="$LOGS/${name}.log"
  echo "[start] $name → logs/${name}.log"
  (
    export NVM_DIR="$HOME/.nvm"
    source "$NVM_DIR/nvm.sh" --silent
    nvm use 20 --silent
    cd "$REPO"
    exec "$TSX" "$REPO/$script"
  ) >> "$log" 2>&1 &
  echo $! > "$LOGS/${name}.pid"
}

launch_node() {
  local name=$1 js=$2
  local log="$LOGS/${name}.log"
  echo "[start] $name (compiled) → logs/${name}.log"
  (cd "$REPO"; exec node "$REPO/$js") >> "$log" 2>&1 &
  echo $! > "$LOGS/${name}.pid"
}

wait_ready() {
  local name=$1 url=$2
  echo -n "[start] Waiting for $name..."
  for _ in $(seq 1 60); do
    curl -sf "$url" >/dev/null 2>&1 && { echo " ready ✓"; return 0; }
    sleep 1; echo -n "."
  done
  echo " [timeout — check logs/${name}.log]"
}

# ── Start services ────────────────────────────────────────────────────────────
launch registry packages/registry/src/server.ts
wait_ready registry "http://localhost:${REGISTRY_PORT:-4000}/health"

launch stellar-oracle packages/agents/stellar-oracle/src/server.ts
launch web-intel      packages/agents/web-intel/src/server.ts
launch web-intel-v2   packages/agents/web-intel-v2/src/server.ts
launch analysis       packages/agents/analysis/src/server.ts
launch reporter       packages/agents/reporter/src/server.ts

echo "[start] Waiting for agents to register..."
sleep 4

DIST="$REPO/packages/orchestrator/dist/server.js"
if [[ "${USE_TSX:-0}" -eq 1 || ! -f "$DIST" ]]; then
  launch orchestrator packages/orchestrator/src/server.ts
else
  launch_node orchestrator packages/orchestrator/dist/server.js
fi
wait_ready orchestrator "http://localhost:${ORCHESTRATOR_PORT:-3000}/health"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "========================================"
echo "  CleverCon is running"
echo "  Dashboard:  http://localhost:${ORCHESTRATOR_PORT:-3000}"
echo "  Registry:   http://localhost:${REGISTRY_PORT:-4000}"
echo "  Stop with:  ./scripts/stop.sh"
echo "========================================"
