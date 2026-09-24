import {
  buildActionCardParam,
  chunkMarkdown,
  decodeDingTalkThreadId,
  DingTalkAiCardStream,
  type DingTalkApiClient,
  DingTalkCardUnavailableError,
  getDingTalkSession,
  isSessionWebhookLive,
  rememberDingTalkCard,
} from '@lobechat/chat-adapter-dingtalk';
import { convertGfmTablesForDingTalk } from '@lobechat/chat-adapter-dingtalk/markdownTables';
import { isRecord } from '@lobechat/utils/object';
import debug from 'debug';

import { getMessengerDingTalkConfig } from '@/config/messenger';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import type { AgentReplySink } from '@/server/services/bot/AgentBridgeService';
import { sendDingTalkAttachments } from '@/server/services/bot/platforms/dingtalk/sendAttachments';

import type { DingTalkOutboundAttachment } from './attachments';
import { mapOutboundAttachments } from './attachments';
import { resolveDingTalkBrandingDisplayName } from './branding';
import type { DingTalkLastListKind } from './const';
import {
  DINGTALK_COMMAND_CARD_TEXT,
  DINGTALK_COMMAND_CARD_TITLE,
  DINGTALK_COMMAND_SHORTCUT_BUTTONS,
  DINGTALK_HELP_TEXT,
  DINGTALK_LIST_PAGE_SIZE,
  DINGTALK_MARKDOWN_TITLE_FALLBACK,
  DINGTALK_THINKING_REPLY,
  DINGTALK_UNKNOWN_COMMAND_REPLY,
  DINGTALK_WELCOME_TEXT,
  formatDingTalkWelcomeTitle,
} from './const';
import { setDingTalkLastList } from './redis';
import { sharedDingTalkApiClient } from './tokenCache';

/** Text-mode 「思考中」 placeholder waits this long before it is sent. */
export const DINGTALK_THINKING_DELAY_MS = 5_000;
/**
 * How long a completed / failed / waiting turn stays marked done.
 * Long enough that a timer armed on another replica (queue mode) still
 * sees it, short enough that a later turn can mint a new epoch.
 */
export const DINGTALK_TURN_DONE_TTL_SECONDS = 30;
/**
 * Turn-epoch key lifetime. 120 s expired on a long turn, so the done marker
 * fell back to `1` and the next turn's INCR collided with it — 「正在思考…」
 * was never sent. 2 h covers a long run; onStart, onPartial, and
 * {@link markDingTalkTurnDone} refresh the TTL as well.
 */
export const DINGTALK_TURN_EPOCH_TTL_SECONDS = 2 * 60 * 60;

const log = debug('lobe-server:messenger:dingtalk:cards');

/** Redis key: epoch of the turn that already finished (complete / error / waiting). */
export const dingtalkTurnDoneRedisKey = (threadId: string): string =>
  `messenger:dingtalk:turn-done:${threadId}`;

const turnEpochRedisKey = (threadId: string): string => `messenger:dingtalk:turn-epoch:${threadId}`;

const thinkingTimers = new Map<string, ReturnType<typeof setTimeout>>();

const refreshDingTalkTurnEpochTtl = async (threadId: string): Promise<void> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  try {
    await redis.expire(turnEpochRedisKey(threadId), DINGTALK_TURN_EPOCH_TTL_SECONDS);
  } catch (error) {
    log('refreshDingTalkTurnEpochTtl failed: %O', error);
  }
};

const bumpDingTalkTurnEpoch = async (threadId: string): Promise<number | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;
  try {
    const epoch = await redis.incr(turnEpochRedisKey(threadId));
    await refreshDingTalkTurnEpochTtl(threadId);
    const numeric = typeof epoch === 'number' ? epoch : Number(epoch);
    return Number.isFinite(numeric) ? numeric : null;
  } catch (error) {
    log('bumpDingTalkTurnEpoch failed: %O', error);
    return null;
  }
};

/** Record that this thread's current turn finished, so a late thinking send is skipped. */
export const markDingTalkTurnDone = async (threadId: string): Promise<void> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  try {
    // Keep the epoch key alive so the stored done value is this turn's epoch,
    // not the fallback `1` that collides with the next turn.
    await refreshDingTalkTurnEpochTtl(threadId);
    const epoch = await redis.get(turnEpochRedisKey(threadId));
    const value = epoch == null || epoch === '' ? '1' : String(epoch);
    await redis.set(
      dingtalkTurnDoneRedisKey(threadId),
      value,
      'EX',
      DINGTALK_TURN_DONE_TTL_SECONDS,
    );
  } catch (error) {
    log('markDingTalkTurnDone failed: %O', error);
  }
};

