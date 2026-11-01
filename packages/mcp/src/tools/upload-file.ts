/**
 * upload_file: turn a file the agent has — in ANY form — into an ArtifactRef it can
 * attach to a hire. MCP tool calls are JSON and a client's chat-attached file is model
 * context (not passed to tools), so the agent provides the file one of four ways:
 *
 *   - path    : a LOCAL file (the MCP server runs locally over stdio and reads it)
 *   - url     : a remote file the server fetches and re-hosts
 *   - content : inline TEXT the model already has in context (e.g. a pasted/attached doc)
 *   - base64  : inline bytes (e.g. from a client resource) for a binary file
 *
 * It content-addresses the bytes (sha256), uploads them via a presigned PUT, and
 * returns the ArtifactRef { url, hash, contentType, size }. The agent then hires:
 *
 *   const { artifact } = await upload_file({ content: "...", filename: "notes.txt" });
 *   await hire_agent({ mode: "DIRECT", serviceId, budget,
 *                      input: { attachments: [artifact] } });
 *
 * The provider receives the file by reference and verifies the hash. Requires an API
 * key; storage must be configured on the API (else a clear 503).
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import {
  createApiClient,
  toolJson,
  toolError,
  type ApiConfig,
  type ToolResult,
} from '../api-client.js';

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function guessMime(filename: string): string {
  return MIME[extname(filename).toLowerCase()] ?? 'application/octet-stream';
}

export const uploadFileSchema = {
  name: 'upload_file',
  description:
    'Upload a file so it can be attached to a hire for a service that accepts files ' +
    '(check get_service.attachmentsIn). Provide the file ONE way: path (a local file), url ' +
    '(remote), content (inline text the model already has), or base64 (inline bytes). Returns an ' +
    'ArtifactRef { url, hash, contentType, size } to pass to hire_agent as input: { attachments: ' +
    '[artifact] }. NOTE: a file a user attached in the chat is model context, not a local path — ' +
    'pass its text via `content`, or ask the user for a path/URL for a binary. Requires an API key.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to a LOCAL file' },
      url: { type: 'string', description: 'URL of a remote file to fetch and re-host' },
      content: { type: 'string', description: 'Inline TEXT content (e.g. a document in context)' },
      base64: { type: 'string', description: 'Inline bytes, base64-encoded (binary files)' },
      filename: {
        type: 'string',
        description: 'File name (required for content/base64; inferred for path/url)',
      },
      contentType: {
        type: 'string',
        description: 'MIME type; inferred from the file name if omitted',
      },
    },
  },
};

/** Resolve the chosen source to { bytes, filename, contentType }. Exactly one source. */
async function resolveFile(args: Record<string, unknown>): Promise<{
  bytes: Buffer;
  filename: string;
  contentType: string;
}> {
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
  const path = str(args.path);
  const url = str(args.url);
  const content = str(args.content);
  const base64 = str(args.base64);
  const given = [path, url, content, base64].filter(Boolean);
  if (given.length === 0) throw new Error('provide one of: path, url, content, base64');
  if (given.length > 1) throw new Error('provide only ONE of: path, url, content, base64');

  const argName = str(args.filename);
  const argType = str(args.contentType);

  if (path) {
    const bytes = await readFile(path);
    const filename = argName ?? basename(path);
    return { bytes, filename, contentType: argType ?? guessMime(filename) };
  }
  if (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`could not fetch url (HTTP ${res.status})`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const fromUrl = basename(new URL(url).pathname) || 'download';
    const filename = argName ?? fromUrl;
    const contentType = argType ?? res.headers.get('content-type')?.split(';')[0] ?? guessMime(filename);
    return { bytes, filename, contentType };
  }
  if (content) {
    const filename = argName ?? 'document.txt';
    return { bytes: Buffer.from(content, 'utf-8'), filename, contentType: argType ?? guessMime(filename) };
  }
  // base64
  const filename = argName;
  if (!filename) throw new Error('filename is required when uploading base64 bytes');
  return { bytes: Buffer.from(base64 as string, 'base64'), filename, contentType: argType ?? guessMime(filename) };
}

export async function uploadFileHandler(
  args: Record<string, unknown>,
  config: ApiConfig,
): Promise<ToolResult> {
  try {
    const { bytes, filename, contentType } = await resolveFile(args);
    if (bytes.length === 0) throw new Error('the file is empty');
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    const client = createApiClient(config);
    const presigned = await client.post<{
      uploadUrl: string;
      headers: Record<string, string>;
      artifact: { url: string; hash: string | null; contentType: string; size: number };
    }>('/uploads/presign', { filename, contentType, size: bytes.length, sha256 });

    // PUT the bytes straight to storage (not through the CleverCon API).
    const put = await fetch(presigned.uploadUrl, {
      method: 'PUT',
      headers: presigned.headers,
      body: bytes,
    });
    if (!put.ok) throw new Error(`storage upload failed (HTTP ${put.status})`);

    return toolJson({
      artifact: presigned.artifact,
      note: 'Attach to a hire as hire_agent input: { attachments: [artifact] }.',
    });
  } catch (error) {
    return toolError('upload_file failed', error);
  }
}
