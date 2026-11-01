/**
 * upload_file: turn a LOCAL file into an ArtifactRef an agent can attach to a hire.
 *
 * MCP tool calls are JSON, so a file cannot be passed inline. The MCP server runs
 * locally (stdio), so it reads the file from disk, content-addresses it (sha256),
 * uploads the bytes straight to CleverCon storage via a presigned PUT, and returns
 * the ArtifactRef { url, hash, contentType, size }. The agent then passes that ref
 * to hire_agent as input.attachments, e.g.:
 *
 *   const { artifact } = await upload_file({ path: "/abs/report.pdf" });
 *   await hire_agent({ mode: "DIRECT", serviceId, budget,
 *                      input: { attachments: [artifact] } });
 *
 * The provider receives the file by reference and verifies the hash. Requires an
 * API key; storage must be configured on the API (else a clear 503).
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
    'Upload a LOCAL file so it can be attached to a hire for a service that accepts files ' +
    '(check get_service.attachmentsIn). Reads the file from disk, uploads it to content-addressed ' +
    'storage, and returns an ArtifactRef { url, hash, contentType, size }. Pass it to hire_agent as ' +
    'input: { attachments: [artifact] }. Requires an API key.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the local file to upload' },
      contentType: {
        type: 'string',
        description: 'Optional MIME type; inferred from the file extension if omitted',
      },
    },
    required: ['path'],
  },
};

export async function uploadFileHandler(
  args: Record<string, unknown>,
  config: ApiConfig,
): Promise<ToolResult> {
  try {
    const { path } = args;
    if (typeof path !== 'string' || path.trim() === '')
      throw new Error('path must be a non-empty string (absolute path to the file)');

    const bytes = await readFile(path.trim());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const filename = basename(path.trim());
    const contentType =
      typeof args.contentType === 'string' && args.contentType.trim()
        ? args.contentType.trim()
        : guessMime(filename);

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
