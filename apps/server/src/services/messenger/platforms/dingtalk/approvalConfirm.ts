import { randomUUID } from 'node:crypto';

import { DingtalkDocsIdentifier } from '@lobechat/builtin-tool-dingtalk-docs';
import {
  CONVERSATION_TYPE_GROUP,
  decodeDingTalkThreadId,
  DingTalkCardUnavailableError,
  fitDingTalkConfirmCardContent,
  formatDingTalkConfirmOverflowLine,
  rememberDingTalkCard,
  sendDingTalkStreamConfirmCard,
  updateDingTalkConfirmCard,
} from '@lobechat/chat-adapter-dingtalk';
import type { ChatTopicBotContext } from '@lobechat/types';
import debug from 'debug';

import { getMessengerDingTalkConfig } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import { MessageModel } from '@/database/models/message';
import {
  DINGTALK_APPROVAL_TOOL_IDENTIFIER,
  DINGTALK_PERSONAL_TOOL_IDENTIFIER,
  DINGTALK_WORKSPACE_TOOL_IDENTIFIER,
  DingtalkWorkspaceError,
} from '@/server/enterprise/services/dingtalkWorkspace/errors';
import {
  AgentBridgeService,
  type AgentWaitingForHumanEvent,
} from '@/server/services/bot/AgentBridgeService';

import {
  claimDingTalkApprovalNotice,
  claimDingTalkPendingApproval,
  type DingTalkApprovalBotContext,
  type DingTalkApprovalDecision,
  type DingTalkPendingApproval,
  finalizeDingTalkPendingApproval,
  loadDingTalkPendingApproval,
  loadDingTalkPendingApprovalByThread,
  revertDingTalkPendingApproval,
  saveDingTalkPendingApproval,
  sealDingTalkPendingApproval,
} from './approvalStore';
import { createDingTalkReplySink, sendDingTalkMarkdown } from './cards';
import {
  buildDingTalkTopicDeepLink,
  dingTalkInvalidPreviewDetail,
  type DingTalkRenderedConfirm,
  formatDingTalkAggregateBody,
  formatDingTalkAggregateTitle,
  formatDingTalkCardSendFailedContent,
  formatDingTalkConfirmSummary,
  formatDingTalkOversizedBatch,
  formatDingTalkPreviewCard,
  formatDingTalkPreviewUnavailable,
  formatDingTalkWebConfirmMarkdown,
  hasDingTalkApiLabel,
} from './confirmSummary';
import {
  DINGTALK_ASKER_ONLY_REPLY,
  DINGTALK_CONFIRM_BATCH_CAP,
  DINGTALK_CONFIRM_TIMEOUT_MS,
  DINGTALK_CONFIRM_TIMEOUT_REASON,
  DINGTALK_PENDING_APPROVAL_KEY_PREFIX,
} from './const';
import { forwardDingTalkWaitingQuestion } from './questions';
import { sharedDingTalkApiClient } from './tokenCache';

const log = debug('lobe-server:messenger:dingtalk:approval');

const apiForConfig = (config: { clientId: string; clientSecret: string; robotCode: string }) =>
  sharedDingTalkApiClient({
    appKey: config.clientId,
    appSecret: config.clientSecret,
    robotCode: config.robotCode,
  });

/** How long a click waits for the parked run to leave `activeThreads`. */
const DINGTALK_RESUME_SETTLE_MS = 10_000;
const DINGTALK_RESUME_POLL_MS = 100;
/**
 * Restart may finish an approved batch only while the claim is this fresh.
 * Older `resuming` records are interrupted instead of executing the rest.
 */
const DINGTALK_RESUME_RECONCILE_MS = 10 * 60 * 1000;
/** v1.10.1 cards showed one call. The others were rejected with this reason. */
const LEGACY_SIBLING_SKIP_REASON = '钉钉一次只能确认一项，此项已跳过。';
const INTERRUPTED_STATUS_TEXT = '已中断，未执行';

/**
 * Tests set this to `0` so a still-active thread fails the wait immediately.
 * Production leaves it unset and waits {@link DINGTALK_RESUME_SETTLE_MS}.
 */
