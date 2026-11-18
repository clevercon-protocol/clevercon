# pp/2 testnet deployment runbook

How to bring the pp/2 private-batch-payment path live on Stellar testnet: build
the proving artifacts, deploy the trustless verifier + vault, install the
verifying key, and point the SDK/app at it. The on-chain pieces (circuit,
verifier, vault) are all CI-proven; this wires them together on-chain. See
[private-policies-v2.md](private-policies-v2.md) for the protocol.

## 0. Prerequisites

- `soroban`/`stellar` CLI with a funded testnet identity.
- Node 20 (for the converter scripts).
- The proving artifacts from the **"ZK proving artifacts"** workflow
  (`.github/workflows/zk-artifacts.yml`, run via workflow_dispatch). Download the
  `pp2-proving-artifacts` bundle: `policy_batch.wasm`, `policy_batch_final.zkey`,
  `policy_batch_vkey.json`, and the `poseidon{2,3,4}.wasm` oracles. The setup is
  reproducible (fixed entropy), so the VK matches the committed zkey.

## 1. Build + deploy the contracts

```sh
# From contracts/, build the wasm (CI also produces these).
soroban contract build   # policy-verifier + agent-vault

VERIFIER=$(soroban contract deploy --wasm target/wasm32-unknown-unknown/release/policy_verifier.wasm --network testnet --source <ID>)
VAULT=$(soroban contract deploy --wasm target/wasm32-unknown-unknown/release/agent_vault.wasm --network testnet --source <ID>)

soroban contract invoke --id $VERIFIER --network testnet --source <ID> -- init --admin <ADMIN>
soroban contract invoke --id $VAULT    --network testnet --source <ID> -- init --admin <ADMIN> --usdc_sac <USDC_SAC>
```

## 2. Install the Groth16 verifying key

Convert the snarkjs VK to the Soroban `Groth16Vk` component bytes:

```sh
node scripts/zk/vk-to-soroban.mjs policy_batch_vkey.json > groth16-vk.json
```

`groth16-vk.json` holds hex for `alpha_g1` (96 bytes), `beta_g2` / `gamma_g2` /
`delta_g2` (192 each), and `ic` (96 each, length = public-signal count + 1 = 18 for
N=4). Call `set_groth16_vk(admin, vk)` with those values (the arg is the struct
`{ alpha_g1, beta_g2, gamma_g2, delta_g2, ic }`). Confirm with:

```sh
soroban contract invoke --id $VERIFIER --network testnet --source <ID> -- get_groth16_vk_hash
```

## 3. Wire the vault to the verifier

```sh
soroban contract invoke --id $VAULT --network testnet --source <ID> -- \
  set_policy_verifier --admin <ADMIN> --verifier $VERIFIER
```

## 4. Point the app + SDK at it

- API / workers (Railway) and web (Cloudflare): set the new `VERIFIER` and `VAULT`
  contract IDs in their env, redeploy via `git push` (auto-deploy is wired).
- `@clevercon/agent-sdk`: ship `policy_batch.wasm` + `policy_batch_final.zkey`
  alongside the package (or host them) and pass their paths to `createBatchProof`.
  The SDK reconstructs `payee_field` with the same encoding the vault uses, so a
  proof binds to the real payees.

## 5. Smoke test

Create a task with a policy commitment, generate a batch proof client-side
(`createBatchProof`), read the vault's current `running_spend` / `prior_count`
first (they are exact public inputs), pick a validity window around the current
ledger time, and call `release_payment_proved_batch`. Funds move only if the
on-chain pairing accepts the proof.

## Notes

- The ceremony here is single-contributor (dev/testnet). **Mainnet requires a real
  multi-contributor trusted setup**; rotate the VK via `set_groth16_vk` and
  re-publish the zkey.
- `running_spend` / `prior_count` are exact public inputs: read them from the vault
  immediately before proving; if another release lands first, regenerate.
