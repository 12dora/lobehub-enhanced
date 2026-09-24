import { buildSampleActionCardParam } from '@lobechat/chat-adapter-dingtalk';
import debug from 'debug';

import { getMessengerDingTalkConfig } from '@/config/messenger';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { isModuleEnabled } from '@/server/enterprise/services/moduleSettings';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import type { MessengerPushMessage, MessengerPushProvider, MessengerPushResult } from '../../push';
import { registerMessengerPushProvider } from '../../push';
import { resolveDingTalkBrandingDisplayName } from './branding';
import { DINGTALK_CORP_ID_KEY, formatDingTalkViewInBrandingLabel } from './const';
import {
  buildNotifyRobotMarkdown,
  buildOaWorkNoticePayload,
  isNotifyChannelEnabled,
  NOTIFY_CHANNEL_DISABLED,
  readNotifyAppFromMessengerConfig,
  resolveWorkNoticeHeadText,
  sendRobotMessage,
  sendWorkNotice,
} from './notifyApp';
import { incrementDingTalkDailyCounter } from './redis';
import { resolveDingTalkStaffId } from './resolveStaffId';
import { sharedDingTalkApiClient } from './tokenCache';

const log = debug('lobe-server:messenger:dingtalk:push');

const DINGTALK_SSO_PATH = '/dingtalk/sso';
const DINGTALK_SSO_REDIRECT_PREFIX = `${DINGTALK_SSO_PATH}?redirect=`;

const emptyToNull = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const appUrlBase = (): string => (appEnv.APP_URL || '').replace(/\/$/, '');

const appUrlOrigin = (): string | null => {
  const base = appUrlBase();
  if (!base) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
};

/**
 * Same-origin app path only. Root-relative (`/…`, not `//…`) or an absolute URL
 * whose origin matches `APP_URL`. Protocol-relative and cross-origin inputs
 * return null so the caller can omit the button.
 */
const toAppPath = (actionUrl: string): string | null => {
  const trimmed = actionUrl.trim();
  if (!trimmed || trimmed.startsWith('//')) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const origin = appUrlOrigin();
      if (!origin || parsed.origin !== origin) return null;
      return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
    } catch {
      return null;
    }
  }

  if (!trimmed.startsWith('/')) return null;
  return trimmed;
};

const isOurDingTalkSsoRedirectPath = (path: string): boolean =>
  path.startsWith(DINGTALK_SSO_REDIRECT_PREFIX);

/**
 * Wrap a same-origin app path as `${APP_URL}/dingtalk/sso?redirect=…`.
 * Already-wrapped paths (`/dingtalk/sso?redirect=` or the same under APP_URL)
 * are returned as-is. Unsafe / cross-origin inputs return null.
 */
const wrapDingTalkSsoRedirect = (actionUrl: string): string | null => {
  const path = toAppPath(actionUrl);
  if (!path) return null;
  const wrapped = isOurDingTalkSsoRedirectPath(path)
    ? path
    : `${DINGTALK_SSO_PATH}?redirect=${encodeURIComponent(path)}`;
  const base = appUrlBase();
  return base ? `${base}${wrapped}` : wrapped;
};

/**
 * Open an https URL inside the DingTalk micro-app container.
 * `agentId` is the numeric AgentId (not prefixed with `0_`). A pasted `0_<id>`
 * is normalised so `app_id` does not become `0_0_…`.
 */
export const buildDingTalkOpenAppUrl = (params: {
  agentId: string;
  corpId: string;
  url: string;
}): string => {
  const trimmedAgentId = params.agentId.trim();
  const agentId = trimmedAgentId.startsWith('0_') ? trimmedAgentId.slice(2) : trimmedAgentId;
  const corpId = params.corpId.trim();
  const query = [
    `corpid=${encodeURIComponent(corpId)}`,
    'container_type=work_platform',
    `app_id=${encodeURIComponent(`0_${agentId}`)}`,
    'redirect_type=jump',
    `redirect_url=${encodeURIComponent(params.url)}`,
  ].join('&');
  return `dingtalk://dingtalkclient/action/openapp?${query}`;
};

const readRedisCorpId = async (): Promise<string | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;
  try {
    const value = await redis.get(DINGTALK_CORP_ID_KEY);
    return emptyToNull(typeof value === 'string' ? value : null);
  } catch (error) {
    log('readRedisCorpId failed: %O', error);
    return null;
  }
};

