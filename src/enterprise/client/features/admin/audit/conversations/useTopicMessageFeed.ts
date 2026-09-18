'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AdminAuditConversationMessage } from '@/enterprise/client/services/adminAudit';
import { adminAuditService } from '@/enterprise/client/services/adminAudit';

import type { ProfiledMessagePage } from '../live/useLiveMessageFeed';
import { AUDIT_MESSAGE_PAGE_LIMIT, stripMessageBodies } from '../shared/liveMessageUtils';
import { envelopeSlot } from '../shared/redactionAuthority';
import { idSetsDisjoint } from '../shared/topicListUtils';

interface OlderCursor {
  cursor: string | null;
  redactionProfile: string | undefined;
}

interface OlderState {
  /**
   * Ids of the newest page the older chain hangs off. A revalidated head must still share one of
   * them, or the messages between the two have fallen out of both and the chain is broken.
   */
  anchorIds: Set<string>;
  /** `undefined` → no older page yet; follow the newest page's cursor. */
  cursor: OlderCursor | undefined;
  error: boolean;
  loading: boolean;
  /** Oldest-last: the anchored head snapshot, then each older page as it arrived. */
  pages: ProfiledMessagePage[];
  /** `${userId}:${topicId}` this state belongs to; state of another scope is never rendered. */
  scope: string;
}

const emptyState = (scope: string): OlderState => ({
  anchorIds: new Set(),
  cursor: undefined,
  error: false,
  loading: false,
  pages: [],
  scope,
});

export interface TopicMessageFeedArgs {
  /**
   * Bodies may be requested and kept: the effective policy is `content_allowed` (i.e. the caller's
   * `bodyHidden` is false). Older pages never carry bodies otherwise.
   */
  bodyAllowed: boolean;
  /** Newest page (no cursor) — the SWR head of the transcript. */
  head:
    | {
        items?: AdminAuditConversationMessage[];
        nextCursor?: string | null;
        redactionProfile?: string;
      }
    | undefined;
  includeBody: boolean;
  topicId: string;
  userId: string;
}

/**
 * Older-history accumulator behind the topic transcript. The newest page comes from SWR; each
 * `loadOlder` follows the server's descending cursor one page further back and keeps the page
 * with the redaction envelope it was served under, so the caller can drop pages a tightened
 * authority no longer allows. `reset` discards every older page (and any request in flight) so
 * the transcript starts over from the newest page; a topic change or a head that no longer
 * connects to the loaded history does the same.
 */
export const useTopicMessageFeed = ({
  bodyAllowed,
  head,
  includeBody,
  topicId,
  userId,
}: TopicMessageFeedArgs) => {
  const scope = `${userId}:${topicId}`;
  const [state, setState] = useState<OlderState>(() => emptyState(scope));
  const [generation, setGeneration] = useState(0);
  const epochRef = useRef(0);
  const inFlightRef = useRef(false);
  const bodyAllowedRef = useRef(bodyAllowed);
  bodyAllowedRef.current = bodyAllowed;

  // Topic change: invalidate in render (the page component is reused across :topicId), so the
  // first commit under the new topic never shows — or feeds the redaction authority — the old
  // topic's pages, and a request in flight for it can no longer commit.
  const scopeRef = useRef(scope);
  if (scopeRef.current !== scope) {
    scopeRef.current = scope;
    epochRef.current += 1;
    inFlightRef.current = false;
  }

  const reset = useCallback(() => {
    epochRef.current += 1;
    inFlightRef.current = false;
    setState(emptyState(scopeRef.current));
    setGeneration((g) => g + 1);
  }, []);

  const headItems = head?.items;
  const scoped = state.scope === scope ? state : undefined;
  // While older history is loaded, a revalidated head (e.g. on refocus after ≥ one page of new
  // messages) that shares nothing with the head the chain was anchored to leaves a hole between
  // them: treat the chain as gone in this render and restart from the newest page.
  const chainBroken = useMemo(() => {
    if (!scoped?.pages.length) return false;
    const headIds = new Set((headItems ?? []).map((m) => m.id));
    return idSetsDisjoint(headIds, scoped.anchorIds);
  }, [headItems, scoped]);
  const older = scoped && !chainBroken ? scoped : undefined;

  useEffect(() => {
    if (chainBroken) reset();
  }, [chainBroken, reset]);

  const cursor = older?.cursor ? older.cursor.cursor : (head?.nextCursor ?? null);
  const cursorProfile = older?.cursor ? older.cursor.redactionProfile : envelopeSlot(head);

  const loadOlder = useCallback(async () => {
    if (!cursor || !userId || !topicId || inFlightRef.current) return;
    const epoch = epochRef.current;
    const requestScope = scope;
    // Anchor the chain to the head it continues from (first older page only).
    const anchor = older?.cursor ? undefined : head;
    inFlightRef.current = true;
    setState((prev) => ({
      ...(prev.scope === requestScope ? prev : emptyState(requestScope)),
      error: false,
      loading: true,
    }));
    const settle = (patch: (prev: OlderState) => Partial<OlderState>) =>
      setState((prev) =>
        prev.scope === requestScope ? { ...prev, ...patch(prev), loading: false } : prev,
      );
    try {
      const page = await adminAuditService.listConversationMessages({
        cursor,
        // Never ask for bodies the policy does not allow, even if the reveal is still on.
        includeBody: includeBody && bodyAllowedRef.current,
        limit: AUDIT_MESSAGE_PAGE_LIMIT,
        topicId,
        userId,
      });
      // Body mode, topic or redaction authority changed mid-flight: this page is stale.
      if (epoch !== epochRef.current) return;
      if (page.contentAccessMode === 'disabled') {
        settle(() => ({ error: true }));
        return;
      }
      // A page served (or landing) outside content_allowed keeps its metadata, never its bodies.
      const keepBodies = page.contentAccessMode === 'content_allowed' && bodyAllowedRef.current;
      const items = keepBodies ? page.items : stripMessageBodies(page.items);
      const profile = envelopeSlot(page);
      settle((prev) => {
        const anchorPage: ProfiledMessagePage[] = anchor
          ? [
              {
                items: keepBodies ? (anchor.items ?? []) : stripMessageBodies(anchor.items ?? []),
                redactionProfile: envelopeSlot(anchor),
              },
            ]
          : [];
        return {
          anchorIds: anchor ? new Set((anchor.items ?? []).map((m) => m.id)) : prev.anchorIds,
          cursor: { cursor: page.nextCursor, redactionProfile: profile },
          pages: [...prev.pages, ...anchorPage, { items, redactionProfile: profile }],
        };
      });
    } catch {
      if (epoch === epochRef.current) settle(() => ({ error: true }));
    } finally {
      if (epoch === epochRef.current) inFlightRef.current = false;
    }
  }, [cursor, head, includeBody, older?.cursor, scope, topicId, userId]);

  const olderPages = useMemo(() => older?.pages ?? [], [older]);
  const pageProfiles = useMemo(() => olderPages.map((page) => page.redactionProfile), [olderPages]);

  return {
    cursor,
    cursorProfile,
    generation,
    loadOlder,
    loadingOlder: older?.loading ?? false,
    olderError: older?.error ?? false,
    olderPages,
    pageProfiles,
    reset,
  };
};
