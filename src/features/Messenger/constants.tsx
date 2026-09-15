import { DingTalk, Discord, Slack, Telegram } from '@lobehub/ui/icons';
import type { ReactNode } from 'react';

export type MessengerPlatform = 'telegram' | 'slack' | 'discord' | 'dingtalk';

export const SUPPORTED_MESSENGER_PLATFORMS = [
  { id: 'telegram', name: 'Telegram' },
  { id: 'slack', name: 'Slack' },
  { id: 'discord', name: 'Discord' },
  { id: 'dingtalk', name: '钉钉' },
] as const satisfies readonly { id: MessengerPlatform; name: string }[];

/**
 * Per-platform feature switches published by `messenger.availablePlatforms`.
 * Admins can turn the chat side or the proactive-push side of a connector off
 * independently, so the settings detail page explains which half is disabled
 * instead of silently doing nothing.
 */
export interface MessengerPlatformCapabilities {
  chat: boolean;
  push: boolean;
}

/**
 * DingTalk robot commands, Chinese-primary with English aliases (both are
 * accepted by the bot). Kept as data rather than i18n so the literal a user
 * types stays identical in every locale; only the descriptions are localized.
 */
export const DINGTALK_COMMANDS = [
  { command: '/助手', id: 'agents' },
  { command: '/切换 N', id: 'use' },
  { command: '/新会话', id: 'new' },
  { command: '/会话', id: 'topics' },
  { command: '/继续 N', id: 'resume' },
  { command: '/当前', id: 'status' },
  { command: '/停止', id: 'stop' },
  { command: '/帮助', id: 'help' },
] as const;

export const PLATFORM_TAB_ICONS: Record<MessengerPlatform, ReactNode> = {
  dingtalk: <DingTalk.Color size={16} />,
  discord: <Discord.Color size={16} />,
  slack: <Slack.Color size={16} />,
  telegram: <Telegram.Color size={16} />,
};

export const PlatformAvatar = ({
  platform,
  size,
}: {
  platform: MessengerPlatform;
  size: number;
}) => {
  if (platform === 'telegram') return <Telegram.Avatar size={size} />;
  if (platform === 'discord') return <Discord.Avatar size={size} />;
  if (platform === 'dingtalk') return <DingTalk.Avatar size={size} />;
  return <Slack.Avatar size={size} />;
};

export const PlatformBrandIcon = ({
  platform,
  size,
}: {
  platform: MessengerPlatform;
  size: number;
}) => {
  if (platform === 'telegram') return <Telegram.Color size={size} />;
  if (platform === 'discord') return <Discord.Color size={size} />;
  if (platform === 'dingtalk') return <DingTalk.Color size={size} />;
  return <Slack.Color size={size} />;
};

/**
 * Plain Telegram bot URL — no `?start=messenger` suffix. Used by the verify
 * success state where re-triggering the bot's `/start` flow right after
 * binding would be redundant.
 */
export const buildTelegramBotUrl = (botUsername: string): string =>
  `https://t.me/${botUsername.replace(/^@/, '')}`;

export const buildTelegramDeepLink = (botUsername: string): string =>
  `${buildTelegramBotUrl(botUsername)}?start=messenger`;

/**
 * Slack bot deep link. Prefer the `app_redirect` form when both `appId` and
 * `tenantId` are known — Slack handles desktop hand-off and lands the user in
 * the bot DM. Falls back to the workspace URL when only the team id is known.
 */
export const buildSlackOpenBotUrl = (tenantId: string, appId?: string): string =>
  appId
    ? `https://slack.com/app_redirect?app=${appId}&team=${tenantId}`
    : `https://app.slack.com/client/${tenantId}`;

/**
 * Direct link to the bot's user profile in Discord. App IDs double as the
 * bot user id for bot accounts, so this URL opens the bot's profile page;
 * the user clicks "Send Message" to start a DM.
 *
 * Note: the "Add to Discord server" install flow goes through
 * `/api/agent/messenger/discord/install` (OAuth code-grant) rather than a
 * hardcoded `discord.com/oauth2/authorize` URL, so the callback can persist
 * the guild as an audit row. Bot scopes / permissions live in
 * `src/server/services/messenger/platforms/discord/oauth.ts`.
 */
export const buildDiscordOpenBotUrl = (applicationId: string): string =>
  `https://discord.com/users/${applicationId}`;
