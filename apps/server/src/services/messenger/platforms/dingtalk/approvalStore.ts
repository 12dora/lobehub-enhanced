import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import {
  DINGTALK_PENDING_APPROVAL_KEY_PREFIX,
  DINGTALK_PENDING_APPROVAL_THREAD_KEY_PREFIX,
  DINGTALK_PENDING_APPROVAL_TTL_SECONDS,
} from './const';

const log = debug('lobe-server:messenger:dingtalk:approval');

export type DingTalkApprovalStatus = 'pending' | 'resuming' | 'approved' | 'rejected' | 'expired';

/** Terminal outcome stored while `status` is `resuming`, then written on finalize. */
export type DingTalkApprovalDecision = 'approved' | 'rejected' | 'expired';

export interface DingTalkApprovalBotContext {
  applicationId: string;
  isOwner: boolean;
  messengerInstallationKey?: string;
  platform: 'dingtalk';
  platformThreadId: string;
  senderExternalUserId: string;
}

export interface DingTalkPendingApproval {
  agentId: string;
  /**
   * False when 批准 must not be applied from the card: the body was shortened,
   * or the operation could not be resolved. The imported template still shows
   * both buttons; the server ignores agree/approve. Absent means 批准 is honored.
   */
  approveOnCard?: boolean;
  askerStaffId: string;
  botContext: DingTalkApprovalBotContext;
  /**
   * Frozen card body. Name lookup runs once before send; click, timeout, and
   * re-arm reuse this string and must not call the preview again.
   */
  cardContent: string;
  /** Frozen card title. Same lifetime as `cardContent`. */
  cardTitle: string;
  conversationId: string;
  /** `'1'` DM, `'2'` group. */
  conversationType: string;
  /** Intended outcome while `status` is `resuming`. */
  decision?: DingTalkApprovalDecision;
  expiresAt: number;
  operationId: string;
  outTrackId: string;
  parentMessageId: string;
  /** Epoch ms when the record entered `resuming`. */
  resumingAt?: number;
  robotCode: string;
  /** Other approval tool rows parked in the same turn. */
  siblings: Array<{ parentMessageId: string; toolCallId: string }>;
  status: DingTalkApprovalStatus;
  threadId: string;
  toolCallId: string;
  topicId: string;
  userId: string;
  /** Topic deep link shown when the card cannot fit every submitted value. */
  webLink?: string;
  workspaceId?: string;
}

const dataKey = (outTrackId: string): string =>
  `${DINGTALK_PENDING_APPROVAL_KEY_PREFIX}${outTrackId}`;

const threadIndexKey = (threadId: string): string =>
  `${DINGTALK_PENDING_APPROVAL_THREAD_KEY_PREFIX}${threadId}`;

const lockKey = (outTrackId: string): string =>
  `${DINGTALK_PENDING_APPROVAL_KEY_PREFIX}lock:${outTrackId}`;

const noticeKey = (kind: string, outTrackId: string, staffId: string): string =>
  `${DINGTALK_PENDING_APPROVAL_KEY_PREFIX}notice:${kind}:${outTrackId}:${staffId}`;

const parseRecord = (raw: string | null): DingTalkPendingApproval | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DingTalkPendingApproval;
    if (!parsed?.outTrackId || !parsed.toolCallId || !parsed.parentMessageId) return null;
    return parsed;
  } catch (error) {
    log('parse pending approval failed: %O', error);
    return null;
  }
};

export const saveDingTalkPendingApproval = async (
  record: DingTalkPendingApproval,
): Promise<boolean> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return false;
  try {
    await redis.set(
      dataKey(record.outTrackId),
      JSON.stringify(record),
      'EX',
      DINGTALK_PENDING_APPROVAL_TTL_SECONDS,
    );
    await redis.set(
      threadIndexKey(record.threadId),
      record.outTrackId,
      'EX',
      DINGTALK_PENDING_APPROVAL_TTL_SECONDS,
    );
    return true;
  } catch (error) {
    log('saveDingTalkPendingApproval failed: %O', error);
    return false;
  }
};

export const loadDingTalkPendingApproval = async (
  outTrackId: string,
): Promise<DingTalkPendingApproval | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis || !outTrackId) return null;
  try {
    return parseRecord(await redis.get(dataKey(outTrackId)));
  } catch (error) {
    log('loadDingTalkPendingApproval failed: %O', error);
    return null;
  }
};

export const loadDingTalkPendingApprovalByThread = async (
  threadId: string,
): Promise<DingTalkPendingApproval | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis || !threadId) return null;
  try {
    const outTrackId = await redis.get(threadIndexKey(threadId));
    if (!outTrackId) return null;
    return loadDingTalkPendingApproval(outTrackId);
  } catch (error) {
    log('loadDingTalkPendingApprovalByThread failed: %O', error);
    return null;
  }
};

export type DingTalkApprovalClaim =
  | { outcome: 'claimed'; record: DingTalkPendingApproval }
  | { outcome: 'missing' }
  | { outcome: 'stale' };