const readDingTalkTurnDoneEpoch = async (threadId: string): Promise<number | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(dingtalkTurnDoneRedisKey(threadId));
    if (raw == null || raw === '') return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (error) {
    log('readDingTalkTurnDoneEpoch failed: %O', error);
    return null;
  }
};

const clearRegisteredThinkingTimer = (threadId: string): void => {
  const timer = thinkingTimers.get(threadId);
  if (!timer) return;
  clearTimeout(timer);
  thinkingTimers.delete(threadId);
};

const apiFor = (config: { clientId: string; clientSecret: string; robotCode: string }) =>
  sharedDingTalkApiClient({
    appKey: config.clientId,
    appSecret: config.clientSecret,
    robotCode: config.robotCode,
  });

const liveSinks = new Map<string, AgentReplySink>();

export const getDingTalkReplySink = (threadId: string): AgentReplySink | undefined =>
  liveSinks.get(threadId);

export const clearDingTalkReplySink = (threadId: string): void => {
  liveSinks.delete(threadId);
  clearRegisteredThinkingTimer(threadId);
  // Queue-mode completion / waiting can land on a replica that does not own
  // the timer. The flag lets that timer skip 「正在思考…」.
  void markDingTalkTurnDone(threadId);
};

export interface DingTalkChoiceEntry {
  command: string;
  label: string;
}

const markdownTitle = (text: string): string => {
  const line = text.split('\n').find((item) => item.trim());
  if (!line) return DINGTALK_MARKDOWN_TITLE_FALLBACK;
  return line.replace(/^#+\s*/, '').slice(0, 32) || DINGTALK_MARKDOWN_TITLE_FALLBACK;
};

const attachGroupAtUserIds = (msgParam: string, staffId: string): string => {
  try {
    const parsed: unknown = JSON.parse(msgParam);
    if (!isRecord(parsed)) return msgParam;
    return JSON.stringify({ ...parsed, at: { atUserIds: [staffId] } });
  } catch {
    return msgParam;
  }
};

export const wrapDingTalkAskerCommand = (
  command: string,
  askerStaffId: string,
  isGroup: boolean,
): string => {
  if (!isGroup || !askerStaffId) return command;
  const rest = command.startsWith('messenger:') ? command.slice('messenger:'.length) : command;
  return `messenger:asker:${askerStaffId}:${rest}`;
};

export const parseDingTalkAskerCommand = (
  text: string,
): { askerStaffId?: string; command: string } => {
  const trimmed = text.trim();
  const match = trimmed.match(/^messenger:asker:([^:]+):([\s\S]+)$/);
  if (match) {
    const rest = match[2];
    return {
      askerStaffId: match[1],
      command: rest.startsWith('messenger:') ? rest : `messenger:${rest}`,
    };
  }
  return { command: trimmed };
};

const resolveSendTarget = (threadId: string) => {
  const decoded = decodeDingTalkThreadId(threadId);
  const session = getDingTalkSession(threadId) ?? getDingTalkSession(decoded.conversationId);
  const isGroup = Boolean(decoded.senderStaffId);
  const staffId = decoded.senderStaffId || session?.senderStaffId || '';
  return { decoded, isGroup, session, staffId };
};

const recallDingTalkMessage = async (
  api: DingTalkApiClient,
  params: {
    isGroup: boolean;
    openConversationId: string;
    processQueryKey: string | undefined;
    robotCode: string;
  },
): Promise<void> => {
  if (!params.processQueryKey) return;
  try {
    await api.recallMessage({
      openConversationId: params.isGroup ? params.openConversationId : undefined,
      processQueryKeys: [params.processQueryKey],
      robotCode: params.robotCode,
    });
  } catch (error) {
    log('recallDingTalkMessage failed: %O', error);
  }
};

export const sendDingTalkMarkdown = async (
  threadId: string,
  text: string,
  options?: { beforeChunk?: () => Promise<boolean>; recallable?: boolean; staffId?: string },
): Promise<string | undefined> => {
  if (!text) return;
  const config = await getMessengerDingTalkConfig();
  if (!config) return;
  const api = apiFor(config);
  const resolved = resolveSendTarget(threadId);
  const { decoded, isGroup, session } = resolved;
  const staffId = options?.staffId || resolved.staffId;
  // sampleMarkdown shows GFM tables as raw pipes. Convert before chunking.
  // Already-converted text is unchanged (the helper is idempotent).
  const chunks = chunkMarkdown(convertGfmTablesForDingTalk(text));
  let processQueryKey: string | undefined;
  for (const chunk of chunks) {
    if (options?.beforeChunk && !(await options.beforeChunk())) {
      log('sendDingTalkMarkdown aborted before chunk threadId=%s', threadId);
      break;
    }
    const title = markdownTitle(chunk);
    const body =
      isGroup && staffId && !chunk.includes(`@${staffId}`) ? `@${staffId} ${chunk}` : chunk;
    try {
      // Session webhooks do not return `processQueryKey`, so skip them when
      // the caller needs to recall this message later (thinking placeholder).
      if (!options?.recallable && isSessionWebhookLive(session) && session?.sessionWebhook) {
        const payload: Record<string, unknown> = {
          markdown: { text: body, title },
          msgtype: 'markdown',
        };
        if (isGroup && staffId) payload.at = { atUserIds: [staffId] };
        await api.sendBySessionWebhook(session.sessionWebhook, payload);
        continue;
      }
      const msgParamObj: Record<string, unknown> = { text: body, title };
      if (isGroup && staffId) msgParamObj.at = { atUserIds: [staffId] };
      const msgParam = JSON.stringify(msgParamObj);
      const sent = isGroup
        ? await api.sendGroupMessage({
            msgKey: 'sampleMarkdown',
            msgParam,
            openConversationId: decoded.conversationId,
            robotCode: config.robotCode,
          })
        : await api.sendOtoMessage({
            msgKey: 'sampleMarkdown',
            msgParam,
            robotCode: config.robotCode,
            // Prefer an explicit staffId (web-turn mirror) so a stale DM
            // never sends `userIds: [conversationId]` (`cid…` is not a userid).
            userIds: [staffId || decoded.conversationId],
          });
      if (sent.processQueryKey) processQueryKey = sent.processQueryKey;
    } catch (error) {
      log('sendDingTalkMarkdown failed: %O', error);
    }
  }
  return processQueryKey;
};

const isHttpsUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
};

