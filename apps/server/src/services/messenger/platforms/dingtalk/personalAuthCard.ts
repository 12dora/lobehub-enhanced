import { buildSampleActionCardParam, DingTalkApiClient } from '@lobechat/chat-adapter-dingtalk';
import debug from 'debug';

import { getMessengerDingTalkConfig } from '@/config/messenger';
import type { LobeChatDatabase } from '@/database/type';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import { incrementDingTalkDailyCounter } from './redis';

const log = debug('lobe-server:messenger:dingtalk:personal-auth');

const AUTH_CARD_TITLE = '授权 AI 助手读取钉钉个人数据';
const AUTH_CARD_BUTTON = '去授权';
const AUTH_CARD_KEY_PREFIX = 'dingtalk-personal:authcard:';
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
  userId: string;
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

const loginFailureText = (errorCode: string | undefined, userName: string | undefined): string => {
  switch (errorCode) {
    case 'IDENTITY_MISMATCH': {
      const who = userName?.trim();
      return who
        ? `你授权的是 ${who} 的账号，请用本人钉钉账号授权`
        : '你授权的不是本人钉钉账号，请用本人钉钉账号授权';
    }
    case 'ORG_CLI_DISABLED': {
      return '贵司钉钉管理员未开放该功能给 CLI（开发者后台 → CLI 设置），请联系管理员';
    }
    case 'LOGIN_TIMEOUT': {
      return '授权超时了，请重新发起授权';
    }
    case 'LOGIN_FAILED': {
      return '钉钉个人数据授权失败，请稍后重试';
    }
    default: {
      return '钉钉个人数据授权未完成，请稍后重试';
    }
  }
};

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

/**
 * NX claim for one login job. Redis down or a set error is fail-open (`open`):
 * send anyway. `null` means another sender already claimed this job.
 */
const claimAuthCard = async (jobId: string): Promise<'claimed' | 'duplicate' | 'open'> => {
  const id = jobId.trim();
  if (!id) return 'open';
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return 'open';
  const key = `${AUTH_CARD_KEY_PREFIX}${id}`;
  try {
    const result = await redis.set(key, '1', 'EX', AUTH_CARD_TTL_SECONDS, 'NX');
    if (result === 'OK') return 'claimed';
    if (result === null) return 'duplicate';
    log('auth card dedupe unexpected result jobId=%s', id);
    return 'open';
  } catch (error) {
    log('auth card dedupe failed jobId=%s: %O', id, error);
    return 'open';
  }
};

const releaseAuthCard = async (jobId: string): Promise<void> => {
  const id = jobId.trim();
  if (!id) return;
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  try {
    await redis.del(`${AUTH_CARD_KEY_PREFIX}${id}`);
  } catch (error) {
    log('auth card dedupe release failed jobId=%s: %O', id, error);
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
 * 1:1 robot ActionCard for a device-login the user just started.
 * Does not consult `pushEnabled` or the notify-app channels: this replies to
 * the user's own request. Never throws.
 *
 * A duplicate jobId (Redis NX hit) returns `{ sent: true }` — the card for
 * that login was already claimed. A failed send releases the key.
 */
export const sendDingtalkPersonalAuthCard = async (
  params: SendDingtalkPersonalAuthCardParams,
): Promise<{ sent: boolean }> => {
  let claim: 'claimed' | 'duplicate' | 'open' = 'open';
  let jobId = '';
  try {
    const staffId = params.staffId?.trim() ?? '';
    const verificationUrl = params.login?.verificationUrl?.trim() ?? '';
    jobId = params.login?.jobId?.trim() ?? '';
    if (!staffId || !isHttpUrl(verificationUrl)) {
      log('skip auth card user=%s jobId=%s', params.userId, jobId);
      return { sent: false };
    }
    const config = await getMessengerDingTalkConfig();
    if (!config?.clientId || !config.clientSecret || !config.robotCode) {
      log('skip auth card: messenger dingtalk config missing user=%s', params.userId);
      return { sent: false };
    }

    claim = await claimAuthCard(jobId);
    if (claim === 'duplicate') return { sent: true };

    const card = buildSampleActionCardParam({
      singleTitle: AUTH_CARD_BUTTON,
      singleURL: verificationUrl,
      text: buildAuthCardMarkdown(params.login),
      title: AUTH_CARD_TITLE,
    });
    const sent = await sendRobotOto({
      msgKey: card.msgKey,
      msgParam: card.msgParam,
      staffId,
      userId: params.userId,
    });
    if (!sent) {
      if (claim === 'claimed') await releaseAuthCard(jobId);
      return { sent: false };
    }
    return { sent: true };
  } catch (error) {
    log('sendDingtalkPersonalAuthCard failed user=%s jobId=%s: %O', params.userId, jobId, error);
    if (claim === 'claimed') await releaseAuthCard(jobId);
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
