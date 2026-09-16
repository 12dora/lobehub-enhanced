import { createEnv } from '@t3-oss/env-nextjs';
import debug from 'debug';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import {
  type DecryptedSystemBotProvider,
  SystemBotProviderModel,
} from '@/database/models/systemBotProvider';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

const log = debug('lobe-server:messenger:config');

/**
 * Messenger bot configuration — DB-backed.
 *
 * Replaces the env-only path. Credentials live in `system_bot_providers` and
 * are managed from develop-center. The only env knob left is the link-token
 * TTL (no secrets, just a tunable).
 *
 * Two distribution models still apply downstream:
 *
 * - **Global-token platforms (Telegram, Discord)**: a single LobeHub-owned
 *   bot serves every user. The full credential bundle for the bot lives in
 *   the row.
 *
 * - **Per-tenant OAuth platforms (Slack)**: the row carries App-level
 *   credentials (`appId` / `clientId` / `clientSecret` / `signingSecret`);
 *   each workspace bot token is acquired via OAuth on install and stored
 *   in `messenger_installations`.
 */
export const getMessengerConfig = () => {
  return createEnv({
    client: {},
    runtimeEnv: {
      LOBE_LINK_TOKEN_TTL_SECONDS: process.env.LOBE_LINK_TOKEN_TTL_SECONDS,
    },
    server: {
      LOBE_LINK_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
    },
  });
};

export const messengerEnv = getMessengerConfig();

export type MessengerPlatform = 'telegram' | 'slack' | 'discord' | 'dingtalk';

export interface MessengerTelegramConfig {
  botToken: string;
  botUsername?: string;
  webhookSecret?: string;
}

export interface MessengerSlackConfig {
  appId: string;
  clientId: string;
  clientSecret: string;
  signingSecret: string;
}

export interface MessengerDiscordConfig {
  applicationId: string;
  botToken: string;
  /**
   * Discord OAuth client secret. Required only for the per-guild install flow
   * (`[platform]/install` → `[platform]/oauth/callback`). The runtime bot
   * itself uses `botToken` only, so legacy deployments without OAuth wiring
   * keep working.
   */
  clientSecret?: string;
  publicKey: string;
}

export interface MessengerDingTalkNotifyApp {
  agentId: string;
  appKey: string;
  appSecret: string;
  /** 服务号 robot 1:1. Missing / undefined = on (legacy rows). */
  notifyRobotEnabled: boolean;
  /** 工作通知. Missing / undefined = on (legacy rows). */
  notifyWorkNoticeEnabled: boolean;
}

/**
 * DingTalk System Bot (Stream mode). `null` from the getter means the
 * `system_bot_providers` row is missing, disabled, or incomplete.
 *
 * Settings parser is a minimal duplicate of
 * `apps/server/src/enterprise/contracts/adminImConnectors.ts`
 * (`dingTalkConnectorSettingsSchema`) — `packages/app-config` cannot import
 * `apps/server`.
 */
export interface MessengerDingTalkConfig {
  /** Optional micro-app AgentId for `dingtalk://…/openapp` deep links; empty/missing → null. */
  agentId: string | null;
  aiCardTemplateId: string | null;
  chatEnabled: boolean;
  clientId: string;
  clientSecret: string;
  /** Optional CorpId for DingTalk 免登; empty/missing → null (SSO falls back to Redis). */
  corpId: string | null;
  idleNewTopicEnabled: boolean;
  idleNewTopicHours: number;
  /**
   * Notify app (服务号) used for work notifications. Null unless AppKey, AppSecret
   * and AgentId are all present.
   */
  notifyApp: MessengerDingTalkNotifyApp | null;
  pushEnabled: boolean;
  robotCode: string;
  selectCardTemplateId: string | null;
}

const IM_CONNECTOR_IDLE_HOURS_MIN = 1;
const IM_CONNECTOR_IDLE_HOURS_MAX = 720;
const IM_CONNECTOR_IDLE_HOURS_DEFAULT = 24;

const dingTalkConnectorSettingsSchema = z
  .object({
    agentId: z.string().trim().max(64).nullable().optional(),
    aiCardTemplateId: z.string().trim().max(200).nullable().optional(),
    chatEnabled: z.boolean().optional(),
    corpId: z.string().trim().max(200).nullable().optional(),
    idleNewTopicEnabled: z.boolean().optional(),
    idleNewTopicHours: z
      .number()
      .int()
      .min(IM_CONNECTOR_IDLE_HOURS_MIN)
      .max(IM_CONNECTOR_IDLE_HOURS_MAX)
      .optional(),
    notifyAgentId: z.string().trim().max(64).nullable().optional(),
    notifyAppKey: z.string().trim().max(200).nullable().optional(),
    notifyRobotEnabled: z.boolean().optional(),
    notifyWorkNoticeEnabled: z.boolean().optional(),
    pushEnabled: z.boolean().optional(),
    robotCode: z.string().trim().min(1).max(200),
    selectCardTemplateId: z.string().trim().max(200).nullable().optional(),
  })
  .passthrough();

const emptyToNull = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

// ---------------------------------------------------------------------------
// In-process cache.
//
// Webhooks fire frequently — every Discord MESSAGE_CREATE, every Slack event,
// every Telegram update would otherwise hit the DB to read the App config.
// 30s TTL keeps the round-trip out of the hot path while letting credential
// rotations from dc-center take effect within ~30s without a deploy.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 30_000;

interface CacheEntry<T> {
  expiresAt: number;
  value: T | null;
}

const platformCache = new Map<MessengerPlatform, CacheEntry<unknown>>();

