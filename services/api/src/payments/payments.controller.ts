import { Controller, GoneException, Post } from '@nestjs/common';

/**
 * RETIRED: the pp/1 binding server-path (`pay`/`disburse`). The policy verifier now
 * carries only the pp/2 batch verifying key, so the server can no longer build a
 * binding proof that verifies on-chain. Self-custody private spend goes through the
 * client-proven pp/2 path (`POST /vault/batch-release-proved`, SDK `disbursePrivate`),
 * where the rule is proven locally and only the proof is relayed. Managed/session-key
 * spend returns in a later release.
 *
 * Kept as a 410 (unguarded, so every caller gets the same clear signal) rather than
 * deleted: `TasksService.createPayment` is preserved for the session-key revival.
 */
@Controller('payments')
export class PaymentsController {
  @Post()
  create(): never {
    throw new GoneException(
      'The managed server-path spend (POST /payments) is retired. Use the client-proven ' +
        'path: POST /vault/batch-release-proved (SDK disbursePrivate) for self-custody ' +
        'private spend. Managed/session-key spend is coming in a later release.',
    );
  }
}
