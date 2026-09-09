#!/usr/bin/env bash
# Generate a proof + verifying key for the spend-policy circuit inside a Docker
# container, because the barretenberg `bb` binary needs glibc >= 2.38 and some
# hosts (e.g. Ubuntu 22.04 / glibc 2.35) are too old to run it directly.
#
# The container pins a known-good toolchain pair: nargo 1.0.0-beta.6 + bb 0.84.0
# (per AztecProtocol's bb-versions.json). Everything up to the witness is already
# verified on the host by `nargo test` / `nargo execute`; this adds the proof/vk.
#
# Usage (from anywhere):   sudo bash circuits/spend-policy/prove-in-docker.sh
# Outputs land in circuits/spend-policy/target/ : proof, vk.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NARGO_VERSION="1.0.0-beta.6"
BB_VERSION="0.84.0"

docker run --rm -v "$DIR":/work -w /work ubuntu:24.04 bash -euc "
  apt-get update -qq && apt-get install -y -qq curl git >/dev/null
  export PATH=\"\$HOME/.nargo/bin:\$HOME/.bb:\$PATH\"

  # Install the pinned Noir + Barretenberg toolchain.
  curl -fsSL https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash >/dev/null
  \$HOME/.nargo/bin/noirup -v ${NARGO_VERSION} >/dev/null 2>&1
  curl -fsSL https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/bbup/install | bash >/dev/null
  \$HOME/.bb/bbup -v ${BB_VERSION} >/dev/null 2>&1

  echo '== versions =='; nargo --version | head -1; bb --version

  echo '== compile + witness =='
  nargo execute

  echo '== prove =='
  bb prove -b ./target/spend_policy.json -w ./target/spend_policy.gz -o ./target
  echo '== verifying key =='
  bb write_vk -b ./target/spend_policy.json -o ./target
  echo '== verify (self-check) =='
  bb verify -k ./target/vk -p ./target/proof && echo 'PROOF VERIFIES'

  ls -la ./target
"
echo "Done. See circuits/spend-policy/target/ for proof and vk."
