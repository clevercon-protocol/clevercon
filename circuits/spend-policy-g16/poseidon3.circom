pragma circom 2.1.0;

// Three-input Poseidon exposed as a standalone circuit, used as a hash oracle for
// building allowlist leaves off-circuit. The leaf is H(payee, cap, category), so
// one membership proof binds the payee's per-payee cap (R5) and category (R8).
// Same circomlib Poseidon over the same BLS12-381 field as policy_batch.circom,
// so off-circuit leaves match the in-circuit hash exactly.

include "poseidon.circom";

template Poseidon3() {
    signal input a;
    signal input b;
    signal input c;
    signal output out;
    component h = Poseidon(3);
    h.inputs[0] <== a;
    h.inputs[1] <== b;
    h.inputs[2] <== c;
    out <== h.out;
}

component main = Poseidon3();
