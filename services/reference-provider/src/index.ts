import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createProvider, artifactRef } from '@clevercon/agent-sdk/provider';
import type { ArtifactRef } from '@clevercon/agent-sdk';
import { SERVICE_BY_ACTION, SERVICES } from './services.js';

/**
 * The reference provider: several real, hireable services on one process, built on
 * the SDK's createProvider. The CleverCon worker POSTs a job (with its `action`)
 * to this endpoint; we dispatch to the matching service and return the standard
 * result envelope, which the worker verifies against the service's declared tier
 * before the vault pays. One endpoint, many services (see services.ts).
 *
 * Services that produce an OUTPUT file (e.g. the image tool) host the result here
 * at GET /artifact/:id and return an ArtifactRef pointing to it, so the buyer can
 * download + hash-verify it. Results are kept in memory with a short TTL.
 */
const PORT = Number(process.env.PORT ?? process.env.PROVIDER_PORT ?? 8080);
const NAME = process.env.PROVIDER_NAME ?? 'clevercon-reference-provider';
// The public base URL used in artifact download links. Prefer an explicit override,
// else Railway's injected public domain (so it is correct with no config), else the
// registered endpoint, else localhost for local runs.
const PUBLIC_URL = (
  process.env.PROVIDER_PUBLIC_URL ??
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : undefined) ??
  process.env.PROVIDER_ENDPOINT ??
  `http://localhost:${PORT}`
).replace(/\/+$/, '');

// In-memory output store: id -> bytes. Evicted after the TTL (download promptly).
const ARTIFACT_TTL_MS = 30 * 60 * 1000;
const artifacts = new Map<string, { bytes: Buffer; contentType: string; at: number }>();

function hostArtifact(bytes: Buffer, contentType: string): ArtifactRef {
  const now = Date.now();
  for (const [k, v] of artifacts) if (now - v.at > ARTIFACT_TTL_MS) artifacts.delete(k);
  const id = randomUUID();
  artifacts.set(id, { bytes, contentType, at: now });
  return artifactRef(`${PUBLIC_URL}/artifact/${id}`, bytes, contentType);
}

const provider = createProvider({
  name: NAME,
  async fulfill({ action, input, attachments }) {
    const svc = SERVICE_BY_ACTION.get(action);
    // Unknown action: fall back to the market snapshot so a bare hire still works.
    const handler = svc?.handler ?? SERVICES.find((s) => s.action === 'market.snapshot')!.handler;
    return handler({ input, attachments, hostArtifact });
  },
});

// Serve /artifact/:id from the store; delegate everything else (POST / and
// /health) to the provider's own handler.
const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url && req.url.startsWith('/artifact/')) {
    const id = req.url.slice('/artifact/'.length).split(/[?#]/)[0];
    const a = artifacts.get(id);
    if (!a) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': a.contentType, 'content-length': String(a.bytes.length) });
    res.end(a.bytes);
    return;
  }
  void provider.handle(req, res);
});

server.listen(PORT, () => {
  console.log(
    `[${NAME}] serving ${SERVICES.length} services + /artifact on :${PORT}: ${SERVICES.map((s) => s.action).join(', ')}`,
  );
});
