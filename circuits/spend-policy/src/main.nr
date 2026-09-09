//! spend-policy: proves a release obeys a private spending policy.
//!
//! Implements the four composable rule types from docs/private-policies.md,
//! exposing only (commitment, payee, amount, nullifier) publicly. The policy
//! itself (ceilings, caps, allow/deny lists) stays a private witness.
//!
//! v1 note: amounts are compared as u64 (stroops). Realistic USDC amounts fit
//! comfortably; the spec's u128 wire encoding is unchanged and widening the
//! in-circuit comparison type is a v2 item (see the package README).

global VERSION: Field = 1;
global DENYLIST_LEN: u32 = 4;
global MERKLE_DEPTH: u32 = 4;
// Number of policy fields hashed into the commitment (before the salt).
global ENCODING_LEN: u32 = 15;

/// Canonical commitment: Poseidon2 over the policy encoding then the salt.
/// Field order mirrors docs/private-policies.md section 3.
fn commit(
    en: [Field; 4],
    r1_ceiling: Field,
    r2_cap: Field,
    r2_window: Field,
    r2_delegate: Field,
    r3_root: Field,
    r3_depth: Field,
    r4_entries: [Field; DENYLIST_LEN],
    r4_threshold: Field,
    salt: Field,
) -> Field {
    let encoding: [Field; ENCODING_LEN] = [
        en[0], en[1], en[2], en[3],
        r1_ceiling,
        r2_cap, r2_window, r2_delegate,
        r3_root, r3_depth,
        r4_entries[0], r4_entries[1], r4_entries[2], r4_entries[3],
        r4_threshold,
    ];
    // Fold the version and salt in so the commitment binds them too.
    let mut preimage: [Field; 17] = [0; 17];
    for i in 0..ENCODING_LEN {
        preimage[i] = encoding[i];
    }
    preimage[15] = VERSION;
    preimage[16] = salt;
    std::hash::pedersen_hash(preimage)
}

/// Deterministic, unlinkable spend-once nullifier (section 5).
fn nullify(commitment: Field, payee: Field, amount: Field, spend_counter: Field) -> Field {
    std::hash::pedersen_hash([commitment, payee, amount, spend_counter])
}

/// Recompute a Merkle root from a leaf and its authentication path (Poseidon2).
fn merkle_root(
    leaf: Field,
    path: [Field; MERKLE_DEPTH],
    index_bits: [bool; MERKLE_DEPTH],
) -> Field {
    let mut cur = leaf;
    for i in 0..MERKLE_DEPTH {
        let sibling = path[i];
        // index_bits[i] == 0 => cur is the left child.
        let left = if !index_bits[i] { cur } else { sibling };
        let right = if !index_bits[i] { sibling } else { cur };
        cur = std::hash::pedersen_hash([left, right]);
    }
    cur
}

fn is_bool(x: Field) -> bool {
    (x == 0) | (x == 1)
}

fn main(
    // -- public inputs (section 4) --
    commitment: pub Field,
    payee: pub Field,
    amount: pub Field,
    nullifier: pub Field,
    // -- private witnesses --
    salt: Field,
    spend_counter: Field,
    // rule enable flags (0/1)
    en: [Field; 4],
    // R1 per-payment ceiling
    r1_ceiling: Field,
    // R2 rolling cap over a window (running_spend supplied by the vault)
    r2_cap: Field,
    r2_window: Field,
    r2_delegate: Field,
    running_spend: Field,
    // R3 allowlist (Merkle membership of payee)
    r3_root: Field,
    r3_depth: Field,
    r3_path: [Field; MERKLE_DEPTH],
    r3_index_bits: [bool; MERKLE_DEPTH],
    // R4 deny-list + threshold
    r4_entries: [Field; DENYLIST_LEN],
    r4_threshold: Field,
) {
    // Enable flags must be boolean, and at least one rule must be active
    // (an empty policy is not "allow all").
    for i in 0..4 {
        assert(is_bool(en[i]));
    }
    assert((en[0] + en[1] + en[2] + en[3]) != 0);

    // The public commitment must be exactly this policy under this salt.
    let expected = commit(
        en, r1_ceiling, r2_cap, r2_window, r2_delegate, r3_root, r3_depth, r4_entries,
        r4_threshold, salt,
    );
    assert(expected == commitment);

    // The nullifier must be derived from the release (spend-once, unlinkable).
    assert(nullify(commitment, payee, amount, spend_counter) == nullifier);

    let amt = amount as u64;

    // R1: amount <= ceiling (inclusive). Neutral when disabled.
    let r1_ok = (en[0] == 0) | (amt <= r1_ceiling as u64);
    assert(r1_ok);

    // R2: running_spend + amount <= cap (inclusive). Neutral when disabled.
    let r2_ok = (en[1] == 0) | ((running_spend as u64 + amt) <= r2_cap as u64);
    assert(r2_ok);

    // R3: payee is in the allowlist Merkle tree. Neutral when disabled.
    let r3_ok = (en[2] == 0) | (merkle_root(payee, r3_path, r3_index_bits) == r3_root);
    assert(r3_ok);

    // R4: when active and amount >= threshold, payee must not be denied.
    let r4_active = (en[3] == 1) & (amt >= r4_threshold as u64);
    for i in 0..DENYLIST_LEN {
        let violates = r4_active & (payee == r4_entries[i]);
        assert(violates == false);
    }
}

// -- Tests -------------------------------------------------------------------
// Each test builds a witness, derives the commitment/nullifier the same way the
// circuit does, and checks the circuit accepts or rejects it.

global SALT: Field = 123456789;
global COUNTER: Field = 0;
global PAYEE: Field = 42;

