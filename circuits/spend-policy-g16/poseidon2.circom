pragma circom 2.1.0;

// Two-input Poseidon exposed as a standalone circuit, used as a hash oracle when
// building allowlist Merkle trees and authentication paths off-circuit. Because
// it is the SAME circomlib Poseidon compiled over the SAME BLS12-381 field as
// policy_single.circom, trees built with it match the in-circuit hash exactly,
// with no separate JS Poseidon implementation to keep in sync.

include "poseidon.circom";

template Poseidon2() {
    signal input a;
    signal input b;
    signal output out;
    component h = Poseidon(2);
    h.inputs[0] <== a;
    h.inputs[1] <== b;
    out <== h.out;
}

component main = Poseidon2();
