import { buildSampleActionCardParam, DingTalkApiClient } from '@lobechat/chat-adapter-dingtalk';
import { decodeDingTalkThreadId } from '@lobechat/chat-adapter-dingtalk/threadId';
import { APP_LINK_PATHS, cliSettingsMarkdownLink, markdownLink } from '@lobechat/utils/appLink';
import debug from 'debug';

import { getMessengerDingTalkConfig } from '@/config/messenger';
import type { LobeChatDatabase } from '@/database/type';
import { isDingtalkVerificationUrl } from '@/server/enterprise/services/dingtalkPersonal/brokerClient';
import { requireVerifiedDingtalkIdentity } from '@/server/enterprise/services/dingtalkWorkspace/identity';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { serverAppLink } from '@/server/utils/appLinks';

import { sendDingTalkActionCardToThread } from './cards';
import { incrementDingTalkDailyCounter } from './redis';

const log = debug('lobe-server:messenger:dingtalk:personal-auth');

const AUTH_CARD_TITLE = '授权 AI 助手读取钉钉个人数据';
const AUTH_CARD_BUTTON = '去授权';
const AUTH_CARD_KEY_PREFIX = 'dingtalk-personal:authcard:';
/** 1:1 robot fallback, distinct from any session thread id. */
const OTO_DESTINATION = 'oto';
/** Same window as the login job key. */
const AUTH_CARD_TTL_SECONDS = 20 * 60;

const SUCCESS_TITLE = '钉钉个人数据授权成功';
const SUCCESS_TEXT = '钉钉个人数据授权成功，可以继续提问了';
const FAILURE_TITLE = '钉钉个人数据授权未完成';

export interface DingtalkPersonalAuthLogin {
  expiresAt: string;
  jobId: string;
  userCode: string;
  verificationUrl: string;
}

export interface SendDingtalkPersonalAuthCardParams {
  db: LobeChatDatabase;
  login: DingtalkPersonalAuthLogin;
  staffId: string;
  /** Chat-sdk thread id. Session webhook is tried before the 1:1 robot card. */
  threadId?: string;
  userId: string;
}

export interface DingtalkPersonalAuthCardResult {
  sent: boolean;
  /** Set only when this call delivered the card. Omitted on a Redis NX hit. */
  via?: 'session' | 'oto';
}

export interface NotifyDingtalkPersonalLoginResultParams {
  db: LobeChatDatabase;
  errorCode?: string;
  ok: boolean;
  staffId: string;
  userId: string;
  userName?: string;
}

const formatShanghaiHm = (iso: string): string | undefined => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;
  if (!hour || !minute) return undefined;
  return `${hour}:${minute}`;
};

const buildAuthCardMarkdown = (login: DingtalkPersonalAuthLogin): string => {
  const code = login.userCode?.trim() || '（未返回）';
  const expiry = formatShanghaiHm(login.expiresAt);
  const expiryLine = expiry ? `有效期：到 ${expiry}` : '有效期：请尽快完成授权';
  return [
    '授权后，AI 助手可以读取：',
    '- 你的待办',
    '- 你所在群的聊天记录',
    '- 工作日志',
    '',
    `验证码：${code}`,
    expiryLine,
    '',
    '点下方「去授权」→ 选择公司 → 同意',
    '',
    '之后每次写操作仍需要一张确认卡片，你同意后才会执行。',
  ].join('\n');
};

/**
 * Group threads carry `senderStaffId` (the asker). A group conversation id may
 * itself contain colons, so the codec — not a 3-part split — decides.
 */
const isGroupAuthThread = (threadId: string): boolean =>
  Boolean(decodeDingTalkThreadId(threadId).senderStaffId);

const groupClickPrefix = (name: string | undefined): string => {
  const who = name?.trim();
  return who ? `仅 ${who} 本人点击（别人点击不会生效）` : '仅本人点击（别人点击不会生效）';
};

/** Never throws. A failed lookup still sends the card, without a name. */
const lookupAskerName = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<string | undefined> => {
  try {
    const identity = await requireVerifiedDingtalkIdentity(db, userId);
    return identity.name?.trim() || undefined;
  } catch (error) {
    log('auth card name lookup failed user=%s: %O', userId, error);
    return undefined;
  }
};

