import { buildSampleActionCardParam, DingTalkApiClient } from '@lobechat/chat-adapter-dingtalk';
import debug from 'debug';

import { getMessengerDingTalkConfig } from '@/config/messenger';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import type { MessengerPushMessage, MessengerPushProvider, MessengerPushResult } from '../../push';
import { registerMessengerPushProvider } from '../../push';
import { resolveDingTalkBrandingDisplayName } from './branding';
import { DINGTALK_CORP_ID_KEY, formatDingTalkViewInBrandingLabel } from './const';
import { incrementDingTalkDailyCounter } from './redis';
import { resolveDingTalkStaffId } from './resolveStaffId';

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

class DingTalkMessengerPushProvider implements MessengerPushProvider {
  readonly platform = 'dingtalk' as const;

  async pushToUser(params: {
    db: LobeChatDatabase;
    message: MessengerPushMessage;
    userId: string;
  }): Promise<MessengerPushResult> {
    const config = await getMessengerDingTalkConfig();
    if (!config) return { reason: 'platform_disabled', status: 'skipped' };
    if (!config.pushEnabled) return { reason: 'push_disabled', status: 'skipped' };

    const staffId = await resolveDingTalkStaffId(params.db, params.userId);
    if (!staffId) return { reason: 'user_not_mapped', status: 'skipped' };

    const api = new DingTalkApiClient(config.clientId, config.clientSecret);
    const { actionUrl, markdown, title } = params.message;

    try {
      const wrappedUrl = actionUrl
        ? await wrapDingTalkPushButtonUrl(actionUrl, {
            agentId: config.agentId ?? null,
            corpId: config.corpId ?? null,
          })
        : null;
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