const transitionPending = async (
  outTrackId: string,
  apply: (record: DingTalkPendingApproval) => DingTalkPendingApproval,
  deleteThreadIndex: boolean,
): Promise<DingTalkApprovalClaim> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return { outcome: 'missing' };
  const locked = await redis.set(lockKey(outTrackId), '1', 'EX', 30, 'NX');
  if (locked !== 'OK') return { outcome: 'stale' };
  try {
    const record = parseRecord(await redis.get(dataKey(outTrackId)));
    if (!record || record.status !== 'pending') return { outcome: record ? 'stale' : 'missing' };
    const next = apply(record);
    await redis.set(
      dataKey(outTrackId),
      JSON.stringify(next),
      'EX',
      DINGTALK_PENDING_APPROVAL_TTL_SECONDS,
    );
    if (deleteThreadIndex) await redis.del(threadIndexKey(record.threadId));
    return { outcome: 'claimed', record: next };
  } catch (error) {
    log('transition pending approval failed: %O', error);
    return { outcome: 'missing' };
  } finally {
    try {
      await redis.del(lockKey(outTrackId));
    } catch {
      // The 30s lock expires on its own. A late second click still sees status.
    }
  }
};

/**
 * Single-winner transition from `pending` to `resuming`. The thread index
 * stays until resume is accepted, so a crash can still find the card.
 * A click after `expiresAt` stores `decision: 'expired'`. A second click
 * loses the lock or sees a non-pending status and must not update the card.
 */
export const claimDingTalkPendingApproval = async (
  outTrackId: string,
  next: DingTalkApprovalDecision,
  now = Date.now(),
): Promise<DingTalkApprovalClaim> =>
  transitionPending(
    outTrackId,
    (record) => ({
      ...record,
      decision: record.expiresAt <= now ? 'expired' : next,
      resumingAt: now,
      status: 'resuming',
    }),
    false,
  );

/**
 * Terminal write used when the card was never delivered (send failed).
 * Does not enter `resuming` and does not resume the agent.
 */
export const sealDingTalkPendingApproval = async (
  outTrackId: string,
  next: DingTalkApprovalDecision,
  now = Date.now(),
): Promise<DingTalkApprovalClaim> =>
  transitionPending(
    outTrackId,
    (record) => {
      const decision = record.expiresAt <= now ? 'expired' : next;
      const rest = { ...record };
      delete rest.resumingAt;
      return { ...rest, decision, status: decision };
    },
    true,
  );

/**
 * Persist the terminal status and drop the thread index. Call only after
 * resume was accepted, or after startup reconcile sees the tool row already
 * resolved. No DingTalk call.
 */
export const finalizeDingTalkPendingApproval = async (
  record: DingTalkPendingApproval,
): Promise<void> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  const status = record.decision ?? record.status;
  if (status === 'pending' || status === 'resuming') return;
  const stored: DingTalkPendingApproval = { ...record, status };
  try {
    await redis.set(
      dataKey(record.outTrackId),
      JSON.stringify(stored),
      'EX',
      DINGTALK_PENDING_APPROVAL_TTL_SECONDS,
    );
    await redis.del(threadIndexKey(record.threadId));
  } catch (error) {
    log('finalizeDingTalkPendingApproval failed: %O', error);
  }
};

/** Put a claimed record back to pending when resume did not apply. No card call. */
export const revertDingTalkPendingApproval = async (
  record: DingTalkPendingApproval,
): Promise<void> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  const rest = { ...record };
  delete rest.decision;
  delete rest.resumingAt;
  const restored: DingTalkPendingApproval = { ...rest, status: 'pending' };
  try {
    await redis.set(
      dataKey(record.outTrackId),
      JSON.stringify(restored),
      'EX',
      DINGTALK_PENDING_APPROVAL_TTL_SECONDS,
    );
    await redis.set(
      threadIndexKey(record.threadId),
      record.outTrackId,
      'EX',
      DINGTALK_PENDING_APPROVAL_TTL_SECONDS,
    );
  } catch (error) {
    log('revertDingTalkPendingApproval failed: %O', error);
  }
};

/**
 * One billed notice per (card, clicker, kind) for the life of the card key.
 * Returns true the first time. Redis errors allow the send (the click still
 * has to be answered); a duplicate key does not.
 */
export const claimDingTalkApprovalNotice = async (
  kind: 'not-asker' | 'web-only',
  outTrackId: string,
  staffId: string,
): Promise<boolean> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis || !outTrackId || !staffId) return true;
  try {
    const locked = await redis.set(
      noticeKey(kind, outTrackId, staffId),
      '1',
      'EX',
      DINGTALK_PENDING_APPROVAL_TTL_SECONDS,
      'NX',
    );
    return locked === 'OK';
  } catch (error) {
    log('claimDingTalkApprovalNotice failed: %O', error);
    return true;
  }
};