/**
 * Single-button actionCard on this thread's live session webhook.
 * Does not fall back to a billed robot API. `singleURL` must be https.
 */
export const sendDingTalkActionCardToThread = async (
  threadId: string,
  card: { singleTitle: string; singleURL: string; text: string; title: string },
): Promise<{ sent: true; via: 'session' } | { sent: false }> => {
  try {
    const singleURL = card.singleURL.trim();
    if (!isHttpsUrl(singleURL)) return { sent: false };
    const trimmedThread = threadId.trim();
    if (!trimmedThread) return { sent: false };

    const { session } = resolveSendTarget(trimmedThread);
    if (!isSessionWebhookLive(session) || !session?.sessionWebhook) return { sent: false };

    const config = await getMessengerDingTalkConfig();
    if (!config) return { sent: false };

    const api = apiFor(config);
    await api.sendBySessionWebhook(session.sessionWebhook, {
      msgtype: 'actionCard',
      actionCard: {
        title: card.title,
        text: card.text,
        singleTitle: card.singleTitle,
        singleURL,
      },
    });
    return { sent: true, via: 'session' };
  } catch (error) {
    log('sendDingTalkActionCardToThread failed: %O', error);
    return { sent: false };
  }
};

const lastListKindFromPagePrefix = (
  pageCommandPrefix: string | undefined,
): DingTalkLastListKind | null => {
  if (pageCommandPrefix === 'messenger:agents:page:') return 'agents';
  if (pageCommandPrefix === 'messenger:topics:page:') return 'topics';
  if (pageCommandPrefix === 'messenger:question:page:') return 'question';
  return null;
};

const rememberDingTalkChoiceList = async (
  threadId: string,
  pageCommandPrefix: string | undefined,
): Promise<void> => {
  const kind = lastListKindFromPagePrefix(pageCommandPrefix);
  if (!kind) return;
  await setDingTalkLastList(threadId, kind);
};

