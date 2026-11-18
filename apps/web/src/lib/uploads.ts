import { apiPost } from './api';
import { isDemo } from '../config';

export interface ArtifactRef {
  url: string;
  hash: string | null;
  contentType: string;
  size: number;
}

/** A service's declared input-file constraints (from its manifest attachmentsIn). */
export interface AttachmentConstraints {
  required?: boolean;
  accept?: string[];
  maxSizeBytes?: number;
  maxCount?: number;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Validate a chosen file against a service's declared constraints BEFORE uploading,
 * so a wrong type or oversized file is rejected up front rather than after the
 * provider bounces it. Returns a human message, or null if the file is acceptable.
 * Accept patterns match the HTML `accept` forms: "image/*", "application/pdf", ".csv".
 */
export function validateAttachment(file: File, c?: AttachmentConstraints | null): string | null {
  if (!c) return null;
  if (c.maxSizeBytes && file.size > c.maxSizeBytes) {
    return `File is too large (${fmtBytes(file.size)}). Max is ${fmtBytes(c.maxSizeBytes)}.`;
  }
  const accept = (c.accept ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (accept.length) {
    const type = (file.type || '').toLowerCase();
    const name = file.name.toLowerCase();
    const ok = accept.some((pat) => {
      if (pat.endsWith('/*')) return type.startsWith(pat.slice(0, -1)); // e.g. image/*
      if (pat.startsWith('.')) return name.endsWith(pat); // extension
      if (pat.includes('/')) return type === pat; // exact MIME
      return name.endsWith(`.${pat}`); // bare extension
    });
    if (!ok) return `This service accepts: ${(c.accept ?? []).join(', ')}.`;
  }
  return null;
}

/** SHA-256 of a file (hex), computed in the browser so the ArtifactRef is verifiable. */
async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Upload a file straight to R2 via a presigned PUT and return its ArtifactRef.
 * The bytes never touch our API: we ask for a presigned URL, PUT the file to R2,
 * and hand back {url, hash, contentType, size} to attach to a job. Throws a clear
 * error if storage is not configured (the presign call returns 503).
 */
export async function uploadFile(file: File): Promise<ArtifactRef> {
  if (isDemo()) throw new Error('File upload is not available in the demo');
  const sha256 = await sha256Hex(file);
  const presigned = await apiPost<{
    uploadUrl: string;
    headers: Record<string, string>;
    artifact: ArtifactRef;
  }>('/uploads/presign', {
    filename: file.name,
    contentType: file.type || 'application/octet-stream',
    size: file.size,
    sha256,
  });
  const put = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    headers: presigned.headers,
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  return presigned.artifact;
}
