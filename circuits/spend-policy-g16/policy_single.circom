pragma circom 2.1.0;

// pp/2 single-release spend-policy circuit, over BLS12-381 so the proof is
// checked by a real pairing on-chain (contracts/policy-verifier verify_groth16).
// See docs/private-policies-v2.md.
//
// Public outputs (circuit-computed): commitment, nullifier.
// Public inputs (vault-supplied):    payee_field, amount.
//
// Rules enforced: R1 (per-payment ceiling), R3 (allowlist Merkle membership,
// depth 16 = 65,536 payees), R5 (per-payee limit, carried in the allowlist
// leaf). R2/R4/R6 fields are bound into the commitment and land in later
// increments. The commitment binds the ENTIRE policy encoding (section 3), so
// the commitment format is final.
//
// Hash: Poseidon. This increment compiles circomlib's Poseidon over the
// BLS12-381 field; production pins BLS12-381-native Poseidon constants (see the
// package README) before the trusted setup.

include "poseidon.circom";
include "comparators.circom";
include "bitify.circom";

// Recompute a Merkle root from a leaf and its authentication path. pathIndex[i]
// is the leaf-or-sibling selector at level i (0 = current node is the left
// child). Selection is arithmetic (degree 2), no external mux needed.
template MerkleRoot(DEPTH) {
    signal input leaf;
    signal input pathElements[DEPTH];
    signal input pathIndex[DEPTH];
    signal output root;

    component hashers[DEPTH];
    signal cur[DEPTH + 1];
    signal left[DEPTH];
    signal right[DEPTH];
    cur[0] <== leaf;
    for (var i = 0; i < DEPTH; i++) {
        pathIndex[i] * (pathIndex[i] - 1) === 0;
        left[i] <== cur[i] + pathIndex[i] * (pathElements[i] - cur[i]);
        right[i] <== pathElements[i] + pathIndex[i] * (cur[i] - pathElements[i]);
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== left[i];
        hashers[i].inputs[1] <== right[i];
        cur[i + 1] <== hashers[i].out;
    }
    root <== cur[DEPTH];
}

template PolicySingle(DEPTH) {
    // ---- public inputs (reconstructed by the vault from the real release) ----
    signal input payee_field;   // SHA-256(payee scval xdr) mod r
    signal input amount;        // stroops (u128)

    // ---- private witnesses: the policy (all commitment fields, section 3) ----
    signal input en[6];         // enabled flags R1..R6 (0/1)
    signal input r1_ceiling;
    signal input r2_cap;
    signal input r2_window;
    signal input r2_delegate;
    signal input r3_root;
    signal input r3_depth;
    signal input r4_entries[4];
    signal input r4_threshold;
    signal input r6_windows_root;
    signal input category;
    signal input salt;
    signal input spend_counter;

    // ---- private witnesses: this release's allowlist membership ----
    signal input r3_path[DEPTH];
    signal input r3_index[DEPTH];
    signal input payee_cap;     // per-payee limit (R5), bound inside the leaf

    // ---- public outputs (circuit-computed) ----
    signal output commitment;
    signal output nullifier;

    var VERSION = 2;

    // Enabled flags are boolean, and at least one rule is active (an empty
    // policy is never "allow all").
    var ensum = 0;
    for (var i = 0; i < 6; i++) {
        en[i] * (en[i] - 1) === 0;
        ensum += en[i];
    }
    component notEmpty = IsZero();
    notEmpty.in <== ensum;
    notEmpty.out === 0;

    // amount is range-bound to u128 so the comparisons below are sound.
    component amountBits = Num2Bits(128);
    amountBits.in <== amount;

    // Commitment = Poseidon over the full policy encoding, chained to stay
    // within Poseidon arity, then folded with the salt (hiding).
    component h1 = Poseidon(12);
    h1.inputs[0] <== en[0];
    h1.inputs[1] <== en[1];
    h1.inputs[2] <== en[2];
    h1.inputs[3] <== en[3];
    h1.inputs[4] <== en[4];
    h1.inputs[5] <== en[5];
    h1.inputs[6] <== r1_ceiling;
    h1.inputs[7] <== r2_cap;
    h1.inputs[8] <== r2_window;
    h1.inputs[9] <== r2_delegate;
    h1.inputs[10] <== r3_root;
    h1.inputs[11] <== r3_depth;

    component h2 = Poseidon(8);
    h2.inputs[0] <== r4_entries[0];
    h2.inputs[1] <== r4_entries[1];
    h2.inputs[2] <== r4_entries[2];
    h2.inputs[3] <== r4_entries[3];
    h2.inputs[4] <== r4_threshold;
    h2.inputs[5] <== r6_windows_root;
    h2.inputs[6] <== category;
    h2.inputs[7] <== VERSION;

    component hc = Poseidon(3);
    hc.inputs[0] <== h1.out;
    hc.inputs[1] <== h2.out;
    hc.inputs[2] <== salt;
    commitment <== hc.out;

    // R1: if enabled, amount <= ceiling (inclusive). Neutral when disabled.
    component le1 = LessEqThan(128);
    le1.in[0] <== amount;
    le1.in[1] <== r1_ceiling;
    en[0] * (1 - le1.out) === 0;

    // R3: if enabled, payee is in the allowlist. The leaf carries the per-payee
    // cap (R5), so membership also binds that cap. Leaf = H(payee_field, cap).
    component leafH = Poseidon(2);
    leafH.inputs[0] <== payee_field;
    leafH.inputs[1] <== payee_cap;
    component mt = MerkleRoot(DEPTH);
    mt.leaf <== leafH.out;
    for (var i = 0; i < DEPTH; i++) {
        mt.pathElements[i] <== r3_path[i];
        mt.pathIndex[i] <== r3_index[i];
    }
    // en[2]==1 => computed root == committed root.
    en[2] * (mt.root - r3_root) === 0;

    // R5: per-payee limit. Requires R3 (the cap lives in the proven leaf).
    en[4] * (1 - en[2]) === 0;
    component le5 = LessEqThan(128);
    le5.in[0] <== amount;
    le5.in[1] <== payee_cap;
    en[4] * (1 - le5.out) === 0;

    // Nullifier binds the release (spend-once, unlinkable to the rule).
    component hn = Poseidon(4);
    hn.inputs[0] <== commitment;
    hn.inputs[1] <== payee_field;
    hn.inputs[2] <== amount;
    hn.inputs[3] <== spend_counter;
    nullifier <== hn.out;
}

component main {public [payee_field, amount]} = PolicySingle(16);