fn zero_denylist() -> [Field; DENYLIST_LEN] {
    [0; DENYLIST_LEN]
}

// A policy with only R1 (per-payment ceiling) enabled.
fn r1_policy(ceiling: Field) -> ([Field; 4], Field) {
    let en = [1, 0, 0, 0];
    let commitment = commit(
        en, ceiling, 0, 0, 0, 0, 0, zero_denylist(), 0, SALT,
    );
    (en, commitment)
}

#[test]
fn accepts_payment_within_ceiling() {
    let (en, commitment) = r1_policy(100);
    let amount = 60;
    let nullifier = nullify(commitment, PAYEE, amount, COUNTER);
    main(
        commitment, PAYEE, amount, nullifier, SALT, COUNTER, en, 100, 0, 0, 0, 0, 0, 0, [0; MERKLE_DEPTH],
        [false; MERKLE_DEPTH], zero_denylist(), 0,
    );
}

#[test]
fn accepts_payment_exactly_at_ceiling() {
    let (en, commitment) = r1_policy(100);
    let amount = 100; // inclusive boundary
    let nullifier = nullify(commitment, PAYEE, amount, COUNTER);
    main(
        commitment, PAYEE, amount, nullifier, SALT, COUNTER, en, 100, 0, 0, 0, 0, 0, 0, [0; MERKLE_DEPTH],
        [false; MERKLE_DEPTH], zero_denylist(), 0,
    );
}

#[test(should_fail)]
fn rejects_payment_over_ceiling() {
    let (en, commitment) = r1_policy(100);
    let amount = 101;
    let nullifier = nullify(commitment, PAYEE, amount, COUNTER);
    main(
        commitment, PAYEE, amount, nullifier, SALT, COUNTER, en, 100, 0, 0, 0, 0, 0, 0, [0; MERKLE_DEPTH],
        [false; MERKLE_DEPTH], zero_denylist(), 0,
    );
}

#[test(should_fail)]
fn rejects_wrong_commitment() {
    let (en, _commitment) = r1_policy(100);
    let amount = 60;
    let bogus = 999999;
    let nullifier = nullify(bogus, PAYEE, amount, COUNTER);
    main(
        bogus, PAYEE, amount, nullifier, SALT, COUNTER, en, 100, 0, 0, 0, 0, 0, 0, [0; MERKLE_DEPTH],
        [false; MERKLE_DEPTH], zero_denylist(), 0,
    );
}

#[test(should_fail)]
fn rejects_empty_policy() {
    let en = [0, 0, 0, 0];
    let commitment = commit(en, 0, 0, 0, 0, 0, 0, zero_denylist(), 0, SALT);
    let amount = 60;
    let nullifier = nullify(commitment, PAYEE, amount, COUNTER);
    main(
        commitment, PAYEE, amount, nullifier, SALT, COUNTER, en, 0, 0, 0, 0, 0, 0, 0, [0; MERKLE_DEPTH],
        [false; MERKLE_DEPTH], zero_denylist(), 0,
    );
}

#[test]
fn accepts_rolling_cap_within_budget() {
    let en = [0, 1, 0, 0];
    let cap = 500;
    let commitment = commit(en, 0, cap, 86400, 0, 0, 0, zero_denylist(), 0, SALT);
    let amount = 100;
    let running = 300; // 300 + 100 <= 500
    let nullifier = nullify(commitment, PAYEE, amount, COUNTER);
    main(
        commitment, PAYEE, amount, nullifier, SALT, COUNTER, en, 0, cap, 86400, 0, running, 0, 0,
        [0; MERKLE_DEPTH], [false; MERKLE_DEPTH], zero_denylist(), 0,
    );
}

#[test(should_fail)]
fn rejects_rolling_cap_exceeded() {
    let en = [0, 1, 0, 0];
    let cap = 500;
    let commitment = commit(en, 0, cap, 86400, 0, 0, 0, zero_denylist(), 0, SALT);
    let amount = 300;
    let running = 300; // 300 + 300 > 500
    let nullifier = nullify(commitment, PAYEE, amount, COUNTER);
    main(
        commitment, PAYEE, amount, nullifier, SALT, COUNTER, en, 0, cap, 86400, 0, running, 0, 0,
        [0; MERKLE_DEPTH], [false; MERKLE_DEPTH], zero_denylist(), 0,
    );
}

#[test(should_fail)]
fn rejects_denied_payee_over_threshold() {
    let en = [0, 0, 0, 1];
    let denylist = [PAYEE, 0, 0, 0]; // PAYEE is denied
    let threshold = 50;
    let commitment = commit(en, 0, 0, 0, 0, 0, 0, denylist, threshold, SALT);
    let amount = 60; // >= threshold, so the deny-list applies
    let nullifier = nullify(commitment, PAYEE, amount, COUNTER);
    main(
        commitment, PAYEE, amount, nullifier, SALT, COUNTER, en, 0, 0, 0, 0, 0, 0, 0, [0; MERKLE_DEPTH],
        [false; MERKLE_DEPTH], denylist, threshold,
    );
}

#[test]
fn accepts_denied_payee_under_threshold() {
    let en = [0, 0, 0, 1];
    let denylist = [PAYEE, 0, 0, 0];
    let threshold = 50;
    let commitment = commit(en, 0, 0, 0, 0, 0, 0, denylist, threshold, SALT);
    let amount = 20; // below threshold, deny-list does not apply
    let nullifier = nullify(commitment, PAYEE, amount, COUNTER);
    main(
        commitment, PAYEE, amount, nullifier, SALT, COUNTER, en, 0, 0, 0, 0, 0, 0, 0, [0; MERKLE_DEPTH],
        [false; MERKLE_DEPTH], denylist, threshold,
    );
}

