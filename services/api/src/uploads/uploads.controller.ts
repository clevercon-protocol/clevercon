import {
  Body,
  Controller,
  Get,
  Query,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { StorageService } from './storage.service.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../auth/validate.js';
import type { AuthUser } from '../auth/types.js';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

const presignSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(200),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  // Optional client-computed SHA-256 (hex) -> becomes the ArtifactRef hash so the
  // worker/buyer can verify integrity (the T1 content-hash method).
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
});

const downloadSchema = z.object({ key: z.string().min(1).max(512) });

/**
 * Direct-to-R2 uploads: the client asks for a presigned PUT, uploads the bytes
 * itself, and gets back an ArtifactRef to attach to a job input or result. The
 * API never proxies the bytes (scale-friendly). Requires R2 to be configured;
 * otherwise every route returns 503 so the feature degrades cleanly.
 */
@Controller('uploads')
@UseGuards(ApiAuthGuard)
export class UploadsController {
  constructor(private readonly storage: StorageService) {}

  /** Mint a presigned PUT + the ArtifactRef the caller stores on the job. */
  @Post('presign')
  presign(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    if (!this.storage.enabled()) {
      throw new ServiceUnavailableException('File storage (R2) is not configured');
    }
    const { filename, contentType, size, sha256 } = parseBody(presignSchema, body);
    const key = this.storage.objectKey(user.userId, filename);
    const uploadUrl = this.storage.presignPut(key, 300);
    // A stable public URL when the bucket is public, else a path that re-presigns
    // a short-lived GET on demand (see /uploads/download).
    const url = this.storage.publicUrl(key) ?? `/uploads/download?key=${encodeURIComponent(key)}`;
    return {
      key,
      uploadUrl,
      method: 'PUT' as const,
      // Send this content-type on the PUT so R2 stores it for later downloads.
      headers: { 'content-type': contentType },
      artifact: {
        url,
        hash: sha256 ? `sha256:${sha256.toLowerCase()}` : null,
        contentType,
        size,
      },
    };
  }

  /**
   * Resolve a private-bucket object to a short-lived presigned GET. For a public
   * bucket the ArtifactRef URL is already a direct link, so this is unused.
   */
  @Get('download')
  download(@Query() query: unknown) {
    if (!this.storage.enabled()) {
      throw new ServiceUnavailableException('File storage (R2) is not configured');
    }
    const { key } = parseBody(downloadSchema, query);
    const direct = this.storage.publicUrl(key);
    return { url: direct ?? this.storage.presignGet(key, 300) };
  }
}