const resolveResumeSettleMs = (): number => {
  const raw = Number(process.env.DINGTALK_CONFIRM_RESUME_SETTLE_MS);
  if (Number.isFinite(raw) && raw >= 0 && raw <= DINGTALK_RESUME_SETTLE_MS) return raw;
  return DINGTALK_RESUME_SETTLE_MS;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

const STATUS_LABEL = {
  approved: '已批准，执行中…',
  expired: '已失效（超时未确认）',
  rejected: '已拒绝',
} as const;

/** Button driver on the imported template. Pending stays `''` so both buttons show. */
const STATUS_BUTTON = {
  approved: 'agree',
  expired: 'reject',
  rejected: 'reject',
} as const;

const PENDING_STATUS_TEXT = '待确认';
const WEB_STATUS_TEXT = '请到网页端确认';
const ASKER_NOTE = '仅发起人可操作';

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export interface DingTalkWaitingContext {
  agentId: string;
  userId: string;
  workspaceId?: string;
}

export interface DingTalkWaitingOutcome {
  resumeApproval?: {
    decision: 'approved' | 'rejected' | 'rejected_continue';
    parentMessageId: string;
    rejectionReason?: string;
    toolCallId: string;
  };
  resumeHistory?: { parentMessageId: string };
}

interface ApprovalCall {
  apiName?: string;
  args: Record<string, unknown>;
  identifier?: string;
  /** `manifest.meta.title` for an unlabeled non-DingTalk tool. */
  manifestTitle?: string;
  parentMessageId: string;
  toolCallId: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const parseArgs = (raw: unknown): Record<string, unknown> => {
  if (isRecord(raw)) return raw;
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const extractDingTalkApprovalCalls = (event: AgentWaitingForHumanEvent): ApprovalCall[] => {
  const state = isRecord(event.finalState) ? event.finalState : {};
  const tools = Array.isArray(state.pendingToolsCalling) ? state.pendingToolsCalling : [];
  const anchors = Array.isArray(state.pendingHumanToolMessages)
    ? state.pendingHumanToolMessages
    : [];
  const calls: ApprovalCall[] = [];
  for (const anchor of anchors) {
    if (!isRecord(anchor) || anchor.kind !== 'approval') continue;
    const toolCallId = typeof anchor.toolCallId === 'string' ? anchor.toolCallId : '';
    const parentMessageId = typeof anchor.messageId === 'string' ? anchor.messageId : '';
    if (!toolCallId || !parentMessageId) continue;
    const tool = tools.find((item) => isRecord(item) && item.id === toolCallId);
    calls.push({
      apiName: isRecord(tool) && typeof tool.apiName === 'string' ? tool.apiName : undefined,
      args: parseArgs(isRecord(tool) ? tool.arguments : undefined),
      identifier:
        isRecord(tool) && typeof tool.identifier === 'string' ? tool.identifier : undefined,
      parentMessageId,
      toolCallId,
    });
  }
  return calls;
};

const armExpiry = (outTrackId: string, delayMs: number): void => {
  const existing = timers.get(outTrackId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(
    () => {
      timers.delete(outTrackId);
      void expireDingTalkApproval(outTrackId);
    },
    Math.max(0, delayMs),
  );
  timer.unref?.();
  timers.set(outTrackId, timer);
};

const disarmExpiry = (outTrackId: string): void => {
  const existing = timers.get(outTrackId);
  if (existing) clearTimeout(existing);
  timers.delete(outTrackId);
};

const botContextFromState = (
  event: AgentWaitingForHumanEvent,
  threadId: string,
  askerStaffId: string,
): DingTalkApprovalBotContext => {
  const state = isRecord(event.finalState) ? event.finalState : {};
  const metadata = isRecord(state.metadata) ? state.metadata : {};
  const bot = isRecord(metadata.botContext) ? metadata.botContext : {};
  return {
    applicationId:
      typeof bot.applicationId === 'string' && bot.applicationId
        ? bot.applicationId
        : 'messenger-dingtalk',
    isOwner: bot.isOwner === true,
    messengerInstallationKey:
      typeof bot.messengerInstallationKey === 'string' ? bot.messengerInstallationKey : undefined,
    platform: 'dingtalk',
    platformThreadId: threadId,
    senderExternalUserId: askerStaffId,
  };
};

const rejectMessages = async (
  userId: string,
  workspaceId: string | undefined,
  calls: ApprovalCall[],
  content: string,
): Promise<void> => {
  const db = await getServerDB();
  const model = new MessageModel(db, userId, workspaceId);
  for (const call of calls) {
    const rejected = await model.rejectPendingMessagePlugin(call.parentMessageId, {
      content,
      rejectedReason: content,
    });
    if (!rejected) {
      log('rejectPendingMessagePlugin skipped message=%s', call.parentMessageId);
    }
  }
};

/**
 * An invalid preview cannot be approved. Refuse every parked call with the
 * sanitized reason and continue the run so the model can split or fix it.
 * Sealing drops the thread index; a later click must not resume these rows.
 */
const refusedPreviewOutcome = async (
  userId: string,
  workspaceId: string | undefined,
  calls: ApprovalCall[],
  reason: string,
  outTrackId?: string,
): Promise<DingTalkWaitingOutcome> => {
  await rejectMessages(userId, workspaceId, calls, reason);
  if (outTrackId) await sealDingTalkPendingApproval(outTrackId, 'rejected');
  return {
    resumeHistory: {
      parentMessageId: (calls.at(-1) ?? calls[0])?.parentMessageId ?? '',
    },
  };
};

const resumeThread = (threadId: string, topicId: string) =>
  ({
    adapter: {
      addReaction: async () => undefined,
      decodeThreadId: () => ({}),
      fetchThread: async () => ({ channelName: '', metadata: {} }),
      removeReaction: async () => undefined,
    },
    id: threadId,
    post: async (body: { markdown?: string }) => {
      if (body?.markdown) await sendDingTalkMarkdown(threadId, body.markdown);
      return { edit: async () => undefined, id: `resume-${threadId}` };
    },
    setState: async () => undefined,
    startTyping: async () => undefined,
    state: Promise.resolve({ topicId }),
    subscribe: async () => undefined,
  }) as unknown as Parameters<AgentBridgeService['handleSubscribedMessage']>[0];

const resumeMessage = (record: DingTalkPendingApproval) =>
  ({
    author: { userId: record.askerStaffId, userName: record.askerStaffId },
    id: `confirm-${record.outTrackId}`,
    text: '',
  }) as Parameters<AgentBridgeService['handleSubscribedMessage']>[1];

const decisionOf = (record: DingTalkPendingApproval): DingTalkApprovalDecision => {
  if (
    record.decision === 'approved' ||
    record.decision === 'rejected' ||
    record.decision === 'expired'
  ) {
    return record.decision;
  }
  if (record.status === 'approved' || record.status === 'rejected' || record.status === 'expired') {
    return record.status;
  }
  return 'rejected';
};

/** True once the parked run has dropped the in-process active-thread flag. */
const waitForDingTalkThreadIdle = async (threadId: string): Promise<boolean> => {
  const deadline = Date.now() + resolveResumeSettleMs();
  for (;;) {
    if (!AgentBridgeService.isThreadActive(threadId)) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await sleep(Math.min(DINGTALK_RESUME_POLL_MS, remaining));
  }
};

const runResumeOnce = async (
  record: DingTalkPendingApproval,
  extra: {
    onWaitingForHuman?: (event: AgentWaitingForHumanEvent) => Promise<void>;
    resumeApproval?: DingTalkWaitingOutcome['resumeApproval'];
    resumeHistory?: { parentMessageId: string };
  },
): Promise<boolean> => {
  let skipped = false;
  const db = await getServerDB();
  const bridge = new AgentBridgeService(db, record.userId, record.workspaceId);
  const replySink = await createDingTalkReplySink(record.threadId);
  const botContext: ChatTopicBotContext = record.botContext;
  await bridge.handleSubscribedMessage(
    resumeThread(record.threadId, record.topicId),
    resumeMessage(record),
    {
      agentId: record.agentId,
      botContext,
      onSkippedActive: async () => {
        skipped = true;
      },
      onWaitingForHuman: extra.onWaitingForHuman,
      replySink,
      resumeApproval: extra.resumeApproval,
      resumeHistory: extra.resumeHistory,
    },
  );
  return !skipped;
};

/**
 * Resume only after the original run has settled. A click that arrives while
 * the thread is still active is retried once that flag clears. If it never
 * clears inside the wait, the caller must not mark the card decided.
 */
const runResume = async (
  record: DingTalkPendingApproval,
  extra: {
    onWaitingForHuman?: (event: AgentWaitingForHumanEvent) => Promise<void>;
    resumeApproval?: DingTalkWaitingOutcome['resumeApproval'];
    resumeHistory?: { parentMessageId: string };
  },
): Promise<boolean> => {
  if (!(await waitForDingTalkThreadIdle(record.threadId))) return false;
  if (await runResumeOnce(record, extra)) return true;
  if (!(await waitForDingTalkThreadIdle(record.threadId))) return false;
  return runResumeOnce(record, extra);
};

const updateCardStatus = async (
  record: DingTalkPendingApproval,
  status: keyof typeof STATUS_LABEL,
): Promise<void> => {
  const config = await getMessengerDingTalkConfig();
  if (!config) return;
  const api = apiForConfig(config);
  await updateDingTalkConfirmCard(api, record.outTrackId, {
    status: STATUS_BUTTON[status],
    statusText: STATUS_LABEL[status],
  });
};

const labelKeyFor = (decision: DingTalkApprovalDecision): keyof typeof STATUS_LABEL => {
  if (decision === 'approved') return 'approved';
  if (decision === 'rejected') return 'rejected';
  return 'expired';
};

/** A v1.10.1 record has no `calls`. Its card covered only `toolCallId`. */
const isLegacyApprovalRecord = (record: DingTalkPendingApproval): boolean =>
  !record.calls || record.calls.length === 0;

/** Primary first. Legacy records do not include siblings; those were skipped. */
const allCalls = (record: DingTalkPendingApproval): ApprovalCall[] => {
  if (record.calls && record.calls.length > 0) {
    return record.calls.map((item) => ({
      apiName: item.apiName,
      args: {},
      parentMessageId: item.parentMessageId,
      toolCallId: item.toolCallId,
    }));
  }
  return [{ args: {}, parentMessageId: record.parentMessageId, toolCallId: record.toolCallId }];
};

const legacySiblingCalls = (record: DingTalkPendingApproval): ApprovalCall[] => {
  if (!isLegacyApprovalRecord(record)) return [];
  return (record.siblings ?? [])
    .filter((item) => item.toolCallId.length > 0 && item.toolCallId !== record.toolCallId)
    .map((item) => ({
      args: {},
      parentMessageId: item.parentMessageId,
      toolCallId: item.toolCallId,
    }));
};

const rejectLegacySiblings = async (
  record: DingTalkPendingApproval,
  reason: string,
): Promise<void> => {
  const siblings = legacySiblingCalls(record);
  if (siblings.length === 0) return;
  await rejectMessages(record.userId, record.workspaceId, siblings, reason);
};

/** In-batch writes must not move the thread index onto this older card. */
const saveInBatch = (record: DingTalkPendingApproval): Promise<boolean> =>
  saveDingTalkPendingApproval(record, { threadIndex: 'skip' });

const resumeIsRecent = (record: DingTalkPendingApproval, now = Date.now()): boolean =>
  typeof record.resumingAt === 'number' && now - record.resumingAt <= DINGTALK_RESUME_RECONCILE_MS;

const rejectionReasonFor = (decision: DingTalkApprovalDecision): string =>
  decision === 'expired' ? DINGTALK_CONFIRM_TIMEOUT_REASON : '已拒绝';

const resumePayloadFor = (
  record: DingTalkPendingApproval,
  call: ApprovalCall,
): NonNullable<DingTalkWaitingOutcome['resumeApproval']> => {
  const decision = decisionOf(record);
  if (decision === 'approved') {
    return {
      decision: 'approved',
      parentMessageId: call.parentMessageId,
      toolCallId: call.toolCallId,
    };
  }
  return {
    decision: 'rejected_continue',
    parentMessageId: call.parentMessageId,
    rejectionReason: rejectionReasonFor(decision),
    toolCallId: call.toolCallId,
  };
};

/** Past the confirm window and resume was not accepted. Reject the tool rows in place. */
const rejectTimedOut = async (record: DingTalkPendingApproval): Promise<void> => {
  await rejectMessages(
    record.userId,
    record.workspaceId,
    allCalls(record),
    DINGTALK_CONFIRM_TIMEOUT_REASON,
  );
  await rejectLegacySiblings(record, DINGTALK_CONFIRM_TIMEOUT_REASON);
  const expired: DingTalkPendingApproval = { ...record, decision: 'expired', status: 'resuming' };
  if (!record.cardPatched) {
    try {
      await updateCardStatus(expired, 'expired');
    } catch (error) {
      log('timeout card update failed outTrackId=%s: %O', record.outTrackId, error);
    }
  }
  await finalizeDingTalkPendingApproval(expired);
};

/**
 * Resume did not apply. Inside the window the card stays clickable.
 * Past the window the tool is rejected as 超时未确认. A 0-delay timer is not
 * re-armed, so a still-active thread cannot spin.
 */
const releaseUnaccepted = async (record: DingTalkPendingApproval): Promise<void> => {
  const delay = record.expiresAt - Date.now();
  if (delay > 0) {
    await revertDingTalkPendingApproval(record);
    armExpiry(record.outTrackId, delay);
    return;
  }
  await rejectTimedOut(record);
};

const pluginStatus = async (
  record: DingTalkPendingApproval,
  parentMessageId: string,
): Promise<string | undefined> => {
  const db = await getServerDB();
  const model = new MessageModel(db, record.userId, record.workspaceId);
  const plugin = await model.findMessagePlugin(parentMessageId);
  return plugin?.intervention?.status;
};

/**
 * Apply one decision to every parked call.
 * Approve resumes the first still-pending call; a re-park whose ids are all in
 * `decidedCallIds` resumes the next one here, with no new card.
 * Reject and timeout wait until the thread is idle, reject every other
 * still-pending row, then one rejected_continue resume, so the model does not
 * answer while calls 2..N are still pending. If the thread never goes idle,
 * the card is reverted and nothing has been rejected. Legacy records skip
 * siblings before resume. The card is patched at most once. In-batch saves
 * do not touch the thread index.
 *
 * @returns whether the first resume was accepted. The original `record` is
 * what a failed first resume reverts, so callers can match it.
 */
const driveBatch = async (
  record: DingTalkPendingApproval,
  start: ApprovalCall,
): Promise<boolean> => {
  const decision = decisionOf(record);
  if (isLegacyApprovalRecord(record)) {
    const reason =
      decision === 'expired' ? DINGTALK_CONFIRM_TIMEOUT_REASON : LEGACY_SIBLING_SKIP_REASON;
    await rejectLegacySiblings(record, reason);
  }

  let snapshot: DingTalkPendingApproval = record;
  let current = start;
  let othersRejected = false;
  const limit = Math.max(allCalls(record).length, 1);
  const singleResume = decision !== 'approved' && !isLegacyApprovalRecord(record);

  const rejectOtherPending = async (): Promise<void> => {
    if (othersRejected || decision === 'approved' || isLegacyApprovalRecord(record)) return;
    othersRejected = true;
    const others: ApprovalCall[] = [];
    for (const call of allCalls(record)) {
      if (call.toolCallId === start.toolCallId) continue;
      const status = await pluginStatus(record, call.parentMessageId);
      if (status !== 'pending') continue;
      others.push(call);
    }
    if (others.length === 0) return;
    await rejectMessages(record.userId, record.workspaceId, others, rejectionReasonFor(decision));
  };

  if (singleResume) {
    if (!(await waitForDingTalkThreadIdle(record.threadId))) {
      await releaseUnaccepted(record);
      return false;
    }
    await rejectOtherPending();
  }

  const finish = async (next: DingTalkPendingApproval): Promise<boolean> => {
    await finalizeDingTalkPendingApproval({ ...next, decision });
    return true;
  };

  for (let step = 0; step < limit; step += 1) {
    snapshot = {
      ...snapshot,
      decision,
      lastResumedToolCallId: current.toolCallId,
      status: 'resuming',
    };
    await saveInBatch(snapshot);

    let continuation: DingTalkWaitingOutcome | undefined;
    let accepted: boolean;
    try {
      accepted = await runResume(snapshot, {
        onWaitingForHuman: async (event) => {
          continuation = await forwardDingTalkWaitingHuman(snapshot.threadId, event, {
            agentId: snapshot.agentId,
            userId: snapshot.userId,
            workspaceId: snapshot.workspaceId,
          });
        },
        resumeApproval: resumePayloadFor(snapshot, current),
      });
    } catch (error) {
      if (snapshot.expiresAt <= Date.now() && !snapshot.cardPatched) {
        await rejectTimedOut(record);
        log('resume failed after timeout outTrackId=%s: %O', record.outTrackId, error);
        return false;
      }
      if (snapshot.cardPatched) {
        log('later resume failed outTrackId=%s: %O', record.outTrackId, error);
        await finalizeDingTalkPendingApproval({ ...snapshot, decision });
        return false;
      }
      await revertDingTalkPendingApproval(record);
      armExpiry(record.outTrackId, record.expiresAt - Date.now());
      throw error;
    }

    if (!accepted) {
      if (snapshot.cardPatched) {
        await finalizeDingTalkPendingApproval({ ...snapshot, decision });
        return false;
      }
      await releaseUnaccepted(record);
      return false;
    }

    if (!snapshot.cardPatched) {
      const patched: DingTalkPendingApproval = { ...snapshot, cardPatched: true, decision };
      try {
        await updateCardStatus(patched, labelKeyFor(decision));
      } catch (error) {
        log('confirm card update failed after resume outTrackId=%s: %O', record.outTrackId, error);
      }
      snapshot = patched;
      await saveInBatch(snapshot);
    }

    // A failed follow-up card, or a covered reject, asks for one history resume.
    if (continuation?.resumeHistory && !continuation.resumeApproval) {
      await rejectOtherPending();
      await runResume(snapshot, {
        onWaitingForHuman: async (event) => {
          await forwardDingTalkWaitingHuman(snapshot.threadId, event, {
            agentId: snapshot.agentId,
            userId: snapshot.userId,
            workspaceId: snapshot.workspaceId,
          });
        },
        resumeHistory: continuation.resumeHistory,
      });
      return finish(snapshot);
    }

    const next = continuation?.resumeApproval;
    if (!next?.toolCallId || !next.parentMessageId || next.toolCallId === current.toolCallId) {
      await rejectOtherPending();
      // The run ended without re-parking (/stop, or a step that was not accepted).
      // Finalize so a restart does not execute the calls that are still pending.
      return finish(snapshot);
    }
    await rejectOtherPending();
    // Reject and timeout already refused the other rows. A second
    // rejected_continue would run only after the model had answered.
    if (singleResume) return finish(snapshot);
    current = { args: {}, parentMessageId: next.parentMessageId, toolCallId: next.toolCallId };
  }

  return finish(snapshot);
};

const firstPendingCall = async (
  record: DingTalkPendingApproval,
): Promise<ApprovalCall | undefined> => {
  for (const call of allCalls(record)) {
    const status = await pluginStatus(record, call.parentMessageId);
    if (status === 'pending') return call;
  }
  return undefined;
};

/**
 * @returns whether the resume was accepted. Already-decided rows are skipped.
 * When nothing is still pending the card is patched and the record finalized.
 */
const finishClaimed = async (record: DingTalkPendingApproval): Promise<boolean> => {
  const start = await firstPendingCall(record);
  if (!start) {
    const decision = decisionOf(record);
    if (isLegacyApprovalRecord(record)) {
      const reason =
        decision === 'expired' ? DINGTALK_CONFIRM_TIMEOUT_REASON : LEGACY_SIBLING_SKIP_REASON;
      await rejectLegacySiblings(record, reason);
    }
    await patchCardOnce(record, decision);
    await finalizeDingTalkPendingApproval({ ...record, decision });
    return true;
  }
  return driveBatch(record, start);
};

export const expireDingTalkApproval = async (outTrackId: string): Promise<void> => {
  disarmExpiry(outTrackId);
  const claimed = await claimDingTalkPendingApproval(outTrackId, 'expired');
  if (claimed.outcome !== 'claimed') return;
  await finishClaimed(claimed.record);
};

export const applyDingTalkConfirmClick = async (params: {
  decision: 'approve' | 'reject';
  outTrackId: string;
  userId: string;
}): Promise<'applied' | 'deferred' | 'missing' | 'not_asker' | 'stale' | 'web_only'> => {
  const loaded = await loadDingTalkPendingApproval(params.outTrackId);
  if (!loaded) return 'missing';
  if (loaded.askerStaffId && params.userId !== loaded.askerStaffId) {
    if (await claimDingTalkApprovalNotice('not-asker', params.outTrackId, params.userId)) {
      await sendDingTalkMarkdown(loaded.threadId, DINGTALK_ASKER_ONLY_REPLY, {
        staffId: params.userId,
      });
    }
    return 'not_asker';
  }
  if (params.decision === 'approve' && loaded.approveOnCard === false) {
    if (await claimDingTalkApprovalNotice('web-only', params.outTrackId, params.userId)) {
      const link = loaded.webLink || buildDingTalkTopicDeepLink(loaded.agentId, loaded.topicId);
      await sendDingTalkMarkdown(loaded.threadId, formatDingTalkWebConfirmMarkdown(link), {
        staffId: params.userId,
      });
    }
    return 'web_only';
  }
  disarmExpiry(params.outTrackId);
  const claimed = await claimDingTalkPendingApproval(
    params.outTrackId,
    params.decision === 'approve' ? 'approved' : 'rejected',
  );
  if (claimed.outcome !== 'claimed') return 'stale';
  const accepted = await finishClaimed(claimed.record);
  return accepted ? 'applied' : 'deferred';
};

/**
 * Inbound text while a confirm card is pending. A live card is not approved by
 * typing. An overdue card is rejected as 超时未确认 so the topic is not stuck.
 */
export const holdDingTalkPendingApproval = async (
  threadId: string,
): Promise<'expired' | 'none' | 'pending'> => {
  const record = await loadDingTalkPendingApprovalByThread(threadId);
  if (!record || record.status !== 'pending') return 'none';
  if (record.expiresAt > Date.now()) return 'pending';
  await expireDingTalkApproval(record.outTrackId);
  return 'expired';
};

const topicIdOf = (event: AgentWaitingForHumanEvent): string => {
  if (event.topicId) return event.topicId;
  const state = isRecord(event.finalState) ? event.finalState : {};
  const metadata = isRecord(state.metadata) ? state.metadata : {};
  return typeof metadata.topicId === 'string' ? metadata.topicId : '';
};

const askerStaffIdFrom = (threadId: string, event: AgentWaitingForHumanEvent): string => {
  const decoded = decodeDingTalkThreadId(threadId);
  if (decoded.senderStaffId) return decoded.senderStaffId;
  const state = isRecord(event.finalState) ? event.finalState : {};
  const metadata = isRecord(state.metadata) ? state.metadata : {};
  const bot = isRecord(metadata.botContext) ? metadata.botContext : {};
  return typeof bot.senderExternalUserId === 'string' ? bot.senderExternalUserId : '';
};

const PREVIEW_CODE = /^[\w.:-]{1,80}$/;

const previewFailureCode = (error: unknown): string => {
  const candidates = [
    isRecord(error) && 'code' in error ? error.code : undefined,
    error instanceof Error ? error.message : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && PREVIEW_CODE.test(candidate.trim())) {
      return candidate.trim();
    }
  }
  return 'UNKNOWN';
};

/**
 * Same services the tool runtime constructs (`new Service(db, userId)`).
 * Called once, from the send path only.
 */
const loadDingTalkToolPreview = async (
  identifier: string,
  userId: string,
  apiName: string,
  args: Record<string, unknown>,
) => {
  if (!userId) throw new DingtalkWorkspaceError('DINGTALK_IDENTITY_UNBOUND');
  const db = await getServerDB();
  if (identifier === DINGTALK_APPROVAL_TOOL_IDENTIFIER) {
    const { DingtalkApprovalService } =
      await import('@/server/enterprise/services/dingtalkWorkspace/approval');
    return new DingtalkApprovalService(db, userId).preview({ apiName, args });
  }

  if (identifier === DINGTALK_PERSONAL_TOOL_IDENTIFIER) {
    const { previewDingtalkPersonalWrite } =
      await import('@/server/enterprise/services/dingtalkPersonal/tool');
    const preview = await previewDingtalkPersonalWrite(
      db,
      userId,
      apiName as Parameters<typeof previewDingtalkPersonalWrite>[2],
      args,
    );
    return {
      danger: preview.danger,
      lines: preview.lines.map((line) => ({ value: line })),
      title: preview.title,
      warnings: preview.warnings,
    };
  }

  if (identifier === DingtalkDocsIdentifier) {
    const { previewDingtalkDocsWrite } =
      await import('@/server/enterprise/services/dingtalkDocs/tool');
    const preview = await previewDingtalkDocsWrite(
      db,
      userId,
      apiName as Parameters<typeof previewDingtalkDocsWrite>[2],
      args,
    );
    return {
      danger: preview.danger,
      lines: preview.lines.map((line) => ({ value: line })),
      title: preview.title,
      warnings: preview.warnings,
    };
  }

  const [
    { DingtalkTodoService, isTodoWriteApiName },
    { DingtalkCalendarService, isCalendarWriteApiName },
  ] = await Promise.all([
    import('@/server/enterprise/services/dingtalkWorkspace/todo'),
    import('@/server/enterprise/services/dingtalkWorkspace/calendar'),
  ]);
  if (isTodoWriteApiName(apiName)) {
    return new DingtalkTodoService(db, userId).preview({ apiName, args });
  }
  if (isCalendarWriteApiName(apiName)) {
    return new DingtalkCalendarService(db, userId).preview({ apiName, args });
  }
  throw new DingtalkWorkspaceError('DINGTALK_INVALID');
};

interface BuiltinToolTitle {
  identifier?: string;
  manifest?: { meta?: { title?: string } };
  title?: string;
}

let builtinToolTitles: Promise<Map<string, string>> | undefined;

const manifestTitleFor = (identifier?: string): Promise<string | undefined> => {
  if (!identifier) return Promise.resolve(undefined);
  if (!builtinToolTitles) {
    builtinToolTitles = import('@lobechat/builtin-tools')
      .then((mod) => {
        const tools = (mod as { builtinTools?: BuiltinToolTitle[] }).builtinTools ?? [];
        const map = new Map<string, string>();
        for (const tool of tools) {
          const title = tool.title ?? tool.manifest?.meta?.title;
          if (tool.identifier && typeof title === 'string' && title.trim()) {
            map.set(tool.identifier, title.trim());
          }
        }
        return map;
      })
      .catch((error: unknown) => {
        log('builtin manifest title lookup failed: %O', error);
        return new Map<string, string>();
      });
  }
  return builtinToolTitles.then((map) => map.get(identifier));
};

const isDingTalkWriteTool = (identifier?: string): boolean =>
  identifier === DINGTALK_APPROVAL_TOOL_IDENTIFIER ||
  identifier === DINGTALK_PERSONAL_TOOL_IDENTIFIER ||
  identifier === DINGTALK_WORKSPACE_TOOL_IDENTIFIER ||
  identifier === DingtalkDocsIdentifier;

const attachManifestTitle = async (call: ApprovalCall): Promise<ApprovalCall> => {
  if (
    isDingTalkWriteTool(call.identifier) ||
    hasDingTalkApiLabel(call.apiName) ||
    call.manifestTitle
  ) {
    return call;
  }
  const manifestTitle = await manifestTitleFor(call.identifier);
  return manifestTitle ? { ...call, manifestTitle } : call;
};

const renderDingTalkConfirmCard = async (
  tool: ApprovalCall,
  userId: string,
  link: string,
): Promise<DingTalkRenderedConfirm> => {
  const identifier = tool.identifier;
  if (
    identifier !== DINGTALK_APPROVAL_TOOL_IDENTIFIER &&
    identifier !== DINGTALK_PERSONAL_TOOL_IDENTIFIER &&
    identifier !== DINGTALK_WORKSPACE_TOOL_IDENTIFIER &&
    identifier !== DingtalkDocsIdentifier
  ) {
    return formatDingTalkConfirmSummary(tool);
  }

  try {
    const preview = await loadDingTalkToolPreview(
      identifier,
      userId,
      tool.apiName ?? '',
      tool.args,
    );
    return formatDingTalkPreviewCard(tool, preview);
  } catch (error) {
    const code = previewFailureCode(error);
    log(
      'confirm preview failed identifier=%s api=%s code=%s: %O',
      identifier,
      tool.apiName,
      code,
      error,
    );
    const detail = dingTalkInvalidPreviewDetail(error, code);
    const note = formatDingTalkPreviewUnavailable(code, link, detail);
    return {
      allowApprove: false,
      content: detail ?? `无法解析操作对象（${code}）`,
      note,
      ...(detail ? { refusalReason: detail } : {}),
      title: formatDingTalkConfirmSummary(tool).title,
    };
  }
};

/** Preview every parked call (at most {@link DINGTALK_CONFIRM_BATCH_CAP}), sequentially. */
const renderTurnCard = async (
  calls: ApprovalCall[],
  userId: string,
  link: string,
): Promise<DingTalkRenderedConfirm> => {
  if (calls.length > DINGTALK_CONFIRM_BATCH_CAP) {
    return formatDingTalkOversizedBatch(calls, link);
  }
  const rendered: DingTalkRenderedConfirm[] = [];
  for (const call of calls) {
    rendered.push(await renderDingTalkConfirmCard(await attachManifestTitle(call), userId, link));
  }
  const first = rendered[0];
  if (rendered.length <= 1 && first) return first;
  const refused = rendered.find((item) => item.refusalReason);
  const failed = refused ?? rendered.find((item) => item.allowApprove === false);
  return {
    content: formatDingTalkAggregateBody(rendered),
    title: formatDingTalkAggregateTitle(calls, first?.title ?? '确认操作'),
    ...(refused?.refusalReason ? { refusalReason: refused.refusalReason } : {}),
    ...(failed ? { allowApprove: false, note: failed.note } : {}),
  };
};

/** Same tool call and the same tool message. A reused id with a new parent is a new card. */
const decisionCoversCall = (record: DingTalkPendingApproval, call: ApprovalCall): boolean => {
  const decided = record.decidedCallIds ?? [];
  if (!decided.includes(call.toolCallId)) return false;
  if (record.calls && record.calls.length > 0) {
    const stored = record.calls.find((item) => item.toolCallId === call.toolCallId);
    return !!stored && stored.parentMessageId === call.parentMessageId;
  }
  return call.toolCallId === record.toolCallId && call.parentMessageId === record.parentMessageId;
};

/**
 * A re-park of a turn that was already decided. Approve resumes the next
 * call and does not send a card. Reject or timeout drops any still-pending
 * rows with the same reason and does not send a card.
 */
const matchCoveredBatch = async (
  threadId: string,
  calls: ApprovalCall[],
): Promise<{ kind: 'card' } | { kind: 'resume'; outcome: DingTalkWaitingOutcome | undefined }> => {
  const record = await loadDingTalkPendingApprovalByThread(threadId);
  if (!record || record.status === 'pending' || !record.decision) return { kind: 'card' };
  if (
    record.decision !== 'approved' &&
    record.decision !== 'rejected' &&
    record.decision !== 'expired'
  ) {
    return { kind: 'card' };
  }
  const decided = record.decidedCallIds ?? [];
  if (decided.length === 0 || !calls.every((call) => decisionCoversCall(record, call))) {
    return { kind: 'card' };
  }
  if (record.decision === 'approved') {
    const next = calls.find((call) => call.toolCallId !== record.lastResumedToolCallId);
    if (!next) return { kind: 'resume', outcome: undefined };
    return {
      kind: 'resume',
      outcome: {
        resumeApproval: {
          decision: 'approved',
          parentMessageId: next.parentMessageId,
          toolCallId: next.toolCallId,
        },
      },
    };
  }
  await rejectMessages(
    record.userId,
    record.workspaceId,
    calls,
    rejectionReasonFor(record.decision),
  );
  const last = calls.at(-1);
  return {
    kind: 'resume',
    outcome: last ? { resumeHistory: { parentMessageId: last.parentMessageId } } : undefined,
  };
};

export const forwardDingTalkWaitingHuman = async (
  threadId: string,
  event: AgentWaitingForHumanEvent,
  ctx: DingTalkWaitingContext,
): Promise<DingTalkWaitingOutcome | undefined> => {
  const calls = extractDingTalkApprovalCalls(event);
  if (calls.length === 0) {
    await forwardDingTalkWaitingQuestion(threadId, event);
    return undefined;
  }

  const covered = await matchCoveredBatch(threadId, calls);
  if (covered.kind === 'resume') return covered.outcome;

  const primary = calls[0];
  if (!primary) return undefined;
  const rest = calls.slice(1);
  const topicId = topicIdOf(event);
  const agentId = ctx.agentId;
  const link = buildDingTalkTopicDeepLink(agentId, topicId);
  const failedContent = formatDingTalkCardSendFailedContent(link);
  const decoded = decodeDingTalkThreadId(threadId);
  const staffId = askerStaffIdFrom(threadId, event);

  const failClosed = async (): Promise<DingTalkWaitingOutcome> => {
    await rejectMessages(ctx.userId, ctx.workspaceId, calls, failedContent);
    return { resumeHistory: { parentMessageId: (calls.at(-1) ?? primary).parentMessageId } };
  };

  if (!staffId) {
    log('confirm card skipped: missing asker staffId thread=%s', threadId);
    return failClosed();
  }

  const config = await getMessengerDingTalkConfig();
  if (!config?.robotCode) return failClosed();

  // Preview hits DingTalk. Run it only when a card will be sent, and only here.
  const summary = await renderTurnCard(calls, ctx.userId, link);
  const fitted = fitDingTalkConfirmCardContent(summary.content, link);
  const allowApprove = summary.allowApprove === false ? false : fitted.allowApprove;
  const note =
    summary.note ??
    fitted.note ??
    (allowApprove ? ASKER_NOTE : formatDingTalkConfirmOverflowLine(link));

  const isGroup = Boolean(decoded.senderStaffId);
  const outTrackId = `confirm-${randomUUID()}`;
  const record: DingTalkPendingApproval = {
    agentId,
    approveOnCard: allowApprove,
    askerStaffId: staffId,
    botContext: botContextFromState(event, threadId, staffId),
    calls: calls.map((item) => ({
      apiName: item.apiName,
      parentMessageId: item.parentMessageId,
      toolCallId: item.toolCallId,
    })),
    cardContent: fitted.content,
    cardTitle: summary.title,
    conversationId: decoded.conversationId,
    conversationType: isGroup ? CONVERSATION_TYPE_GROUP : '1',
    expiresAt: Date.now() + DINGTALK_CONFIRM_TIMEOUT_MS,
    operationId: event.operationId ?? '',
    outTrackId,
    parentMessageId: primary.parentMessageId,
    robotCode: config.robotCode,
    siblings: rest.map((item) => ({
      parentMessageId: item.parentMessageId,
      toolCallId: item.toolCallId,
    })),
    status: 'pending',
    threadId,
    toolCallId: primary.toolCallId,
    topicId,
    userId: ctx.userId,
    webLink: link,
    workspaceId: ctx.workspaceId,
  };

  const saved = await saveDingTalkPendingApproval(record, { threadIndex: 'claim' });
  if (!saved) {
    if (summary.refusalReason) {
      return refusedPreviewOutcome(ctx.userId, ctx.workspaceId, calls, summary.refusalReason);
    }
    return failClosed();
  }

  try {
    const api = apiForConfig(config);
    await sendDingTalkStreamConfirmCard(api, {
      card: {
        allowApprove,
        content: fitted.content,
        note,
        status: '',
        statusText: allowApprove ? PENDING_STATUS_TEXT : WEB_STATUS_TEXT,
        title: summary.title,
        webLink: link,
      },
      // Setting wins. Null / blank keeps the env fallback inside the sender.
      cardTemplateId: config.confirmCardTemplateId?.trim() || undefined,
      outTrackId,
      target: {
        openConversationId: isGroup ? decoded.conversationId : undefined,
        robotCode: config.robotCode,
        staffId,
      },
    });
  } catch (error) {
    log(
      'confirm card send failed thread=%s: %s',
      threadId,
      error instanceof DingTalkCardUnavailableError ? error.message : String(error),
    );
    if (summary.refusalReason) {
      return refusedPreviewOutcome(
        ctx.userId,
        ctx.workspaceId,
        calls,
        summary.refusalReason,
        outTrackId,
      );
    }
    await sealDingTalkPendingApproval(outTrackId, 'expired', record.expiresAt + 1);
    return failClosed();
  }

  rememberDingTalkCard(outTrackId, {
    askerStaffId: staffId,
    conversationId: decoded.conversationId,
    conversationType: record.conversationType,
    threadId,
  });
  if (summary.refusalReason) {
    return refusedPreviewOutcome(
      ctx.userId,
      ctx.workspaceId,
      calls,
      summary.refusalReason,
      outTrackId,
    );
  }
  armExpiry(outTrackId, DINGTALK_CONFIRM_TIMEOUT_MS);
  return undefined;
};

const patchCardOnce = async (
  record: DingTalkPendingApproval,
  decision: DingTalkApprovalDecision,
): Promise<void> => {
  if (record.cardPatched) return;
  try {
    await updateCardStatus({ ...record, decision }, labelKeyFor(decision));
  } catch (error) {
    log('reconcile card update failed outTrackId=%s: %O', record.outTrackId, error);
  }
};

/** A stale in-progress batch must not stay on 「执行中」. */
const patchInterruptedCard = async (record: DingTalkPendingApproval): Promise<void> => {
  const config = await getMessengerDingTalkConfig();
  if (!config) return;
  try {
    const api = apiForConfig(config);
    await updateDingTalkConfirmCard(api, record.outTrackId, {
      status: 'reject',
      statusText: INTERRUPTED_STATUS_TEXT,
    });
  } catch (error) {
    log('interrupt card update failed outTrackId=%s: %O', record.outTrackId, error);
  }
};

const interruptStaleBatch = async (
  record: DingTalkPendingApproval,
  pending: ApprovalCall[],
): Promise<void> => {
  const siblings = legacySiblingCalls(record);
  const extra: ApprovalCall[] = [];
  for (const sibling of siblings) {
    if (pending.some((call) => call.toolCallId === sibling.toolCallId)) continue;
    const status = await pluginStatus(record, sibling.parentMessageId);
    if (status === 'pending') extra.push(sibling);
  }
  const rows = [...pending, ...extra];
  if (rows.length > 0) {
    await rejectMessages(record.userId, record.workspaceId, rows, INTERRUPTED_STATUS_TEXT);
  }
  await patchInterruptedCard(record);
  const decision = record.decision ?? 'rejected';
  await finalizeDingTalkPendingApproval({ ...record, decision });
};

/**
 * A crash between claim and resume leaves `resuming`. If nothing in the
 * batch has left `pending`, put the card back (or reject it once the window
 * has passed). An approved batch that already started resumes the next
 * pending call only while `resumingAt` is within 10 minutes. Older batches
 * are rejected as 已中断，未执行 so a restart does not run them a day later.
 */
const reconcileResumingApproval = async (record: DingTalkPendingApproval): Promise<void> => {
  const calls = allCalls(record);
  const db = await getServerDB();
  const model = new MessageModel(db, record.userId, record.workspaceId);
  const statuses: Array<string | undefined> = [];
  for (const call of calls) {
    const plugin = await model.findMessagePlugin(call.parentMessageId);
    statuses.push(plugin?.intervention?.status);
  }
  const nextPending = statuses.indexOf('pending');

  if (record.decision === 'approved' && nextPending > 0) {
    if (!resumeIsRecent(record)) {
      const pending = calls.filter((_, index) => statuses[index] === 'pending');
      await interruptStaleBatch(record, pending);
      return;
    }
    const next = calls[nextPending];
    if (next) await driveBatch(record, next);
    return;
  }

  if (nextPending > 0 && record.decision && record.decision !== 'approved') {
    const pending = calls.filter((_, index) => statuses[index] === 'pending');
    await rejectMessages(
      record.userId,
      record.workspaceId,
      pending,
      rejectionReasonFor(record.decision),
    );
    await patchCardOnce(record, record.decision);
    await finalizeDingTalkPendingApproval({ ...record, decision: record.decision });
    return;
  }

  if (nextPending === 0) {
    if (record.expiresAt <= Date.now()) {
      await finishClaimed({ ...record, decision: 'expired', status: 'resuming' });
      return;
    }
    await revertDingTalkPendingApproval(record);
    armExpiry(record.outTrackId, record.expiresAt - Date.now());
    return;
  }

  let decision: DingTalkApprovalDecision = record.decision ?? 'expired';
  if (!record.decision) {
    if (statuses[0] === 'approved') decision = 'approved';
    else if (statuses[0] === 'rejected') decision = 'rejected';
  }
  if (isLegacyApprovalRecord(record)) {
    const pendingSiblings: ApprovalCall[] = [];
    for (const sibling of legacySiblingCalls(record)) {
      const status = await pluginStatus(record, sibling.parentMessageId);
      if (status === 'pending') pendingSiblings.push(sibling);
    }
    if (pendingSiblings.length > 0) {
      const reason =
        decision === 'expired' ? DINGTALK_CONFIRM_TIMEOUT_REASON : LEGACY_SIBLING_SKIP_REASON;
      await rejectMessages(record.userId, record.workspaceId, pendingSiblings, reason);
    }
  }
  await patchCardOnce(record, decision);
  await finalizeDingTalkPendingApproval({ ...record, decision, status: 'resuming' });
};

/** Re-arm timers for pending cards after a process restart. Not a DingTalk poll. */
export const restoreDingTalkApprovalTimers = async (): Promise<void> => {
  const { getAgentRuntimeRedisClient } = await import('@/server/modules/AgentRuntime/redis');
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  const match = `${DINGTALK_PENDING_APPROVAL_KEY_PREFIX}*`;
  let cursor = '0';
  try {
    do {
      const scanned = await redis.scan(cursor, 'MATCH', match, 'COUNT', 50);
      cursor = scanned[0];
      for (const key of scanned[1]) {
        const outTrackId = key.slice(DINGTALK_PENDING_APPROVAL_KEY_PREFIX.length);
        if (!outTrackId || outTrackId.includes(':')) continue;
        const record = await loadDingTalkPendingApproval(outTrackId);
        if (!record) continue;
        if (record.status === 'resuming') {
          try {
            await reconcileResumingApproval(record);
          } catch (error) {
            log('reconcile resuming approval failed outTrackId=%s: %O', outTrackId, error);
          }
          continue;
        }
        if (record.status !== 'pending') continue;
        const delay = record.expiresAt - Date.now();
        if (delay <= 0) {
          void expireDingTalkApproval(outTrackId);
        } else {
          armExpiry(outTrackId, delay);
        }
      }
    } while (cursor !== '0');
  } catch (error) {
    log('restoreDingTalkApprovalTimers failed: %O', error);
  }
};
