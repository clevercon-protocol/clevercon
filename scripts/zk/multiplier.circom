pragma circom 2.0.0;

// Minimal circuit to produce a real BLS12-381 Groth16 proof + verifying key for
// testing the on-chain verifier (contracts/policy-verifier). It proves knowledge
// of two private factors a, b whose product is the public output c.
template Multiplier() {
    signal input a;
    signal input b;
    signal output c;
    c <== a * b;
}

component main = Multiplier();
