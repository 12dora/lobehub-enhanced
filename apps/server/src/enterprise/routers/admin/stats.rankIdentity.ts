/**
 * Admin assistant-rank identity overlay: the merged inbox entry shows the platform
 * default assistant members see in chat (catalog → published branding → DEFAULT_INBOX_*).
 */
import { INBOX_SESSION_ID } from '@lobechat/const';
import type { AgentRankItem } from '@lobechat/types';

import type { LobeChatDatabase } from '@/database/type';

import {
  loadResolvedInboxIdentity,
  resolveInboxRankIdentity,
} from '../../services/agentCatalog/inboxIdentity';

export type { InboxRankIdentitySources } from '../../services/agentCatalog/inboxIdentity';
export { resolveInboxRankIdentity };

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

  return applyInboxRankIdentity(rows, await loadResolvedInboxIdentity(db, userId));
};
