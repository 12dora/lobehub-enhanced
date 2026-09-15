/**
 * Shared inbox identity overlay: catalog published identity → runtime branding →
 * DEFAULT_INBOX_*. Used by task authors/participants and admin assistant ranks
 * so those surfaces cannot drift from chat config.
 */
import { BRANDING_LOGO_URL } from '@lobechat/business-const';
import { DEFAULT_INBOX_AVATAR, DEFAULT_INBOX_TITLE, INBOX_SESSION_ID } from '@lobechat/const';
import type { AgentRankItem } from '@lobechat/types';
import { isTrimmedNonEmptyString } from '@lobechat/utils';

import type { LobeChatDatabase } from '@/database/type';

import { resolveServerRuntimeBranding } from '../branding';
import { PlatformDefaultInboxService } from './defaultInbox';

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

export type ResolvedInboxIdentity = Pick<AgentRankItem, 'avatar' | 'backgroundColor' | 'title'>;

export interface InboxIdentityAgentRow {
  avatar: string | null;
  backgroundColor?: string | null;
  id: string;
  isInbox?: boolean;
  slug?: string | null;
  title: string | null;
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

export const isInboxIdentityAgent = (row: {
  id?: string;
  isInbox?: boolean;
  slug?: string | null;
}): boolean => row.isInbox === true || row.slug === INBOX_SESSION_ID || row.id === INBOX_SESSION_ID;

export const resolveInboxRankIdentity = (
  sources: InboxRankIdentitySources,
): ResolvedInboxIdentity => ({
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

export const loadResolvedInboxIdentity = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<ResolvedInboxIdentity> => {
  const catalog = await new PlatformDefaultInboxService(db, userId).getPublishedIdentity();

  if (isCustomisedInboxAvatar(catalog?.avatar) && isTrimmedNonEmptyString(catalog?.title)) {
    return resolveInboxRankIdentity({ branding: {}, catalog });
  }

  const branding = await resolveServerRuntimeBranding();
  return resolveInboxRankIdentity({ branding, catalog });
};

export const overlayInboxIdentityOnAgentAvatars = async <T extends InboxIdentityAgentRow>(
  db: LobeChatDatabase,
  userId: string,
  rows: T[],
): Promise<T[]> => {
  if (!rows.some(isInboxIdentityAgent)) return rows;

  const identity = await loadResolvedInboxIdentity(db, userId);
  return rows.map((row) =>
    isInboxIdentityAgent(row)
      ? {
          ...row,
          avatar: identity.avatar,
          backgroundColor: identity.backgroundColor,
          title: identity.title,
        }
      : row,
  );
};
