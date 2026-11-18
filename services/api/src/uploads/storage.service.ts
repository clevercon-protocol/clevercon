import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'node:crypto';

/**
 * Cloudflare R2 object storage via S3-compatible presigned URLs (AWS SigV4,
 * dependency-free). The API never touches the bytes: it hands the client a
 * short-lived presigned PUT so uploads go straight to R2, and resolves downloads
 * to a stable public URL (public bucket) or a presigned GET (private bucket).
 *
 * Content integrity is the ArtifactRef's sha256, checked by the worker/buyer
 * (the T1 `content-hash` method), so a public URL is still tamper-evident.
 *
 * Disabled (enabled() === false) until the R2 env is set, so the app runs
 * normally without a bucket; the uploads endpoints then return 503.
 */
@Injectable()
export class StorageService {
  private get cfg() {
    return {
      accountId: process.env.R2_ACCOUNT_ID ?? '',
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
      bucket: process.env.R2_BUCKET ?? '',
      // The bucket's public base URL (R2.dev or a custom domain), no trailing slash.
      publicBaseUrl: (process.env.R2_PUBLIC_BASE_URL ?? '').replace(/\/+$/, ''),
    };
  }

  /** True when R2 is configured enough to presign uploads. */
  enabled(): boolean {
    const c = this.cfg;
    return !!(c.accountId && c.accessKeyId && c.secretKey && c.bucket);
  }

  /** Whether downloads resolve to stable public URLs (public bucket). */
  hasPublicUrls(): boolean {
    return !!this.cfg.publicBaseUrl;
  }

  /** A unique, path-safe object key namespaced to the uploader. */
  objectKey(userId: string, filename: string): string {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'file';
    return `uploads/${userId}/${randomUUID()}-${safe}`;
  }

  /** The stable public URL for a key, when the bucket is public (else null). */
  publicUrl(key: string): string | null {
    const c = this.cfg;
    return c.publicBaseUrl ? `${c.publicBaseUrl}/${encodeKeyPath(key)}` : null;
  }

  /** A presigned PUT URL: the client uploads the bytes directly to R2. */
  presignPut(key: string, expiresSec = 300, now = new Date()): string {
    return this.presign('PUT', key, expiresSec, now);
  }

  /** A presigned GET URL for a private bucket (short-lived download link). */
  presignGet(key: string, expiresSec = 300, now = new Date()): string {
    return this.presign('GET', key, expiresSec, now);
  }

  /** AWS SigV4 query-string (presigned URL) signing for R2 (region "auto"). */
  private presign(method: 'GET' | 'PUT', key: string, expiresSec: number, now: Date): string {
    const c = this.cfg;
    const host = `${c.accountId}.r2.cloudflarestorage.com`;
    const region = 'auto';
    const service = 's3';
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${region}/${service}/aws4_request`;
    const canonicalUri = `/${c.bucket}/${encodeKeyPath(key)}`;
    const signedHeaders = 'host';

    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${c.accessKeyId}/${scope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresSec),
      'X-Amz-SignedHeaders': signedHeaders,
    };
    const canonicalQuery = Object.keys(query)
      .sort()
      .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(query[k])}`)
      .join('&');

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      `host:${host}\n`,
      signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join(
      '\n',
    );

    const kDate = hmac(`AWS4${c.secretKey}`, dateStamp);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, service);
    const kSigning = hmac(kService, 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

    return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/** RFC 3986 encoding (encodeURIComponent plus the four chars it leaves out). */
function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Encode each path segment but keep the slashes (S3 canonical URI). */
function encodeKeyPath(key: string): string {
  return key.split('/').map(encodeRfc3986).join('/');
}
