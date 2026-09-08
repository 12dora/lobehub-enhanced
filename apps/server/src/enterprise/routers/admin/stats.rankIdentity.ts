/**
 * Admin assistant-rank identity overlay: the merged inbox entry shows the platform
 * default assistant members see in chat (catalog → published branding → DEFAULT_INBOX_*).
 */
import { BRANDING_LOGO_URL } from '@lobechat/business-const';
import { DEFAULT_INBOX_AVATAR, DEFAULT_INBOX_TITLE, INBOX_SESSION_ID } from '@lobechat/const';
import type { AgentRankItem } from '@lobechat/types';
import { isTrimmedNonEmptyString } from '@lobechat/utils';

import type { LobeChatDatabase } from '@/database/type';

import { PlatformDefaultInboxService } from '../../services/agentCatalog/defaultInbox';
import { resolveServerRuntimeBranding } from '../../services/branding';

export interface InboxRankIdentitySources {
  branding: {
    defaultAgentDisplayName?: string | null;
    iconUrl?: string | null;
    logoUrl?: string | null;
  };
  catalog: {
    avatar?: string | null;
    backgroundColor?: string | null;
    title?: string | null;
  } | null;
}

/**
 * Same members as `BUILT_IN_INBOX_AVATARS` in `src/hooks/useDefaultInboxAvatar.ts`.
 * The hook module is client-only, so this overlay mirrors the set instead of importing it.
 */
const BUILT_IN_INBOX_AVATARS = new Set(
  ['/avatars/lobe-ai.png', DEFAULT_INBOX_AVATAR, BRANDING_LOGO_URL].filter(Boolean),
);

const firstTrimmed = (...values: Array<string | null | undefined>): string | undefined => {
  for (const value of values) {
    if (isTrimmedNonEmptyString(value)) return value.trim();
  }
  return undefined;
};

const isCustomisedInboxAvatar = (avatar?: string | null): boolean => {
  const trimmed = firstTrimmed(avatar);
  return trimmed !== undefined && !BUILT_IN_INBOX_AVATARS.has(trimmed);
};

export const resolveInboxRankIdentity = (
  sources: InboxRankIdentitySources,
): Pick<AgentRankItem, 'avatar' | 'backgroundColor' | 'title'> => ({
  avatar:
    firstTrimmed(
      isCustomisedInboxAvatar(sources.catalog?.avatar) ? sources.catalog?.avatar : undefined,
      sources.branding.iconUrl,
      sources.branding.logoUrl,
    ) ?? DEFAULT_INBOX_AVATAR,
  backgroundColor: firstTrimmed(sources.catalog?.backgroundColor) ?? null,
  title:
    firstTrimmed(sources.catalog?.title, sources.branding.defaultAgentDisplayName) ??
    DEFAULT_INBOX_TITLE,
});

export const applyInboxRankIdentity = (
  rows: AgentRankItem[],
  identity: Pick<AgentRankItem, 'avatar' | 'backgroundColor' | 'title'>,
): AgentRankItem[] =>
  rows.map((row) => (row.id === INBOX_SESSION_ID ? { ...row, ...identity } : row));

export const overlayInboxAgentRank = async (
  db: LobeChatDatabase,
  userId: string,
  rows: AgentRankItem[],
): Promise<AgentRankItem[]> => {
  if (!rows.some((row) => row.id === INBOX_SESSION_ID)) return rows;

  const catalog = await new PlatformDefaultInboxService(db, userId).getPublishedIdentity();

  if (isCustomisedInboxAvatar(catalog?.avatar) && isTrimmedNonEmptyString(catalog?.title)) {
    return applyInboxRankIdentity(rows, resolveInboxRankIdentity({ branding: {}, catalog }));
  }

  const branding = await resolveServerRuntimeBranding();
  return applyInboxRankIdentity(rows, resolveInboxRankIdentity({ branding, catalog }));
};
