#!/usr/bin/env bash
# Budget Guardian — Build, Deploy, and Initialise on Stellar Testnet
#
# Prerequisites:
#   cargo install stellar-cli
#   rustup target add wasm32-unknown-unknown
#
# Usage:
#   cd contracts/budget-guardian
#   ./deploy.sh
#
# After running, copy the printed BUDGET_CONTRACT_ID into your .env file.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTRACT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Ensure stellar 25.x is used ──────────────────────────────────────────────
# Non-interactive subshells may not inherit the interactive PATH.
# Prepend known install locations so the right binary wins.
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

STELLAR_VERSION=$(stellar version 2>/dev/null | awk 'NR==1{print $2}')
STELLAR_MAJOR=$(echo "$STELLAR_VERSION" | cut -d. -f1)
if [ "${STELLAR_MAJOR:-0}" -lt 25 ]; then
  echo "[deploy] ERROR: stellar-cli 25+ required, found: ${STELLAR_VERSION:-not found}"
  echo "  Install: curl -L https://github.com/stellar/stellar-cli/releases/download/v25.2.0/stellar-cli-x86_64-unknown-linux-gnu.tar.gz | tar xz && mv stellar ~/.local/bin/"
  exit 1
fi
echo "[deploy] Using stellar-cli $STELLAR_VERSION"

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

# Derive orchestrator public key from secret
ORCHESTRATOR_PUBLIC_KEY=$(node -e "
  const { Keypair } = require('@stellar/stellar-sdk');
  console.log(Keypair.fromSecret('$ORCHESTRATOR_SECRET_KEY').publicKey());
" 2>/dev/null) || {
  # Fallback: use stellar CLI to derive
  ORCHESTRATOR_PUBLIC_KEY=$(stellar keys public-key orchestrator 2>/dev/null || echo "")
}

if [ -z "$ORCHESTRATOR_PUBLIC_KEY" ]; then
  echo "[deploy] ERROR: Could not derive orchestrator public key"
  echo "  Set ORCHESTRATOR_SECRET_KEY in .env, or add a 'orchestrator' key to stellar CLI"
  exit 1
fi

echo "[deploy] Orchestrator public key: $ORCHESTRATOR_PUBLIC_KEY"

# ── Configure testnet network if not already done ────────────────────────────

if ! stellar network ls 2>/dev/null | grep -q "testnet"; then
  echo "[deploy] Configuring testnet network..."
  stellar network add testnet \
    --rpc-url "https://soroban-testnet.stellar.org" \
    --network-passphrase "Test SDF Network ; September 2015"
fi

# Use secret key directly in all stellar commands (--source accepts S... key directly)
# No keystore interaction needed.

# ── Build ─────────────────────────────────────────────────────────────────────

cd "$CONTRACT_DIR"
echo "[deploy] Building contract with cargo (wasm32-unknown-unknown)..."
# Use cargo directly — stellar contract build in CLI 22.x forces wasm32v1-none
# which produces XDR errors on current testnet. wasm32-unknown-unknown works.
cargo build \
  --target wasm32-unknown-unknown \
  --release \
  --manifest-path Cargo.toml

WASM_PATH="$CONTRACT_DIR/target/wasm32-unknown-unknown/release/budget_guardian.wasm"

if [ ! -f "$WASM_PATH" ]; then
  echo "[deploy] ERROR: Build failed — wasm not found at $WASM_PATH"
  exit 1
fi

echo "[deploy] Build complete: $(du -h "$WASM_PATH" | cut -f1) wasm"

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

echo "[deploy] Initialising contract (admin = orchestrator)..."
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --rpc-url "https://soroban-testnet.stellar.org" \
  --network-passphrase "Test SDF Network ; September 2015" \
  --source "$ORCHESTRATOR_SECRET_KEY" \
  -- init \
  --admin "$ORCHESTRATOR_PUBLIC_KEY"

echo "[deploy] Contract initialised."

# ── Verify ────────────────────────────────────────────────────────────────────

echo "[deploy] Verifying — creating test task..."
TEST_TASK_ID=$(stellar contract invoke \
  --id "$CONTRACT_ID" \
  --rpc-url "https://soroban-testnet.stellar.org" \
  --network-passphrase "Test SDF Network ; September 2015" \
  --source "$ORCHESTRATOR_SECRET_KEY" \
  -- create_task \
  --owner "$ORCHESTRATOR_PUBLIC_KEY" \
  --budget 1500000)

echo "[deploy] Test task created: task_id=$TEST_TASK_ID"

echo "[deploy] Approving spend of 100000 stroops..."
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --rpc-url "https://soroban-testnet.stellar.org" \
  --network-passphrase "Test SDF Network ; September 2015" \
  --source "$ORCHESTRATOR_SECRET_KEY" \
  -- approve_spend \
  --owner "$ORCHESTRATOR_PUBLIC_KEY" \
  --task_id "$TEST_TASK_ID" \
  --amount 100000

REMAINING=$(stellar contract invoke \
  --id "$CONTRACT_ID" \
  --rpc-url "https://soroban-testnet.stellar.org" \
  --network-passphrase "Test SDF Network ; September 2015" \
  --source "$ORCHESTRATOR_SECRET_KEY" \
  -- get_remaining \
  --task_id "$TEST_TASK_ID")

echo "[deploy] Remaining: $REMAINING stroops (expected 1400000)"

# ── Output ────────────────────────────────────────────────────────────────────

echo ""
echo "=========================================================="
echo "  Budget Guardian deployed and verified!"
echo "=========================================================="
echo ""
echo "  Add this to your .env file:"
echo "  BUDGET_CONTRACT_ID=$CONTRACT_ID"
echo ""
echo "  Explorer:"
echo "  https://stellar.expert/explorer/testnet/contract/$CONTRACT_ID"
echo "=========================================================="

# Auto-update .env if BUDGET_CONTRACT_ID line exists
if grep -q "^BUDGET_CONTRACT_ID=" "$REPO_DIR/.env"; then
  sed -i "s|^BUDGET_CONTRACT_ID=.*|BUDGET_CONTRACT_ID=$CONTRACT_ID|" "$REPO_DIR/.env"
  echo "[deploy] .env updated automatically with new BUDGET_CONTRACT_ID"
else
  echo "BUDGET_CONTRACT_ID=$CONTRACT_ID" >> "$REPO_DIR/.env"
  echo "[deploy] BUDGET_CONTRACT_ID appended to .env"
fi
