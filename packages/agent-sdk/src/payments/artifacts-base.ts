/**
 * The default public host for the pp/2 circuit artifacts (testnet). Kept in its
 * own Node-free module so both the Node resolver (`artifacts.ts`) and the
 * browser prover entry (`prover.ts`) can share it without pulling Node builtins
 * into a browser bundle. Swap for a custom domain in production.
 *
 * The `/v2` segment is the per-commitment tumbling-window accumulator circuit
 * (anchor_r2/anchor_r7 inputs + reset_r2/reset_r7 outputs). It is a NEW URL on
 * purpose: the previously-deployed dapp/agents keep fetching the old artifacts at
 * the bucket root, so rehosting v2 cannot break live proving mid-cutover. Host the
 * rebuilt policy_batch.wasm / policy_batch_final.zkey / poseidon{2,3,4}.wasm here.
 */
export const DEFAULT_ARTIFACT_BASE_URL = 'https://pub-e758f36ef6b048099ecc75f84a702f7a.r2.dev/v2';

/** The hosted poseidon2/3/4 wasm for {@link makePoseidon} (allowlist/calendar proving). */
export const DEFAULT_POSEIDON_ARTIFACTS = {
  p2: `${DEFAULT_ARTIFACT_BASE_URL}/poseidon2.wasm`,
  p3: `${DEFAULT_ARTIFACT_BASE_URL}/poseidon3.wasm`,
  p4: `${DEFAULT_ARTIFACT_BASE_URL}/poseidon4.wasm`,
};
