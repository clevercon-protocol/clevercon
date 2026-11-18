// Minimal ambient declaration for the pieces of snarkjs the batch prover uses,
// so the SDK typechecks and builds without snarkjs installed at build time. It is
// a runtime dependency (see package.json) and is loaded via dynamic import.
declare module 'snarkjs' {
  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmPath: string,
      zkeyPath: string,
    ): Promise<{
      proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[] };
      publicSignals: string[];
    }>;
  };
}

// snarkjs's bundled witness-calculator runtime, used by the Poseidon oracle to
// hash with the circuit's own compiled wasm (browser-compatible: no file I/O).
declare module 'circom_runtime' {
  export function WitnessCalculatorBuilder(
    code: Uint8Array | ArrayBuffer,
    options?: unknown,
  ): Promise<{
    calculateWitness(
      input: Record<string, unknown>,
      sanityCheck?: number | boolean,
    ): Promise<Array<string | bigint>>;
  }>;
}
