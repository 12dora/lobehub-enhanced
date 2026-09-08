/**
 * Admin assistant-rank identity overlay: the merged inbox entry shows the platform
 * default assistant members see in chat (catalog → published branding → DEFAULT_INBOX_*).
 */
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

const firstTrimmed = (...values: Array<string | null | undefined>): string | undefined => {
  for (const value of values) {
    if (isTrimmedNonEmptyString(value)) return value.trim();
  }
  return undefined;
};

export const resolveInboxRankIdentity = (
  sources: InboxRankIdentitySources,
): Pick<AgentRankItem, 'avatar' | 'backgroundColor' | 'title'> => ({
  avatar:
    firstTrimmed(sources.catalog?.avatar, sources.branding.iconUrl, sources.branding.logoUrl) ??
    DEFAULT_INBOX_AVATAR,
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

  const [catalog, branding] = await Promise.all([
    new PlatformDefaultInboxService(db, userId).getPublishedIdentity(),
    resolveServerRuntimeBranding({ getDatabase: async () => db }),
  ]);

  return applyInboxRankIdentity(rows, resolveInboxRankIdentity({ branding, catalog }));
};