const wrapDingTalkPushButtonUrl = async (
  actionUrl: string,
  config: { agentId: string | null; corpId: string | null },
): Promise<string | null> => {
  const httpsSso = wrapDingTalkSsoRedirect(actionUrl);
  if (!httpsSso) return null;

  const agentId = emptyToNull(config.agentId);
  if (!agentId || !/^https?:\/\//i.test(httpsSso)) return httpsSso;

  const corpId = emptyToNull(config.corpId) ?? (await readRedisCorpId());
  if (!corpId) return httpsSso;

  return buildDingTalkOpenAppUrl({ agentId, corpId, url: httpsSso });
};

const SHANGHAI_TZ = 'Asia/Shanghai';
const OA_EVENT_TITLE_MAX_CHARS = 12;

/** Contract §6 short event titles (≤ 12 chars). Long MessengerPushMessage titles map onto these. */
export const OA_TASK_EVENT_TITLES = {
  completed: '任务完成',
  runCompleted: '运行完成',
  runFailed: '运行失败',
  waiting: '等待处理',
} as const;

const LONG_TASK_LABEL_TO_SHORT: Array<readonly [string, string]> = [
  ['任务已完成一次运行', OA_TASK_EVENT_TITLES.runCompleted],
  ['任务运行失败', OA_TASK_EVENT_TITLES.runFailed],
  ['任务等待处理', OA_TASK_EVENT_TITLES.waiting],
  ['任务已完成', OA_TASK_EVENT_TITLES.completed],
];

const SHORT_TASK_EVENT_TITLES = new Set<string>(Object.values(OA_TASK_EVENT_TITLES));

const formatShanghaiClock = (date: Date): string =>
  new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    timeZone: SHANGHAI_TZ,
  }).format(date);

const taskNameFromPushMessage = (title: string, markdown: string): string => {
  const bold = /^\*\*(.+?)\*\*/.exec(markdown.trim());
  if (bold?.[1]?.trim()) return bold[1].trim();
  const sep = title.lastIndexOf(' · ');
  if (sep >= 0) {
    const rest = title.slice(sep + 3).trim();
    if (rest) return rest;
  }
  return title;
};

/**
 * OA `body.title` kind for task-lifecycle pushes. DingTalk overwrites `head.text`
 * with the 服务号 name, so the site title is prefixed here separately.
 */
export const shortTaskEventTitle = (title: string): string => {
  const trimmed = title.trim();
  if (!trimmed) return OA_TASK_EVENT_TITLES.completed;
  const prefix = trimmed.split(' · ')[0]?.trim() || trimmed;
  for (const [longLabel, short] of LONG_TASK_LABEL_TO_SHORT) {
    if (prefix === longLabel || prefix.startsWith(longLabel)) return short;
  }
  if (SHORT_TASK_EVENT_TITLES.has(prefix)) return prefix;
  return [...prefix].slice(0, OA_EVENT_TITLE_MAX_CHARS).join('');
};

/** DingTalk overwrites `oa.head.text`; app identity is carried in `body.title`. */
export const formatTaskOaBodyTitle = (headText: string, title: string): string =>
  `${headText} · ${shortTaskEventTitle(title)}`;

const clockFromMarkdownOrNow = (markdown: string, now: Date): string => {
  const match = /(\d{2}:\d{2})\s*$/.exec(markdown);
  return match?.[1] ?? formatShanghaiClock(now);
};

const oaMessageUrl = (url: string | null): string | undefined => {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url) || url.startsWith('dingtalk://')) return url;
  return undefined;
};

class DingTalkMessengerPushProvider implements MessengerPushProvider {
  readonly platform = 'dingtalk' as const;

