#!/usr/bin/env bash
# AgentVault — Build, Deploy, and Initialise on Stellar Testnet
#
# Mirrors the budget-guardian/deploy.sh pattern exactly.
# Prerequisites:
#   cargo installed with wasm32-unknown-unknown target
#   stellar-cli 25+ installed (curl from GitHub releases)
#
# Usage:
#   cd contracts/agent-vault
#   ./deploy.sh
#
# After running, AGENT_VAULT_CONTRACT_ID is written to .env automatically.
#
# USDC SAC on testnet: CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTRACT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Ensure stellar 25.x ────────────────────────────────────────────────────────

export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

STELLAR_VERSION=$(stellar version 2>/dev/null | awk 'NR==1{print $2}')
STELLAR_MAJOR=$(echo "$STELLAR_VERSION" | cut -d. -f1)
if [ "${STELLAR_MAJOR:-0}" -lt 25 ]; then
  echo "[deploy] ERROR: stellar-cli 25+ required, found: ${STELLAR_VERSION:-not found}"
  echo "  Install: curl -L https://github.com/stellar/stellar-cli/releases/download/v25.2.0/stellar-cli-x86_64-unknown-linux-gnu.tar.gz | tar xz && mv stellar ~/.local/bin/"
  exit 1
fi
echo "[deploy] Using stellar-cli $STELLAR_VERSION"

# ── USDC SAC (Stellar Asset Contract for USDC on testnet) ────────────────────
# This is the canonical USDC SAC address on Stellar testnet.
# The contract must be able to receive USDC deposits via this SAC.
USDC_SAC="CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"

# ── Load environment ──────────────────────────────────────────────────────────

