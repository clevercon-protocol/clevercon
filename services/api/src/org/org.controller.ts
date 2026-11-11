import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { OrgService, HANDLE_RE } from './org.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../auth/validate.js';
import type { AuthUser } from '../auth/types.js';

const linksSchema = z
  .object({
    website: z.string().url().optional(),
    docs: z.string().url().optional(),
    support: z.string().max(200).optional(),
    github: z.string().url().optional(),
    x: z.string().max(200).optional(),
    discord: z.string().max(200).optional(),
  })
  .optional();

const createOrgSchema = z.object({
  name: z.string().min(1).max(120),
  handle: z.string().regex(HANDLE_RE, 'Invalid handle'),
  bio: z.string().max(600).optional(),
  links: linksSchema,
});
const updateOrgSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    handle: z.string().regex(HANDLE_RE).optional(),
    bio: z.string().max(600).optional(),
    links: linksSchema,
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'No fields to update' });
const profileSchema = z
  .object({
    displayName: z.string().max(120).optional(),
    handle: z.string().regex(HANDLE_RE).optional(),
    bio: z.string().max(600).optional(),
    links: linksSchema,
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'No fields to update' });

/** Owner identity: provider profiles, organizations, and the public profile page. */
@Controller()
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Post('orgs')
  @UseGuards(JwtAuthGuard)
  createOrg(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.org.createOrg(user.userId, parseBody(createOrgSchema, body));
  }

  @Patch('orgs/:id')
  @UseGuards(JwtAuthGuard)
  updateOrg(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.org.updateOrg(user.userId, id, parseBody(updateOrgSchema, body));
  }

  @Get('orgs/mine')
  @UseGuards(JwtAuthGuard)
  myOrgs(@CurrentUser() user: AuthUser) {
    return this.org.myOrgs(user.userId);
  }

  @Get('me/profile')
  @UseGuards(JwtAuthGuard)
  myProfile(@CurrentUser() user: AuthUser) {
    return this.org.myProfile(user.userId);
  }

  @Patch('me/profile')
  @UseGuards(JwtAuthGuard)
  updateMyProfile(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.org.updateMyProfile(user.userId, parseBody(profileSchema, body));
  }

  /** Public: the owner behind a handle, with their listed services. */
  @Get('profiles/:handle')
  publicProfile(@Param('handle') handle: string) {
    return this.org.publicProfile(handle);
  }
}
