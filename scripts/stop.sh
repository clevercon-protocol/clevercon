#!/usr/bin/env bash
# AgentForge — Stop all services

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="$REPO/logs"

SERVICES=(registry stellar-oracle web-intel web-intel-v2 analysis reporter orchestrator)

for name in "${SERVICES[@]}"; do
  pid_file="$LOGS/${name}.pid"
  if [[ -f "$pid_file" ]]; then
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      echo "[stop] Stopping $name (PID $pid)"
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
  fi
done

# Kill anything still holding our ports
for port in 3000 4000 4001 4002 4003 4004 4005; do
  pid=$(lsof -ti :"$port" 2>/dev/null || true)
  if [[ -n "$pid" ]]; then
    echo "[stop] Killing orphan on port $port (PID $pid)"
    kill "$pid" 2>/dev/null || true
  fi
done

echo "[stop] Done."
