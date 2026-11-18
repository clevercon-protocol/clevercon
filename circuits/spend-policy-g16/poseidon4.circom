pragma circom 2.1.0;

// Four-input Poseidon exposed as a standalone circuit, used as a hash oracle for
// computing the R6 calendar windows root off-circuit (H of the window bounds).
// Same circomlib Poseidon over the same BLS12-381 field as policy_batch.circom.

include "poseidon.circom";

template Poseidon4() {
    signal input a;
    signal input b;
    signal input c;
    signal input d;
    signal output out;
    component h = Poseidon(4);
    h.inputs[0] <== a;
    h.inputs[1] <== b;
    h.inputs[2] <== c;
    h.inputs[3] <== d;
    out <== h.out;
}

component main = Poseidon4();
