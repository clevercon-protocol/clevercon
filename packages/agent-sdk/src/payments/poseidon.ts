/**
 * A Poseidon hash oracle over BLS12-381, backed by the circuit's OWN compiled
 * poseidon2/3/4 wasm. The spend-policy circuit hashes with circomlib Poseidon
 * over BLS12-381; a pure-JS Poseidon (e.g. circomlibjs, which is BN254) would
 * silently mismatch and make proofs fail. So we hash the JS side with the same
 * wasm the circuit uses, via circom's witness calculator: the hash is the single
 * output signal (witness index 1, after the constant 1).
 *
 * Works in the browser (fetch the wasm from the hosted bundle) and in Node (file
 * path). Node builtins are loaded lazily so importing this module stays safe in a
 * browser bundle.
 */
export interface PoseidonArtifacts {
  /** poseidon2.wasm (2 inputs), poseidon3.wasm (3), poseidon4.wasm (4). Path or URL. */
  p2: string;
  p3: string;
  p4: string;
}

export interface Poseidon {
  p2(a: bigint, b: bigint): Promise<bigint>;
  p3(a: bigint, b: bigint, c: bigint): Promise<bigint>;
  p4(a: bigint, b: bigint, c: bigint, d: bigint): Promise<bigint>;
}

interface WitnessCalculator {
  calculateWitness(
    input: Record<string, unknown>,
    sanityCheck?: number | boolean,
  ): Promise<Array<string | bigint>>;
}

async function loadWasm(src: string): Promise<Uint8Array> {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`poseidon wasm fetch failed ${res.status}: ${src}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  const fs = await import('node:fs/promises');
  return new Uint8Array(await fs.readFile(src));
}

/** Build a Poseidon oracle from the three compiled poseidon wasm (paths or URLs). */
export async function makePoseidon(art: PoseidonArtifacts): Promise<Poseidon> {
  const { WitnessCalculatorBuilder } = await import('circom_runtime');
  const [w2, w3, w4] = await Promise.all([loadWasm(art.p2), loadWasm(art.p3), loadWasm(art.p4)]);
  const [c2, c3, c4] = (await Promise.all([
    WitnessCalculatorBuilder(w2),
    WitnessCalculatorBuilder(w3),
    WitnessCalculatorBuilder(w4),
  ])) as [WitnessCalculator, WitnessCalculator, WitnessCalculator];

  async function out(wc: WitnessCalculator, inputs: bigint[]): Promise<bigint> {
    const names = ['a', 'b', 'c', 'd'];
    const input: Record<string, string> = {};
    inputs.forEach((v, i) => (input[names[i]] = v.toString()));
    const w = await wc.calculateWitness(input, 0);
    return BigInt(w[1]);
  }

  return {
    p2: (a, b) => out(c2, [a, b]),
    p3: (a, b, c) => out(c3, [a, b, c]),
    p4: (a, b, c, d) => out(c4, [a, b, c, d]),
  };
}
