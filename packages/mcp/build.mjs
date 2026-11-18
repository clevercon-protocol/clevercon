import { build } from 'esbuild';
import { chmodSync } from 'node:fs';

/**
 * Bundle the MCP server into self-contained dist files so `npx -y @clevercon/mcp`
 * installs in a blink instead of pulling the full dependency tree (the heavy
 * x402/mpp/express chain that @clevercon/agent-sdk drags in is never imported by the
 * server, so esbuild tree-shakes it away). Only the prover's native/wasm-adjacent deps
 * stay external, so they remain the package's single install cost.
 *
 * ESM output needs a createRequire shim because a couple of bundled CommonJS deps use
 * require() at runtime; without it the bundle throws "Dynamic require is not supported".
 */
const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  // Keep the prover's heavy deps external (snarkjs pulls wasm + workers that do not
  // bundle cleanly); they install as the package's only runtime dependencies.
  external: ['snarkjs', '@stellar/stellar-sdk', 'ffjavascript', 'circom_runtime'],
  banner: {
    js: "import { createRequire as __cleverconRequire } from 'module'; const require = __cleverconRequire(import.meta.url);",
  },
  logLevel: 'info',
};

// The CLI entry (the npx / bin shim target) and the library entry (package main).
await build({ ...common, entryPoints: ['src/bin.ts'], outfile: 'dist/bin.js' });
await build({ ...common, entryPoints: ['src/server.ts'], outfile: 'dist/server.js' });
chmodSync('dist/bin.js', 0o755);