const buildAuthCardText = async (params: SendDingtalkPersonalAuthCardParams): Promise<string> => {
  const body = buildAuthCardMarkdown(params.login);
  const threadId = params.threadId?.trim() ?? '';
  if (!isGroupAuthThread(threadId)) return body;
  const name = await lookupAskerName(params.db, params.userId);
  return `${groupClickPrefix(name)}\n\n${body}`;
};

const reauthorizeLink = (): string =>
  markdownLink('重新授权', serverAppLink(APP_LINK_PATHS.dingtalkPersonalAuthorize, 'dingtalk'));

const loginFailureText = (errorCode: string | undefined, userName: string | undefined): string => {
  switch (errorCode) {
    case 'IDENTITY_MISMATCH': {
      const who = userName?.trim();
      const again = `请用本人钉钉账号重新授权（${reauthorizeLink()}）`;
      return who ? `你授权的是 ${who} 的账号，${again}` : `你授权的不是本人钉钉账号，${again}`;
    }
    case 'ORG_CLI_DISABLED': {
      return `贵司钉钉管理员未开放该功能给 CLI（开发者后台 → ${cliSettingsMarkdownLink()}），请联系管理员`;
    }
    case 'LOGIN_TIMEOUT': {
      return `授权超时了，请${reauthorizeLink()}`;
    }
    case 'LOGIN_FAILED': {
      return '钉钉个人数据授权失败，请稍后重试';
    }
    default: {
      return '钉钉个人数据授权未完成，请稍后重试';
    }
  }
};

const authorizePageUrl = (): string =>
  serverAppLink(APP_LINK_PATHS.dingtalkPersonalAuthorize, 'dingtalk');

/**
 * Device-login link when it is https on a DingTalk host; otherwise the app
 * authorize page. Callers still refuse to send a button that is not https.
 */
const authButtonUrl = (verificationUrl: string): string =>
  isDingtalkVerificationUrl(verificationUrl) ? verificationUrl.trim() : authorizePageUrl();

const authCardRedisKey = (jobId: string, destination: string): string =>
  `${AUTH_CARD_KEY_PREFIX}${jobId}:${destination}`;

/**
 * NX claim for one login job and one destination (session thread id, or `oto`).
 * Redis down or a set error is fail-open (`open`): send anyway. `null` means
 * another sender already claimed this job for this destination.
 */
const claimAuthCard = async (
  jobId: string,
  destination: string,
): Promise<'claimed' | 'duplicate' | 'open'> => {
  const id = jobId.trim();
  const dest = destination.trim();
  if (!id || !dest) return 'open';
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return 'open';
  const key = authCardRedisKey(id, dest);
  try {
    const result = await redis.set(key, '1', 'EX', AUTH_CARD_TTL_SECONDS, 'NX');
    if (result === 'OK') return 'claimed';
    if (result === null) return 'duplicate';
    log('auth card dedupe unexpected result jobId=%s dest=%s', id, dest);
    return 'open';
  } catch (error) {
    log('auth card dedupe failed jobId=%s dest=%s: %O', id, dest, error);
    return 'open';
  }
};

const releaseAuthCard = async (jobId: string, destination: string): Promise<void> => {
  const id = jobId.trim();
  const dest = destination.trim();
  if (!id || !dest) return;
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  try {
    await redis.del(authCardRedisKey(id, dest));
  } catch (error) {
    log('auth card dedupe release failed jobId=%s dest=%s: %O', id, dest, error);
  }
};

const sendRobotOto = async (params: {
  msgKey: string;
  msgParam: string;
  staffId: string;
  userId: string;
}): Promise<boolean> => {
  const config = await getMessengerDingTalkConfig();
  if (!config?.clientId || !config.clientSecret || !config.robotCode) {
    log('skip: messenger dingtalk config missing user=%s', params.userId);
    return false;
  }
  if (!params.staffId.trim()) {
    log('skip: missing staffId user=%s', params.userId);
    return false;
  }
  const api = new DingTalkApiClient(config.clientId, config.clientSecret);
  await api.sendOtoMessage({
    msgKey: params.msgKey,
    msgParam: params.msgParam,
    robotCode: config.robotCode,
    userIds: [params.staffId.trim()],
  });
  await incrementDingTalkDailyCounter('pushes');
  return true;
};

/**
 * ActionCard for a device-login the user just started.
 * Prefers the current thread's session webhook (not a billed OpenAPI call).
 * Falls back to the 1:1 robot sampleActionCard. Does not consult
 * `pushEnabled` or the notify-app channels. Never throws.
 *
 * A duplicate jobId+destination (Redis NX hit) returns `{ sent: true }` without
 * `via` — this call did not send. Asking again in another thread still delivers
 * there. A failed send releases that destination's key.
 */