const sendActionCard = async (params: {
  buttons: DingTalkChoiceEntry[];
  text: string;
  threadId: string;
  title: string;
}): Promise<boolean> => {
  const config = await getMessengerDingTalkConfig();
  if (!config) return false;
  const api = apiFor(config);
  const { staffId, decoded, isGroup } = resolveSendTarget(params.threadId);
  const text =
    isGroup && staffId && !params.text.includes(`@${staffId}`)
      ? `@${staffId} ${params.text}`
      : params.text;
  const card = buildActionCardParam({
    buttons: params.buttons.slice(0, 5),
    text,
    title: params.title,
  });
  const msgParam =
    isGroup && staffId ? attachGroupAtUserIds(card.msgParam, staffId) : card.msgParam;
  try {
    if (isGroup) {
      await api.sendGroupMessage({
        msgKey: card.msgKey,
        msgParam,
        openConversationId: decoded.conversationId,
        robotCode: config.robotCode,
      });
      return true;
    }
    await api.sendOtoMessage({
      msgKey: card.msgKey,
      msgParam,
      robotCode: config.robotCode,
      userIds: [staffId || decoded.conversationId],
    });
    return true;
  } catch (error) {
    log('sendActionCard failed: %O', error);
    await sendDingTalkMarkdown(
      params.threadId,
      `${text}\n${params.buttons.map((b) => `• ${b.label}`).join('\n')}`,
    );
    return true;
  }
};

const sendDingTalkCommandCard = async (params: {
  text: string;
  threadId: string;
  title: string;
}): Promise<void> => {
  await sendActionCard({
    buttons: DINGTALK_COMMAND_SHORTCUT_BUTTONS,
    text: params.text,
    threadId: params.threadId,
    title: params.title,
  });
};

export const sendDingTalkWelcomeCard = async (threadId: string): Promise<void> => {
  const displayName = await resolveDingTalkBrandingDisplayName();
  await sendDingTalkCommandCard({
    text: DINGTALK_WELCOME_TEXT,
    threadId,
    title: formatDingTalkWelcomeTitle(displayName),
  });
};

export const sendDingTalkHelpReply = async (threadId: string): Promise<void> => {
  await sendDingTalkMarkdown(threadId, DINGTALK_HELP_TEXT);
  await sendDingTalkCommandCard({
    text: DINGTALK_COMMAND_CARD_TEXT,
    threadId,
    title: DINGTALK_COMMAND_CARD_TITLE,
  });
};

export const sendDingTalkUnknownCommandReply = async (threadId: string): Promise<void> => {
  await sendDingTalkMarkdown(threadId, DINGTALK_UNKNOWN_COMMAND_REPLY);
  await sendDingTalkCommandCard({
    text: DINGTALK_COMMAND_CARD_TEXT,
    threadId,
    title: DINGTALK_COMMAND_CARD_TITLE,
  });
};

