import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ReviewsService } from './reviews.service.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../auth/validate.js';
import type { AuthUser } from '../auth/types.js';

const createSchema = z.object({
  serviceId: z.string().min(1),
  taskId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  text: z.string().max(2000).optional(),
});

const respondSchema = z.object({ response: z.string().min(1).max(2000) });
const flagSchema = z.object({ reason: z.string().max(500).optional() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
const mineQuery = z.object({ taskId: z.string().min(1), serviceId: z.string().min(1) });

/**
 * Service reviews: buyers review a settled hire, providers respond, either party can
 * flag abuse. Public listing is open; writes require auth (JWT or API key).
 */
@Controller('reviews')
@UseGuards(ApiAuthGuard)
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** Leave a review for a settled hire (one per hire). */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.reviews.create(user.userId, parseBody(createSchema, body));
  }

  /** The caller's own review for a given hire (null if not yet reviewed). */
  @Get('mine')
  mine(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const { taskId, serviceId } = parseBody(mineQuery, query);
    return this.reviews.mineForTask(user.userId, taskId, serviceId);
  }

  /** Provider posts a single response to a review of their service. */
  @Post(':id/respond')
  respond(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const { response } = parseBody(respondSchema, body);
    return this.reviews.respond(user.userId, id, response);
  }

  /** Flag a review or its response as abusive (author or provider only). */
  @Post(':id/flag')
  flag(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parseBody(flagSchema, body);
    return this.reviews.flag(user.userId, id, reason);
  }
}

/** Public, unauthenticated listing of a service's reviews (its own route group). */
@Controller('services/:serviceId/reviews')
export class ServiceReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(@Param('serviceId') serviceId: string, @Query() query: unknown) {
    const { limit, offset } = parseBody(listQuery, query);
    return this.reviews.listForService(serviceId, limit, offset);
  }
}
