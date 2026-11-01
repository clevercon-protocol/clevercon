import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { PricingModel } from '@clevercon/db';
import { ProviderService } from './provider.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../auth/validate.js';
import type { AuthUser } from '../auth/types.js';

const jsonSchemaObj = z.record(z.unknown());
const verificationSchema = z.object({
  method: z.enum(['onchain', 'witness', 'content-hash', 'signature', 'attest', 'manual']),
  spec: z.record(z.unknown()).optional(),
});

// Interaction/payment shape (marketplace v2). Absent = sync/escrow (back-compat).
const interactionSchema = z.enum(['sync', 'async', 'human', 'metered']);
const paymentModelSchema = z.enum(['escrow', 'x402', 'mpp-session', 'subscription']);
const attachmentSpecSchema = z.object({
  required: z.boolean().optional(),
  accept: z.array(z.string().max(120)).max(20).optional(),
  maxSizeBytes: z.number().int().positive().optional(),
  maxCount: z.number().int().positive().max(20).optional(),
});

// Methods valid for each tier: T1 is trustless, T2 is attested (schema + dispute),
// T3 is human/milestone. A manifest whose method does not match its tier is rejected.
const TIER_METHODS: Record<string, string[]> = {
  T1: ['onchain', 'witness', 'content-hash', 'signature'],
  T2: ['attest'],
  T3: ['manual'],
};

const registerSchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().min(1).max(2000),
    category: z.string().max(120).optional(),
    capabilities: z.array(z.string().max(60)).max(20).optional(),
    pricingModel: z.nativeEnum(PricingModel),
    pricePerCall: z.number().nonnegative(),
    endpoint: z.string().url(),
    stellarAddress: z.string().min(1).max(120),
    // Acceptance contract (optional for back-compat; see MARKETPLACE-ECONOMY-SPEC.md).
    tier: z.enum(['T1', 'T2', 'T3']).optional(),
    inputSchema: jsonSchemaObj.optional(),
    outputSchema: jsonSchemaObj.optional(),
    verification: verificationSchema.optional(),
    interaction: interactionSchema.optional(),
    paymentModel: paymentModelSchema.optional(),
    attachmentsIn: attachmentSpecSchema.optional(),
    // Required only when the payout address is not the caller's own wallet: a
    // signature by that address's key over a challenge from GET /payout-challenge.
    payoutProof: z.object({ challenge: z.string(), signature: z.string() }).optional(),
  })
  .refine(
    (o) => !o.tier || !o.verification || TIER_METHODS[o.tier].includes(o.verification.method),
    { message: 'verification.method must match the tier (T1 trustless / T2 attest / T3 manual)' },
  );

const updateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().min(1).max(2000).optional(),
    category: z.string().max(120).optional(),
    capabilities: z.array(z.string().max(60)).max(20).optional(),
    pricePerCall: z.number().nonnegative().optional(),
    endpoint: z.string().url().optional(),
    stellarAddress: z.string().min(1).max(120).optional(),
    interaction: interactionSchema.optional(),
    paymentModel: paymentModelSchema.optional(),
    attachmentsIn: attachmentSpecSchema.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'No fields to update' });

const statusSchema = z.object({ active: z.boolean() });

/** Provider-scoped views: the caller's own services and earnings. */
@Controller('provider')
@UseGuards(JwtAuthGuard)
export class ProviderController {
  constructor(private readonly provider: ProviderService) {}

  /**
   * A short-lived challenge to prove control of a payout address: sign the
   * returned string with that address's key and pass it as `payoutProof` to
   * register, when the payout address is not your own wallet.
   */
  @Get('payout-challenge')
  payoutChallenge(@CurrentUser() user: AuthUser) {
    return { challenge: this.provider.payoutChallenge(user.userId) };
  }

  /** Register a service (self-serve); grants the caller the PROVIDER role. */
  @Post('services')
  register(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.provider.registerService(user.userId, parseBody(registerSchema, body));
  }

  @Get('services')
  services(@CurrentUser() user: AuthUser) {
    return this.provider.listServices(user.userId);
  }

  /** Edit a service the caller owns. */
  @Patch('services/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.provider.updateService(user.userId, id, parseBody(updateSchema, body));
  }

  /** Pause or resume a service the caller owns. */
  @Post('services/:id/status')
  setStatus(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const { active } = parseBody(statusSchema, body);
    return this.provider.setServiceStatus(user.userId, id, active);
  }

  /** Task steps routed to the caller's services (real incoming work). */
  @Get('jobs')
  jobs(@CurrentUser() user: AuthUser) {
    return this.provider.jobs(user.userId);
  }

  @Get('earnings')
  earnings(@CurrentUser() user: AuthUser) {
    return this.provider.earnings(user.userId);
  }

  /** The provider's full payout ledger (for the payouts view + CSV export). */
  @Get('payouts')
  payouts(@CurrentUser() user: AuthUser) {
    return this.provider.payouts(user.userId);
  }
}
