import { inArray } from 'drizzle-orm';

import { agents } from '@/database/schemas';
import type { LobeChatDatabase, Transaction } from '@/database/type';

const FIND_BY_IDS_CHUNK = 200;

export interface AgentPublicRef {
  slug: string | null;
  title: string | null;
}

const nonempty = (value: string | null | undefined): string | null => {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Batch-resolve agent ids to title/slug. Unknown / deleted ids are omitted
 * (callers treat a missing map entry as null fields).
 */
export const resolveAgentRefs = async (
  db: LobeChatDatabase | Transaction,
  ids: Iterable<string | null | undefined>,
): Promise<Map<string, AgentPublicRef>> => {
  const unique = [...new Set([...ids].filter((id): id is string => Boolean(id && id.length > 0)))];
  const refs = new Map<string, AgentPublicRef>();
  if (unique.length === 0) return refs;

  for (let i = 0; i < unique.length; i += FIND_BY_IDS_CHUNK) {
    const chunk = unique.slice(i, i + FIND_BY_IDS_CHUNK);
    const rows = await db
      .select({
        id: agents.id,
        slug: agents.slug,
        title: agents.title,
      })
      .from(agents)
      .where(inArray(agents.id, chunk));
    for (const row of rows) {
      refs.set(row.id, {
        slug: nonempty(row.slug),
        title: nonempty(row.title),
      });
    }
  }
  return refs;
};

export const agentRefOf = (
  id: string | null | undefined,
  refs: Map<string, AgentPublicRef>,
): AgentPublicRef | null => (id ? (refs.get(id) ?? null) : null);

export const withAgentDisplay = <T extends { agentId: string | null }>(
  item: T,
  refs: Map<string, AgentPublicRef>,
): T & { agentSlug: string | null; agentTitle: string | null } => {
  const ref = agentRefOf(item.agentId, refs);
  return {
    ...item,
    agentSlug: ref?.slug ?? null,
    agentTitle: ref?.title ?? null,
  };
};
