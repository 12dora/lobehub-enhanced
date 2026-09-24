import { randomUUID } from 'node:crypto';

import {
  CONVERSATION_TYPE_GROUP,
  decodeDingTalkThreadId,
  DingTalkApiClient,
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
  type DingTalkRenderedConfirm,
  formatDingTalkCardSendFailedContent,
  formatDingTalkConfirmSummary,
  formatDingTalkPreviewCard,
  formatDingTalkPreviewUnavailable,
} from './confirmSummary';
import {
  DINGTALK_ASKER_ONLY_REPLY,
  DINGTALK_CONFIRM_TIMEOUT_MS,
  DINGTALK_CONFIRM_TIMEOUT_REASON,
  DINGTALK_PENDING_APPROVAL_KEY_PREFIX,
} from './const';
import { forwardDingTalkWaitingQuestion } from './questions';

const log = debug('lobe-server:messenger:dingtalk:approval');

/** How long a click waits for the parked run to leave `activeThreads`. */
const DINGTALK_RESUME_SETTLE_MS = 10_000;
const DINGTALK_RESUME_POLL_MS = 100;

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
  const api = new DingTalkApiClient(config.clientId, config.clientSecret);
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

/** Past the confirm window and resume was not accepted. Reject the tool rows in place. */
const rejectTimedOut = async (record: DingTalkPendingApproval): Promise<void> => {
  const calls = [
    { args: {}, parentMessageId: record.parentMessageId, toolCallId: record.toolCallId },
    ...(record.siblings ?? []).map((item) => ({
      args: {},
      parentMessageId: item.parentMessageId,
      toolCallId: item.toolCallId,
    })),
  ];
  await rejectMessages(record.userId, record.workspaceId, calls, DINGTALK_CONFIRM_TIMEOUT_REASON);
  const expired: DingTalkPendingApproval = { ...record, decision: 'expired', status: 'resuming' };
  try {
    await updateCardStatus(expired, 'expired');
  } catch (error) {
    log('timeout card update failed outTrackId=%s: %O', record.outTrackId, error);
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

/** @returns whether the resume was accepted. The card is updated only then. */
const finishClaimed = async (record: DingTalkPendingApproval): Promise<boolean> => {
  const siblings = record.siblings ?? [];
  if (siblings.length > 0) {
    await rejectMessages(
      record.userId,
      record.workspaceId,
      siblings.map((item) => ({
        args: {},
        parentMessageId: item.parentMessageId,
        toolCallId: item.toolCallId,
      })),
      '钉钉一次只能确认一项，此项已跳过。',
    );
  }

  const decision = decisionOf(record);
  let accepted: boolean;
  try {
    accepted = await runResume(record, {
      resumeApproval:
        decision === 'approved'
          ? {
              decision: 'approved',
              parentMessageId: record.parentMessageId,
              toolCallId: record.toolCallId,
            }
          : {
              decision: 'rejected_continue',
              parentMessageId: record.parentMessageId,
              rejectionReason: decision === 'expired' ? DINGTALK_CONFIRM_TIMEOUT_REASON : '已拒绝',
              toolCallId: record.toolCallId,
            },
    });
  } catch (error) {
    if (record.expiresAt <= Date.now()) {
      await rejectTimedOut(record);
      log('resume failed after timeout outTrackId=%s: %O', record.outTrackId, error);
      return false;
    }
    await revertDingTalkPendingApproval(record);
    armExpiry(record.outTrackId, record.expiresAt - Date.now());
    throw error;
  }

  if (!accepted) {
    await releaseUnaccepted(record);
    return false;
  }

  const finalized: DingTalkPendingApproval = { ...record, decision };
  try {
    await updateCardStatus(finalized, labelKeyFor(decision));
  } catch (error) {
    log('confirm card update failed after resume outTrackId=%s: %O', record.outTrackId, error);
  }
  await finalizeDingTalkPendingApproval(finalized);
  return true;
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
      await sendDingTalkMarkdown(loaded.threadId, formatDingTalkConfirmOverflowLine(link), {
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

const renderDingTalkConfirmCard = async (
  tool: ApprovalCall,
  userId: string,
  link: string,
): Promise<DingTalkRenderedConfirm> => {
  const identifier = tool.identifier;
  if (
    identifier !== DINGTALK_APPROVAL_TOOL_IDENTIFIER &&
    identifier !== DINGTALK_PERSONAL_TOOL_IDENTIFIER &&
    identifier !== DINGTALK_WORKSPACE_TOOL_IDENTIFIER
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
    const note = formatDingTalkPreviewUnavailable(code, link);
    return {
      allowApprove: false,
      content: `无法解析操作对象（${code}）`,
      note,
      title: formatDingTalkConfirmSummary(tool).title,
    };
  }
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
  const summary = await renderDingTalkConfirmCard(primary, ctx.userId, link);
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

  const saved = await saveDingTalkPendingApproval(record);
  if (!saved) return failClosed();

  try {
    const api = new DingTalkApiClient(config.clientId, config.clientSecret);
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
    await sealDingTalkPendingApproval(outTrackId, 'expired', record.expiresAt + 1);
    return failClosed();
  }

  rememberDingTalkCard(outTrackId, {
    askerStaffId: staffId,
    conversationId: decoded.conversationId,
    conversationType: record.conversationType,
    threadId,
  });
  armExpiry(outTrackId, DINGTALK_CONFIRM_TIMEOUT_MS);
  return undefined;
};

/**
 * A crash between claim and resume leaves `resuming`. If the tool row is
 * still pending, put the card back (or reject it once the window has passed).
 * If the row is already resolved, only update the card.
 */
const reconcileResumingApproval = async (record: DingTalkPendingApproval): Promise<void> => {
  const db = await getServerDB();
  const model = new MessageModel(db, record.userId, record.workspaceId);
  const plugin = await model.findMessagePlugin(record.parentMessageId);
  const interventionStatus = plugin?.intervention?.status;
  if (interventionStatus === 'pending') {
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
    if (interventionStatus === 'approved') decision = 'approved';
    else if (interventionStatus === 'rejected') decision = 'rejected';
  }
  const finalized: DingTalkPendingApproval = { ...record, decision, status: 'resuming' };
  try {
    await updateCardStatus(finalized, labelKeyFor(decision));
  } catch (error) {
    log('reconcile card update failed outTrackId=%s: %O', record.outTrackId, error);
  }
  await finalizeDingTalkPendingApproval(finalized);
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
