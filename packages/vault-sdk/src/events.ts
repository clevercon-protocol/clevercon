/**
 * Event subscription helper over Soroban RPC `getEvents`.
 *
 * Provides typed payloads for each vault event and handles cursor
 * management, gaps, and duplicate detection.
 */

import { rpc as SorobanRpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import type {
  VaultEvent,
  DepositEventPayload,
  WithdrawEventPayload,
  RegOrchEventPayload,
  UpdateOrchEventPayload,
  TaskNewEventPayload,
  ReleaseEventPayload,
  TaskDoneEventPayload,
  PauseEventPayload,
  UnpauseEventPayload,
  UpdateAdminEventPayload,
  DisputeRaisedEventPayload,
  DisputeResolvedEventPayload,
  FeeSetEventPayload,
  FeeAccruedEventPayload,
  FeeClaimedEventPayload,
} from './types.js';

/** Event topic → type name mapping. */
const EVENT_TOPIC_MAP: Record<string, VaultEvent['type']> = {
  deposit: 'deposit',
  withdraw: 'withdraw',
  reg_orch: 'reg_orch',
  update_orch: 'update_orch',
  task_new: 'task_new',
  release: 'release',
  task_done: 'task_done',
  pause: 'pause',
  unpause: 'unpause',
  update_admin: 'update_admin',
  dispute_raised: 'dispute_raised',
  dispute_resolved: 'dispute_resolved',
  fee_set: 'fee_set',
  fee_accrued: 'fee_accrued',
  fee_claimed: 'fee_claimed',
};

function parseEventPayload(
  eventType: string,
  data: xdr.ScVal,
): VaultEvent | null {
  try {
    const native = scValToNative(data) as any;
    switch (eventType) {
      case 'deposit':
        return { type: 'deposit', payload: { user: String(native.user), asset: String(native.asset), amount: BigInt(native.amount) } as DepositEventPayload };
      case 'withdraw':
        return { type: 'withdraw', payload: { user: String(native.user), asset: String(native.asset), amount: BigInt(native.amount) } as WithdrawEventPayload };
      case 'reg_orch':
        return { type: 'reg_orch', payload: { user: String(native.user), orchestrator: String(native.orchestrator) } as RegOrchEventPayload };
      case 'update_orch':
        return { type: 'update_orch', payload: { user: String(native.user), old_orchestrator: String(native.old_orchestrator), new_orchestrator: String(native.new_orchestrator) } as UpdateOrchEventPayload };
      case 'task_new':
        return { type: 'task_new', payload: { user: String(native.user), orchestrator: String(native.orchestrator), task_id: BigInt(native.task_id), asset: String(native.asset), plan_cost: BigInt(native.plan_cost) } as TaskNewEventPayload };
      case 'release':
        return { type: 'release', payload: { user: String(native.user), orchestrator: String(native.orchestrator), task_id: BigInt(native.task_id), asset: String(native.asset), amount: BigInt(native.amount) } as ReleaseEventPayload };
      case 'task_done':
        return { type: 'task_done', payload: { user: String(native.user), task_id: BigInt(native.task_id), asset: String(native.asset), spent: BigInt(native.spent), refund: BigInt(native.refund) } as TaskDoneEventPayload };
      case 'pause':
        return { type: 'pause', payload: { admin: String(native.admin) } as PauseEventPayload };
      case 'unpause':
        return { type: 'unpause', payload: { admin: String(native.admin) } as UnpauseEventPayload };
      case 'update_admin':
        return { type: 'update_admin', payload: { old_admin: String(native.old_admin), new_admin: String(native.new_admin) } as UpdateAdminEventPayload };
      case 'dispute_raised':
        return { type: 'dispute_raised', payload: { user: String(native.user), task_id: BigInt(native.task_id) } as DisputeRaisedEventPayload };
      case 'dispute_resolved':
        return { type: 'dispute_resolved', payload: { resolver: String(native.resolver), task_id: BigInt(native.task_id), refund_to_user: BigInt(native.refund_to_user), payout_to_orchestrator: BigInt(native.payout_to_orchestrator) } as DisputeResolvedEventPayload };
      case 'fee_set':
        return { type: 'fee_set', payload: { admin: String(native.admin), bps: Number(native.bps), recipient: native.recipient ? String(native.recipient) : null } as FeeSetEventPayload };
      case 'fee_accrued':
        return { type: 'fee_accrued', payload: { asset: String(native.asset), recipient: String(native.recipient), fee_amount: BigInt(native.fee_amount), task_id: BigInt(native.task_id) } as FeeAccruedEventPayload };
      case 'fee_claimed':
        return { type: 'fee_claimed', payload: { asset: String(native.asset), recipient: String(native.recipient), amount: BigInt(native.amount) } as FeeClaimedEventPayload };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Extract the event topic name string from an ScVal.
 * Uses scValToNative for symbols/strings.
 */
function extractTopicName(topicVal: xdr.ScVal): string | null {
  try {
    return String(scValToNative(topicVal));
  } catch {
    return null;
  }
}

export interface EventSubscriptionOptions {
  /** RPC server URL. */
  rpcUrl: string;
  /** Contract ID to filter events. */
  contractId: string;
  /** Optional: filter to specific event topic(s). */
  topics?: string[];
  /** Polling interval in ms. Default: 5000. */
  pollIntervalMs?: number;
}

export interface EventSubscription {
  /** Stop polling and close the subscription. */
  stop(): void;
  /** Get the current cursor (for resuming later). */
  getCursor(): string | undefined;
}

/**
 * Subscribe to vault events with typed payloads.
 *
 * Handles cursor management: the cursor is advanced after each successful
 * poll. Cursor gaps (e.g. if the RPC skipped ledgers) and duplicates
 * (e.g. from reconnection) are handled by deduplicating on event txHash.
 *
 * @param callback Called for each parsed vault event.
 * @returns An `EventSubscription` handle to stop polling.
 */
export function subscribeEvents(
  options: EventSubscriptionOptions,
  callback: (event: VaultEvent) => void,
): EventSubscription {
  const server = new SorobanRpc.Server(options.rpcUrl, { allowHttp: false });
  let cursor: string | undefined;
  let stopped = false;
  const seen = new Set<string>();

  const poll = async () => {
    while (!stopped) {
      try {
        const request: SorobanRpc.Api.GetEventsRequest = cursor
          ? {
              filters: [{ type: 'contract', contractIds: [options.contractId] }],
              cursor,
              limit: 100,
            }
          : {
              filters: [{ type: 'contract', contractIds: [options.contractId] }],
              startLedger: 1,
              limit: 100,
            };

        const response = await server.getEvents(request);

        for (const event of response.events) {
          const txHash = event.id ?? '';
          if (seen.has(txHash)) continue;
          seen.add(txHash);

          // Extract event type from topics (singular — EventResponse.topic)
          const topics = event.topic;
          if (!topics || topics.length === 0) continue;

          const topicStr = extractTopicName(topics[0]);
          if (!topicStr) continue;

          const eventType = EVENT_TOPIC_MAP[topicStr];
          if (!eventType) continue;

          if (options.topics && !options.topics.includes(topicStr)) continue;

          const parsed = parseEventPayload(topicStr, event.value);
          if (parsed) {
            callback(parsed);
          }
        }

        if (response.cursor) {
          cursor = response.cursor;
        }
      } catch {
        // RPC hiccup — retry on next interval
      }

      if (!stopped) {
        await new Promise((r) => setTimeout(r, options.pollIntervalMs ?? 5000));
      }
    }
  };

  poll();

  return {
    stop() {
      stopped = true;
    },
    getCursor() {
      return cursor;
    },
  };
}

/**
 * Fetch a single page of events (non-streaming).
 * Useful for initial data load or one-shot queries.
 */
export async function fetchEvents(
  rpcUrl: string,
  contractId: string,
  options?: { cursor?: string; limit?: number; topics?: string[] },
): Promise<{ events: VaultEvent[]; cursor?: string }> {
  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });

  const request: SorobanRpc.Api.GetEventsRequest = options?.cursor
    ? {
        filters: [{ type: 'contract', contractIds: [contractId] }],
        cursor: options.cursor,
        limit: options?.limit ?? 100,
      }
    : {
        filters: [{ type: 'contract', contractIds: [contractId] }],
        startLedger: 1,
        limit: options?.limit ?? 100,
      };

  const response = await server.getEvents(request);

  const events: VaultEvent[] = [];
  for (const event of response.events) {
    const topics = event.topic;
    if (!topics || topics.length === 0) continue;

    const topicStr = extractTopicName(topics[0]);
    if (!topicStr) continue;

    const eventType = EVENT_TOPIC_MAP[topicStr];
    if (!eventType) continue;
    if (options?.topics && !options.topics.includes(topicStr)) continue;

    const parsed = parseEventPayload(topicStr, event.value);
    if (parsed) {
      events.push(parsed);
    }
  }

  return { events, cursor: response.cursor };
}