if [ -f "$REPO_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_DIR/.env"
  set +a
else
  echo "[deploy] ERROR: .env not found at $REPO_DIR/.env"
  exit 1
fi

# Derive orchestrator public key from secret key
ORCHESTRATOR_PUBLIC_KEY=$(node -e "
  const { Keypair } = require('@stellar/stellar-sdk');
  console.log(Keypair.fromSecret('$ORCHESTRATOR_SECRET_KEY').publicKey());
" 2>/dev/null) || {
  ORCHESTRATOR_PUBLIC_KEY=$(stellar keys public-key orchestrator 2>/dev/null || echo "")
}

if [ -z "$ORCHESTRATOR_PUBLIC_KEY" ]; then
  echo "[deploy] ERROR: Could not derive orchestrator public key"
  echo "  Set ORCHESTRATOR_SECRET_KEY in .env"
  exit 1
fi

echo "[deploy] Orchestrator:  $ORCHESTRATOR_PUBLIC_KEY"
echo "[deploy] USDC SAC:      $USDC_SAC"

# ── Configure testnet network ─────────────────────────────────────────────────

if ! stellar network ls 2>/dev/null | grep -q "testnet"; then
  echo "[deploy] Configuring testnet network..."
  stellar network add testnet \
    --rpc-url "https://soroban-testnet.stellar.org" \
    --network-passphrase "Test SDF Network ; September 2015"
fi

# ── Build ─────────────────────────────────────────────────────────────────────

cd "$CONTRACT_DIR"
echo "[deploy] Building contract (stellar contract build → wasm32v1-none)..."
stellar contract build

WASM_PATH="$CONTRACT_DIR/target/wasm32v1-none/release/agent_vault.wasm"

if [ ! -f "$WASM_PATH" ]; then
  echo "[deploy] ERROR: Build failed — wasm not found at $WASM_PATH"
  exit 1
fi

echo "[deploy] Build complete: $(du -h "$WASM_PATH" | cut -f1)"

# ── Deploy ────────────────────────────────────────────────────────────────────

echo "[deploy] Deploying to testnet..."
CONTRACT_ID=$(stellar contract deploy \
  --wasm "$WASM_PATH" \
  --rpc-url "https://soroban-testnet.stellar.org" \
  --network-passphrase "Test SDF Network ; September 2015" \
  --source "$ORCHESTRATOR_SECRET_KEY" \
  --inclusion-fee 1000000)

echo ""
echo "[deploy] Contract deployed!"
echo "[deploy] CONTRACT_ID: $CONTRACT_ID"

# ── Initialise ────────────────────────────────────────────────────────────────

echo "[deploy] Initialising contract (admin=$ORCHESTRATOR_PUBLIC_KEY, usdc_sac=$USDC_SAC)..."
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --rpc-url "https://soroban-testnet.stellar.org" \
  --network-passphrase "Test SDF Network ; September 2015" \
  --source "$ORCHESTRATOR_SECRET_KEY" \
  -- init \
  --admin "$ORCHESTRATOR_PUBLIC_KEY" \
  --usdc_sac "$USDC_SAC"

echo "[deploy] Contract initialised."

# ── Smoke test ────────────────────────────────────────────────────────────────
# Verify get_available and task_count work (read-only, no USDC needed)

echo "[deploy] Smoke test — checking task_count..."
TASK_COUNT=$(stellar contract invoke \
  --id "$CONTRACT_ID" \
  --rpc-url "https://soroban-testnet.stellar.org" \
  --network-passphrase "Test SDF Network ; September 2015" \
  --source "$ORCHESTRATOR_SECRET_KEY" \
  -- task_count)
echo "[deploy] task_count = $TASK_COUNT (expected 0)"

echo "[deploy] Checking get_available for orchestrator (expect 0)..."
AVAIL=$(stellar contract invoke \
  --id "$CONTRACT_ID" \
  --rpc-url "https://soroban-testnet.stellar.org" \
  --network-passphrase "Test SDF Network ; September 2015" \
  --source "$ORCHESTRATOR_SECRET_KEY" \
  -- get_available \
  --user "$ORCHESTRATOR_PUBLIC_KEY")
echo "[deploy] get_available = $AVAIL (expected 0)"

# ── Output ────────────────────────────────────────────────────────────────────

echo ""
echo "================================================================"
echo "  AgentVault deployed and verified!"
echo "================================================================"
echo ""
echo "  CONTRACT_ID:  $CONTRACT_ID"
echo "  USDC SAC:     $USDC_SAC"
echo "  Admin:        $ORCHESTRATOR_PUBLIC_KEY"
echo ""
echo "  Explorer:"
echo "  https://stellar.expert/explorer/testnet/contract/$CONTRACT_ID"
echo ""
echo "================================================================"
echo ""
echo "  Next steps — test with Stellar CLI:"
echo ""
echo "  # 1. Register orchestrator (user signs)"
echo "  stellar contract invoke --id $CONTRACT_ID --network testnet --source \$USER_SEC \\"
echo "    -- register_orchestrator --user \$USER_PUB --orchestrator \$ORCH_PUB --name '\"Phoenix\"'"
echo ""
echo "  # 2. Deposit USDC (user must have USDC trustline + balance)"
echo "  stellar contract invoke --id $CONTRACT_ID --network testnet --source \$USER_SEC \\"
echo "    -- deposit --user \$USER_PUB --amount 50000000"
echo ""
echo "  # 3. Create task (orchestrator signs)"
echo "  stellar contract invoke --id $CONTRACT_ID --network testnet --source \$ORCH_SEC \\"
echo "    -- create_task --orchestrator \$ORCH_PUB --plan_cost 10000000"
echo ""
echo "  See docs/sections/upgrade-u1-agent-vault.md for the full test checklist."
echo "================================================================"

# ── Auto-update .env ──────────────────────────────────────────────────────────

if grep -q "^AGENT_VAULT_CONTRACT_ID=" "$REPO_DIR/.env"; then
  sed -i "s|^AGENT_VAULT_CONTRACT_ID=.*|AGENT_VAULT_CONTRACT_ID=$CONTRACT_ID|" "$REPO_DIR/.env"
  echo "[deploy] .env updated: AGENT_VAULT_CONTRACT_ID=$CONTRACT_ID"
else
  echo "" >> "$REPO_DIR/.env"
  echo "# AgentVault contract (v2 trustless treasury)" >> "$REPO_DIR/.env"
  echo "AGENT_VAULT_CONTRACT_ID=$CONTRACT_ID" >> "$REPO_DIR/.env"
  echo "[deploy] AGENT_VAULT_CONTRACT_ID appended to .env"
fi