export const sendDingtalkPersonalAuthCard = async (
  params: SendDingtalkPersonalAuthCardParams,
): Promise<DingtalkPersonalAuthCardResult> => {
  let threadClaim: 'claimed' | 'duplicate' | 'open' = 'open';
  let otoClaim: 'claimed' | 'duplicate' | 'open' = 'open';
  let jobId = '';
  let threadId = '';
  try {
    const staffId = params.staffId?.trim() ?? '';
    const rawUrl = params.login?.verificationUrl?.trim() ?? '';
    threadId = params.threadId?.trim() ?? '';
    jobId = params.login?.jobId?.trim() ?? '';
    if (!staffId) {
      log('skip auth card user=%s jobId=%s', params.userId, jobId);
      return { sent: false };
    }
    const buttonUrl = authButtonUrl(rawUrl);
    if (!/^https:\/\//i.test(buttonUrl)) {
      log('skip auth card: no https url user=%s jobId=%s', params.userId, jobId);
      return { sent: false };
    }
    const config = await getMessengerDingTalkConfig();
    const canOto = Boolean(config?.clientId && config.clientSecret && config.robotCode);
    if (!threadId && !canOto) {
      log('skip auth card: messenger dingtalk config missing user=%s', params.userId);
      return { sent: false };
    }

    if (threadId) {
      threadClaim = await claimAuthCard(jobId, threadId);
      if (threadClaim === 'duplicate') return { sent: true };
    }

    const login = { ...params.login, verificationUrl: buttonUrl };
    const text = await buildAuthCardText({ ...params, login, threadId });
    const cardFields = {
      singleTitle: AUTH_CARD_BUTTON,
      singleURL: buttonUrl,
      text,
      title: AUTH_CARD_TITLE,
    };

    if (threadId) {
      try {
        const session = await sendDingTalkActionCardToThread(threadId, cardFields);
        if (session?.sent) return { sent: true, via: 'session' };
      } catch (error) {
        log('session auth card failed user=%s jobId=%s: %O', params.userId, jobId, error);
      }
      if (threadClaim === 'claimed') await releaseAuthCard(jobId, threadId);
      threadClaim = 'open';
    }

    if (!canOto) {
      log(
        'skip auth card: session webhook not sent and robot config missing user=%s',
        params.userId,
      );
      return { sent: false };
    }

    otoClaim = await claimAuthCard(jobId, OTO_DESTINATION);
    if (otoClaim === 'duplicate') return { sent: true };

    const card = buildSampleActionCardParam(cardFields);
    const sent = await sendRobotOto({
      msgKey: card.msgKey,
      msgParam: card.msgParam,
      staffId,
      userId: params.userId,
    });
    if (!sent) {
      if (otoClaim === 'claimed') await releaseAuthCard(jobId, OTO_DESTINATION);
      otoClaim = 'open';
      return { sent: false };
    }
    return { sent: true, via: 'oto' };
  } catch (error) {
    log('sendDingtalkPersonalAuthCard failed user=%s jobId=%s: %O', params.userId, jobId, error);
    if (threadClaim === 'claimed') await releaseAuthCard(jobId, threadId);
    if (otoClaim === 'claimed') await releaseAuthCard(jobId, OTO_DESTINATION);
    return { sent: false };
  }
};

/**
 * 1:1 markdown after a DingTalk-originated device login reaches a terminal
 * state. Never throws.
 */
export const notifyDingtalkPersonalLoginResult = async (
  params: NotifyDingtalkPersonalLoginResultParams,
): Promise<{ sent: boolean }> => {
  const staffId = params.staffId?.trim() ?? '';
  if (!staffId) return { sent: false };
  const title = params.ok ? SUCCESS_TITLE : FAILURE_TITLE;
  const text = params.ok ? SUCCESS_TEXT : loginFailureText(params.errorCode, params.userName);
  try {
    const sent = await sendRobotOto({
      msgKey: 'sampleMarkdown',
      msgParam: JSON.stringify({ text, title }),
      staffId,
      userId: params.userId,
    });
    return { sent };
  } catch (error) {
    log('notifyDingtalkPersonalLoginResult failed user=%s: %O', params.userId, error);
    return { sent: false };
  }
};