  async pushToUser(params: {
    db: LobeChatDatabase;
    message: MessengerPushMessage;
    userId: string;
  }): Promise<MessengerPushResult> {
    if (!(await isModuleEnabled('dingtalkNotify'))) {
      return { reason: 'module_disabled', status: 'skipped' };
    }
    const config = await getMessengerDingTalkConfig();
    if (!config) return { reason: 'platform_disabled', status: 'skipped' };
    if (!config.pushEnabled) return { reason: 'push_disabled', status: 'skipped' };

    const staffId = await resolveDingTalkStaffId(params.db, params.userId);
    if (!staffId) return { reason: 'user_not_mapped', status: 'skipped' };

    const { actionUrl, markdown, title } = params.message;

    try {
      const wrappedUrl = actionUrl
        ? await wrapDingTalkPushButtonUrl(actionUrl, {
            agentId: config.agentId ?? null,
            corpId: config.corpId ?? null,
          })
        : null;
      const notifyApp = readNotifyAppFromMessengerConfig(config);
      if (notifyApp) {
        const workNoticeEnabled = isNotifyChannelEnabled(config.notifyApp?.notifyWorkNoticeEnabled);
        const robotEnabled = isNotifyChannelEnabled(config.notifyApp?.notifyRobotEnabled);
        if (!workNoticeEnabled && !robotEnabled) {
          console.info('[dingtalk-push] skip notify-app channels', {
            reason: NOTIFY_CHANNEL_DISABLED,
            userId: params.userId,
          });
          return { reason: NOTIFY_CHANNEL_DISABLED, status: 'skipped' };
        }

        const credentials = {
          agentId: notifyApp.agentId,
          appKey: notifyApp.appKey,
          appSecret: notifyApp.appSecret,
        };
        const headText = await resolveWorkNoticeHeadText();
        const kind = shortTaskEventTitle(title);
        const clock = clockFromMarkdownOrNow(markdown, new Date());
        const oa = buildOaWorkNoticePayload({
          content: markdown,
          form: [
            { key: '任务', value: taskNameFromPushMessage(title, markdown) },
            { key: '时间', value: clock },
          ],
          headText,
          messageUrl: oaMessageUrl(wrappedUrl),
          title: formatTaskOaBodyTitle(headText, title),
        });
        const robotMarkdown = buildNotifyRobotMarkdown({
          content: markdown,
          footer: clock,
          headText,
          kind,
        });

        let workError: unknown;
        let taskId: string | undefined;
        if (workNoticeEnabled) {
          try {
            const sent = await sendWorkNotice({ oa, staffIds: [staffId] }, { config: credentials });
            taskId = sent[0]?.taskId;
          } catch (error) {
            workError = error;
            log('work notice failed user=%s: %O', params.userId, error);
          }
        } else {
          console.info('[dingtalk-push] skip work notice', {
            reason: NOTIFY_CHANNEL_DISABLED,
            userId: params.userId,
          });
        }

        if (robotEnabled) {
          try {
            if (wrappedUrl) {
              await sendRobotMessage(
                {
                  actionCard: {
                    singleTitle: formatDingTalkViewInBrandingLabel(headText),
                    singleUrl: wrappedUrl,
                    text: robotMarkdown.text,
                    title: robotMarkdown.title,
                  },
                  staffIds: [staffId],
                },
                { config: credentials },
              );
            } else {
              await sendRobotMessage(
                { markdown: robotMarkdown, staffIds: [staffId] },
                { config: credentials },
              );
            }
          } catch (error) {
            console.warn('[dingtalk-push] notify-app robot send failed', {
              errorClass: error instanceof Error ? error.name : 'UnknownError',
              message: error instanceof Error ? error.message : String(error),
              userId: params.userId,
            });
            log('notify-app robot send failed user=%s: %O', params.userId, error);
            if (!workNoticeEnabled) {
              return {
                error: error instanceof Error ? error.message : String(error),
                status: 'failed',
              };
            }
          }
        } else {
          console.info('[dingtalk-push] skip notify-app robot', {
            reason: NOTIFY_CHANNEL_DISABLED,
            userId: params.userId,
          });
        }

        if (workError) {
          return {
            error: workError instanceof Error ? workError.message : String(workError),
            status: 'failed',
          };
        }
        await incrementDingTalkDailyCounter('pushes');
        return taskId ? { providerMessageId: taskId, status: 'sent' } : { status: 'sent' };
      }

      const api = sharedDingTalkApiClient({
        appKey: config.clientId,
        appSecret: config.clientSecret,
        robotCode: config.robotCode,
      });
      if (wrappedUrl) {
        const displayName = await resolveDingTalkBrandingDisplayName();
        const card = buildSampleActionCardParam({
          singleTitle: formatDingTalkViewInBrandingLabel(displayName),
          singleURL: wrappedUrl,
          text: markdown,
          title,
        });
        await api.sendOtoMessage({
          msgKey: card.msgKey,
          msgParam: card.msgParam,
          robotCode: config.robotCode,
          userIds: [staffId],
        });
      } else {
        await api.sendOtoMessage({
          msgKey: 'sampleMarkdown',
          msgParam: JSON.stringify({ text: markdown, title }),
          robotCode: config.robotCode,
          userIds: [staffId],
        });
      }
      await incrementDingTalkDailyCounter('pushes');
      return { status: 'sent' };
    } catch (error) {
      log('pushToUser failed user=%s: %O', params.userId, error);
      return { error: error instanceof Error ? error.message : String(error), status: 'failed' };
    }
  }
}

export const dingtalkMessengerPushProvider = new DingTalkMessengerPushProvider();

export const registerDingTalkMessengerPushProvider = (): void => {
  registerMessengerPushProvider(dingtalkMessengerPushProvider);
};

registerDingTalkMessengerPushProvider();