/** Drop the cached config for a platform (or all). Called by mutations after
 *  the dc-center admin saves new credentials. Best-effort: cross-process
 *  invalidation is not guaranteed (Vercel functions don't share memory), so
 *  the 30s TTL is the real backstop. */
export const invalidateMessengerConfigCache = (platform?: MessengerPlatform): void => {
  if (platform) {
    platformCache.delete(platform);
  } else {
    platformCache.clear();
  }
};

const fetchAndCache = async <T>(
  platform: MessengerPlatform,
  decode: (decrypted: DecryptedSystemBotProvider) => T | null,
): Promise<T | null> => {
  const cached = platformCache.get(platform) as CacheEntry<T> | undefined;
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: T | null = null;
  try {
    const db = await getServerDB();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey().catch(() => undefined);
    const row = await SystemBotProviderModel.findEnabledByPlatform(db, platform, gateKeeper);
    if (row) value = decode(row);
  } catch (error) {
    log('fetchAndCache: lookup failed for platform=%s: %O', platform, error);
  }

  platformCache.set(platform, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
};

export const getMessengerTelegramConfig = async (): Promise<MessengerTelegramConfig | null> => {
  return fetchAndCache<MessengerTelegramConfig>('telegram', (row) => {
    const c = row.credentials as Partial<MessengerTelegramConfig>;
    if (!c.botToken) return null;
    return {
      botToken: c.botToken,
      botUsername: c.botUsername,
      webhookSecret: c.webhookSecret,
    };
  });
};

export const getMessengerSlackConfig = async (): Promise<MessengerSlackConfig | null> => {
  return fetchAndCache<MessengerSlackConfig>('slack', (row) => {
    const c = row.credentials as Partial<Omit<MessengerSlackConfig, 'appId'>>;
    if (!row.applicationId || !c.clientId || !c.clientSecret || !c.signingSecret) return null;
    return {
      appId: row.applicationId,
      clientId: c.clientId,
      clientSecret: c.clientSecret,
      signingSecret: c.signingSecret,
    };
  });
};

export const getMessengerDiscordConfig = async (): Promise<MessengerDiscordConfig | null> => {
  return fetchAndCache<MessengerDiscordConfig>('discord', (row) => {
    const c = row.credentials as Partial<Omit<MessengerDiscordConfig, 'applicationId'>>;
    if (!row.applicationId || !c.botToken || !c.publicKey) return null;
    return {
      applicationId: row.applicationId,
      botToken: c.botToken,
      clientSecret: c.clientSecret,
      publicKey: c.publicKey,
    };
  });
};

export const getMessengerDingTalkConfig = async (): Promise<MessengerDingTalkConfig | null> => {
  return fetchAndCache<MessengerDingTalkConfig>('dingtalk', (row) => {
    const clientId = row.applicationId?.trim();
    const c = row.credentials as { clientSecret?: unknown; notifyAppSecret?: unknown };
    const clientSecret = typeof c.clientSecret === 'string' ? c.clientSecret.trim() : '';
    if (!clientId || !clientSecret) return null;

    const parsed = dingTalkConnectorSettingsSchema.safeParse(row.settings ?? {});
    if (!parsed.success) return null;

    const settings = parsed.data;
    const notifyAppKey = emptyToNull(settings.notifyAppKey ?? null);
    const notifyAgentId = emptyToNull(settings.notifyAgentId ?? null);
    const notifyAppSecret =
      typeof c.notifyAppSecret === 'string' ? emptyToNull(c.notifyAppSecret) : null;
    const notifyApp =
      notifyAppKey && notifyAppSecret && notifyAgentId
        ? {
            agentId: notifyAgentId,
            appKey: notifyAppKey,
            appSecret: notifyAppSecret,
            notifyRobotEnabled: settings.notifyRobotEnabled ?? true,
            notifyWorkNoticeEnabled: settings.notifyWorkNoticeEnabled ?? true,
          }
        : null;

    return {
      agentId: emptyToNull(settings.agentId ?? null),
      aiCardTemplateId: emptyToNull(settings.aiCardTemplateId ?? null),
      chatEnabled: settings.chatEnabled ?? true,
      clientId,
      clientSecret,
      corpId: emptyToNull(settings.corpId ?? null),
      idleNewTopicEnabled: settings.idleNewTopicEnabled ?? true,
      idleNewTopicHours: settings.idleNewTopicHours ?? IM_CONNECTOR_IDLE_HOURS_DEFAULT,
      notifyApp,
      pushEnabled: settings.pushEnabled ?? true,
      robotCode: settings.robotCode,
      selectCardTemplateId: emptyToNull(settings.selectCardTemplateId ?? null),
    };
  });
};

export const isMessengerPlatformEnabled = async (platform: MessengerPlatform): Promise<boolean> => {
  switch (platform) {
    case 'telegram': {
      return !!(await getMessengerTelegramConfig());
    }
    case 'slack': {
      return !!(await getMessengerSlackConfig());
    }
    case 'discord': {
      return !!(await getMessengerDiscordConfig());
    }
    case 'dingtalk': {
      return !!(await getMessengerDingTalkConfig());
    }
    default: {
      return false;
    }
  }
};

export const getEnabledMessengerPlatforms = async (): Promise<MessengerPlatform[]> => {
  const platforms = ['telegram', 'slack', 'discord', 'dingtalk'] as const;
  const checks = await Promise.all(
    platforms.map(async (p) => ((await isMessengerPlatformEnabled(p)) ? p : null)),
  );
  return checks.filter((p): p is MessengerPlatform => p !== null);
};

export const getMessengerLinkTokenTtl = (): number => messengerEnv.LOBE_LINK_TOKEN_TTL_SECONDS;