const sendSelectCard = async (params: {
  askerStaffId: string;
  buttons: DingTalkChoiceEntry[];
  templateId: string;
  text: string;
  threadId: string;
  title: string;
}): Promise<boolean> => {
  const config = await getMessengerDingTalkConfig();
  if (!config) return false;
  const api = apiFor(config);
  const { decoded, isGroup, staffId } = resolveSendTarget(params.threadId);
  const outTrackId = `select-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    await api.createAndDeliverCard({
      cardData: {
        cardParamMap: {
          content: `${params.text}\n${params.buttons.map((b, i) => `${i + 1}. ${b.label}`).join('\n')}`,
          options: JSON.stringify(
            params.buttons.map((b) => ({ label: b.label, value: b.command })),
          ),
          title: params.title,
        },
      },
      cardTemplateId: params.templateId,
      openConversationId: isGroup ? decoded.conversationId : undefined,
      outTrackId,
      robotCode: config.robotCode,
      staffId: staffId || params.askerStaffId,
    });
    rememberDingTalkCard(outTrackId, {
      askerStaffId: params.askerStaffId || staffId,
      conversationId: decoded.conversationId,
      conversationType: isGroup ? '2' : '1',
      threadId: params.threadId,
    });
    return true;
  } catch (error) {
    log('sendSelectCard failed, falling back to ActionCard: %O', error);
    return false;
  }
};

export const paginateEntries = <T>(
  entries: T[],
  page: number,
  pageSize = DINGTALK_LIST_PAGE_SIZE,
) => {
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const current = Math.min(Math.max(page, 1), totalPages);
  const start = (current - 1) * pageSize;
  return {
    current,
    items: entries.slice(start, start + pageSize),
    totalPages,
  };
};

export const sendDingTalkChoiceList = async (params: {
  askerStaffId: string;
  entries: DingTalkChoiceEntry[];
  page?: number;
  pageCommandPrefix?: string;
  text: string;
  threadId: string;
  title: string;
}): Promise<void> => {
  const isGroup = Boolean(decodeDingTalkThreadId(params.threadId).senderStaffId);
  const page = params.page ?? 1;
  const paged = paginateEntries(params.entries, page);
  const buttons: DingTalkChoiceEntry[] = paged.items.map((entry) => ({
    command: wrapDingTalkAskerCommand(entry.command, params.askerStaffId, isGroup),
    label: entry.label,
  }));
  if (paged.totalPages > 1 && paged.current < paged.totalPages && params.pageCommandPrefix) {
    const nextCommand = `${params.pageCommandPrefix}${paged.current + 1}`;
    buttons.push({
      command: wrapDingTalkAskerCommand(nextCommand, params.askerStaffId, isGroup),
      label: '下一页',
    });
  }

  const text =
    paged.totalPages > 1 ? `${params.text}\n(${paged.current}/${paged.totalPages})` : params.text;

  const config = await getMessengerDingTalkConfig();
  if (config?.selectCardTemplateId) {
    const sent = await sendSelectCard({
      askerStaffId: params.askerStaffId,
      buttons,
      templateId: config.selectCardTemplateId,
      text,
      threadId: params.threadId,
      title: params.title,
    });
    if (sent) {
      await rememberDingTalkChoiceList(params.threadId, params.pageCommandPrefix);
      return;
    }
  }

  const actionSent = await sendActionCard({
    buttons,
    text,
    threadId: params.threadId,
    title: params.title,
  });
  if (actionSent) {
    await rememberDingTalkChoiceList(params.threadId, params.pageCommandPrefix);
  }
};

const sendOutboundAttachments = async (
  threadId: string,
  attachments: DingTalkOutboundAttachment[] | undefined,
): Promise<void> => {
  const outbound = mapOutboundAttachments(attachments);
  if (!outbound.length) return;
  const config = await getMessengerDingTalkConfig();
  if (!config) return;
  const api = apiFor(config);
  const { decoded, isGroup, session, staffId } = resolveSendTarget(threadId);
  try {
    await sendDingTalkAttachments(
      api,
      {
        openConversationId: isGroup ? decoded.conversationId : undefined,
        robotCode: config.robotCode,
        sessionWebhook: isSessionWebhookLive(session) ? session?.sessionWebhook : undefined,
        userIds: !isGroup && staffId ? [staffId] : undefined,
      },
      outbound,
    );
  } catch (error) {
    log('sendOutboundAttachments failed: %O', error);
  }
};

export const createDingTalkReplySink = async (
  threadId: string,
): Promise<AgentReplySink | undefined> => {
  const config = await getMessengerDingTalkConfig();
  if (!config) return undefined;

  const { decoded, isGroup, staffId } = resolveSendTarget(threadId);
  const api = apiFor(config);
  let mode: 'card' | 'text' = config.aiCardTemplateId ? 'card' : 'text';
  let stream: DingTalkAiCardStream | undefined;
  let finalized = false;
  let thinkingProcessQueryKey: string | undefined;
  let replyClosed = false;
  let thinkingTimer: ReturnType<typeof setTimeout> | undefined;
  let thinkingFlight: Promise<void> | undefined;
  let turnEpoch: number | null = null;

  clearRegisteredThinkingTimer(threadId);

  const recallThinking = async () => {
    const key = thinkingProcessQueryKey;
    thinkingProcessQueryKey = undefined;
    await recallDingTalkMessage(api, {
      isGroup,
      openConversationId: decoded.conversationId,
      processQueryKey: key,
      robotCode: config.robotCode,
    });
  };

  const sendThinkingPlaceholder = async () => {
    if (replyClosed) return;
    const doneEpoch = await readDingTalkTurnDoneEpoch(threadId);
    // Skip when this turn (or a later one) already finished on any replica.
    if (turnEpoch !== null && doneEpoch !== null && doneEpoch >= turnEpoch) return;
    if (replyClosed) return;
    const key = await sendDingTalkMarkdown(threadId, DINGTALK_THINKING_REPLY, {
      recallable: true,
    });
    if (replyClosed) {
      if (key) {
        await recallDingTalkMessage(api, {
          isGroup,
          openConversationId: decoded.conversationId,
          processQueryKey: key,
          robotCode: config.robotCode,
        });
      }
      return;
    }
    thinkingProcessQueryKey = key;
  };

  const disarmThinkingTimer = () => {
    const local = thinkingTimer;
    thinkingTimer = undefined;
    if (local) clearTimeout(local);
    clearRegisteredThinkingTimer(threadId);
  };

  const armThinkingTimer = () => {
    if (replyClosed || thinkingTimer || thinkingFlight) return;
    const timer = setTimeout(() => {
      if (thinkingTimer === timer) thinkingTimer = undefined;
      if (thinkingTimers.get(threadId) === timer) thinkingTimers.delete(threadId);
      if (replyClosed) return;
      thinkingFlight = sendThinkingPlaceholder().finally(() => {
        thinkingFlight = undefined;
      });
    }, DINGTALK_THINKING_DELAY_MS);
    thinkingTimer = timer;
    thinkingTimers.set(threadId, timer);
  };

  const finishTextReply = async (text: string) => {
    replyClosed = true;
    disarmThinkingTimer();
    if (thinkingFlight) await thinkingFlight;
    await recallThinking();
    await sendDingTalkMarkdown(threadId, text);
  };

  const fallbackToText = async (content?: string) => {
    mode = 'text';
    if (content === DINGTALK_THINKING_REPLY) {
      await sendThinkingPlaceholder();
      return;
    }
    if (content) await sendDingTalkMarkdown(threadId, content);
  };

  const finalizeCard = async (content: string) => {
    if (finalized) return;
    finalized = true;
    if (!stream) return;
    try {
      // Replace first so the card body is the answer even if DingTalk's
      // streaming-finish call only flips the streaming flag.
      await stream.replace(content);
      await stream.finalize(content);
    } catch (error) {
      log('finalizeCard failed, falling back to text: %O', error);
      mode = 'text';
      await sendDingTalkMarkdown(threadId, content);
    }
  };

  const sink: AgentReplySink = {
    onComplete: async (content, extras) => {
      replyClosed = true;
      disarmThinkingTimer();
      await markDingTalkTurnDone(threadId);
      // Whitespace-only is not a real answer — recall/finalize still run,
      // but markdown send no-ops on falsy text instead of a blank bubble.
      const text = content.trim() ? content : '';
      if (mode === 'card') {
        await finalizeCard(text);
      } else {
        await finishTextReply(text);
      }
      if (extras?.attachments?.length) {
        await sendOutboundAttachments(threadId, extras.attachments);
      }
    },
    onError: async (errorText) => {
      replyClosed = true;
      disarmThinkingTimer();
      await markDingTalkTurnDone(threadId);
      const text = errorText || '执行失败';
      if (mode === 'card') {
        await finalizeCard(text);
        return;
      }
      await finishTextReply(text);
    },
    onPartial: async (content) => {
      await refreshDingTalkTurnEpochTtl(threadId);
      if (mode !== 'card' || !stream || finalized) return;
      try {
        await stream.replace(content);
      } catch (error) {
        if (error instanceof DingTalkCardUnavailableError) {
          await fallbackToText();
          return;
        }
        log('onPartial failed: %O', error);
      }
    },
    onStart: async () => {
      turnEpoch = await bumpDingTalkTurnEpoch(threadId);
      if (mode !== 'card' || !config.aiCardTemplateId) {
        mode = 'text';
        armThinkingTimer();
        return;
      }
      stream = new DingTalkAiCardStream(api, {
        cardTemplateId: config.aiCardTemplateId,
        conversationId: decoded.conversationId,
        openConversationId: isGroup ? decoded.conversationId : undefined,
        robotCode: config.robotCode,
        staffId: staffId || undefined,
      });
      try {
        await stream.create(DINGTALK_THINKING_REPLY);
      } catch (error) {
        log('AI card create failed, falling back to text: %O', error);
        await fallbackToText(DINGTALK_THINKING_REPLY);
      }
    },
  };
  liveSinks.set(threadId, sink);
  return sink;
};
