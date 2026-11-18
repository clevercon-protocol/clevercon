/**
 * Resolve the pp/2 proving artifacts (`policy_batch.wasm` + the proving
 * `.zkey`) to local file paths for snarkjs. An agent/owner can point at local
 * files, or at URLs that are downloaded once and cached on disk. Node-only (fs /
 * https via dynamic import) so importing this module never pulls Node builtins
 * into a browser bundle; the browser (dapp) fetches artifacts itself and hands
 * snarkjs the bytes directly.
 */

import { DEFAULT_ARTIFACT_BASE_URL } from './artifacts-base.js';

export { DEFAULT_ARTIFACT_BASE_URL };

/** Where the circuit artifacts live: local paths, or URLs to download + cache. */
export interface ArtifactSource {
  wasmPath?: string;
  zkeyPath?: string;
  wasmUrl?: string;
  zkeyUrl?: string;
  /** Cache dir for downloads (default: `<os.tmpdir>/clevercon-pp2`). */
  cacheDir?: string;
}

async function exists(p: string): Promise<boolean> {
  const fs = await import('node:fs/promises');
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url: string, dest: string): Promise<void> {
  const fs = await import('node:fs');
  const { pipeline } = await import('node:stream/promises');
  const { Readable } = await import('node:stream');
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed ${res.status}: ${url}`);
  // Stream to a temp file then rename, so a partial download never looks cached.
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(tmp));
  await (await import('node:fs/promises')).rename(tmp, dest);
}

async function resolveOne(
  localPath: string | undefined,
  url: string | undefined,
  cacheName: string,
  cacheDir: string,
): Promise<string> {
  if (localPath) {
    if (!(await exists(localPath))) throw new Error(`artifact not found: ${localPath}`);
    return localPath;
  }
  const effectiveUrl = url || `${DEFAULT_ARTIFACT_BASE_URL}/${cacheName}`;
  const path = await import('node:path');
  const fs = await import('node:fs/promises');
  await fs.mkdir(cacheDir, { recursive: true });
  const dest = path.join(cacheDir, cacheName);
  if (!(await exists(dest))) await download(effectiveUrl, dest);
  return dest;
}

/**
 * Return concrete `{ wasmPath, zkeyPath }` for {@link createBatchProof}, honoring
 * local paths first and downloading+caching URLs otherwise. Env fallbacks:
 * `CLEVERCON_PP2_WASM` / `CLEVERCON_PP2_ZKEY` (paths) and
 * `CLEVERCON_PP2_WASM_URL` / `CLEVERCON_PP2_ZKEY_URL` (urls).
 */
export async function resolveArtifacts(
  src: ArtifactSource = {},
): Promise<{ wasmPath: string; zkeyPath: string }> {
  const os = await import('node:os');
  const path = await import('node:path');
  const env = (k: string) => process.env[k] || undefined;
  const cacheDir = src.cacheDir || path.join(os.tmpdir(), 'clevercon-pp2');
  const wasmPath = await resolveOne(
    src.wasmPath || env('CLEVERCON_PP2_WASM'),
    src.wasmUrl || env('CLEVERCON_PP2_WASM_URL'),
    'policy_batch.wasm',
    cacheDir,
  );
  const zkeyPath = await resolveOne(
    src.zkeyPath || env('CLEVERCON_PP2_ZKEY'),
    src.zkeyUrl || env('CLEVERCON_PP2_ZKEY_URL'),
    'policy_batch_final.zkey',
    cacheDir,
  );
  return { wasmPath, zkeyPath };
}
