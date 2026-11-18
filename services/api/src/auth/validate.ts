import { BadRequestException } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/** Parse a request body with zod, throwing a 400 (not a 500) on failure. */
export function parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException(
      result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
    );
  }
  return result.data;
}
