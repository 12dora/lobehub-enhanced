'use client';

import type { TFunction } from 'i18next';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { openDangerConfirm } from '../../primitives/DangerConfirm';
import {
  useFetchAuditConversation,
  useFetchAuditConversationMessages,
  useFetchAuditPolicy,
} from '../hooks/useAdminAudit';
import {
  AUDIT_MESSAGE_PAGE_LIMIT,
  sortMessagesChronological,
  stripMessageBodies,
} from '../shared/liveMessageUtils';
import {
  emptyRedactionSlots,
  envelopeSlot,
  selectRenderablePages,
} from '../shared/redactionAuthority';
import { useRedactionAuthority } from '../shared/useRedactionAuthority';
import { useSummaryFailureToast } from '../shared/useSummaryFailureToast';
import { useTopicMessageFeed } from './useTopicMessageFeed';

export interface TopicEvidenceArgs {
  canAuditRead: boolean;
  canConversationRead: boolean;
  t: TFunction<'admin'>;
  topicId: string;
  userId: string;
}

/**
 * Fetches one topic's evidence (detail + transcript + policy) under the redaction authority, and
 * owns the body-reveal confirmation. The transcript is the newest message page (SWR, same query
 * shape as the live view) plus older pages loaded on demand, merged oldest → newest.
 */
export const useTopicEvidence = ({
  canAuditRead,
  canConversationRead,
  t,
  topicId,
  userId,
}: TopicEvidenceArgs) => {
  // The body reveal belongs to the topic it was confirmed on. The page is reused across :topicId,
  // so a reveal from another topic reads as off in the very first render — the new topic's first
  // request never includes bodies and needs its own confirmation.
  const scope = `${userId}:${topicId}`;
  const [reveal, setReveal] = useState({ on: false, scope });
  const includeBody = reveal.on && reveal.scope === scope;
  const setIncludeBody = useCallback((on: boolean) => setReveal({ on, scope }), [scope]);

  const policy = useFetchAuditPolicy(canAuditRead);
  const detail = useFetchAuditConversation(
    userId,
    topicId,
    canConversationRead && !!userId && !!topicId,
  );
  const messages = useFetchAuditConversationMessages(
    { includeBody, limit: AUDIT_MESSAGE_PAGE_LIMIT, topicId, userId },
    canConversationRead && !!userId && !!topicId,
  );

  // Only conversation evidence failures deny the page — not optional policy metadata.
  const isForbidden = useMemo(() => {
    const errors = [detail.error, messages.error];
    return errors.some((err) => {
      if (!err) return false;
      const data = (err as { data?: { code?: string } }).data;
      return data?.code === 'FORBIDDEN';
    });
  }, [detail.error, messages.error]);
  // A revalidation failure with cached detail is still degraded: preserve the stale
  // evidence, but make its freshness failure explicit and retryable.
  const detailFailed = Boolean(detail.error) && !isForbidden;

  useSummaryFailureToast(detailFailed, t);

  // Prefer contentAccessMode from conversation/messages (available with CONVERSATION_READ).
  const contentAccessMode =
    messages.data?.contentAccessMode ??
    detail.data?.contentAccessMode ??
    (canAuditRead ? policy.data?.contentAccessMode : undefined);

  // Bodies are only ever shown under content_allowed. If policy tightens after a reveal, drop the
  // reveal (so the next fetch is metadata-only and re-enabling needs a fresh confirmation);
  // `bodyHidden` masks any cached bodies in the meantime.
  // Fail closed for rendering: an unknown mode never paints bodies.
  const bodyHidden = contentAccessMode !== 'content_allowed';
  const policyForbidsBodies = contentAccessMode !== undefined && bodyHidden;

  const feed = useTopicMessageFeed({
    bodyAllowed: !bodyHidden,
    head: messages.data,
    includeBody,
    topicId,
    userId,
  });
  const resetFeed = feed.reset;

  useEffect(() => {
    if (!policyForbidsBodies) return;
    setIncludeBody(false);
    resetFeed();
  }, [policyForbidsBodies, resetFeed, setIncludeBody]);

  const redaction = useRedactionAuthority(
    {
      ...emptyRedactionSlots(),
      detail: envelopeSlot(detail.data),
      messages: envelopeSlot(messages.data),
      policy: canAuditRead ? envelopeSlot(policy.data) : undefined,
    },
    feed.pageProfiles,
    `${userId}:${topicId}`,
    () => {
      resetFeed();
    },
  );
  const detailRenderable = redaction.isEnvelopeRenderable(envelopeSlot(detail.data));
  // Older cursors served under a looser redaction profile must not be followed.
  const hasOlder = redaction.isEnvelopeRenderable(feed.cursorProfile) && Boolean(feed.cursor);

  // Older pages + newest page, each kept only while its envelope is renderable, oldest first.
  // The live head goes last so its copy of a message wins over the snapshot the chain anchored to.
  const items = useMemo(() => {
    const merged = sortMessagesChronological(
      selectRenderablePages(
        [
          ...feed.olderPages,
          { items: messages.data?.items ?? [], redactionProfile: envelopeSlot(messages.data) },
        ],
        redaction.isEnvelopeRenderable,
      ),
    );
    return bodyHidden ? stripMessageBodies(merged) : merged;
  }, [bodyHidden, feed.olderPages, messages.data, redaction]);

  const onToggleBody = useCallback(
    (checked: boolean) => {
      // Either way the transcript restarts from the newest page in the new body mode.
      if (!checked) {
        setIncludeBody(false);
        resetFeed();
        return;
      }
      openDangerConfirm({
        content: t('audit.conversations.topic.loadBodyConfirm'),
        title: t('audit.conversations.topic.loadBodyTitle'),
        onConfirm: () => {
          setIncludeBody(true);
          resetFeed();
        },
      });
    },
    [resetFeed, setIncludeBody, t],
  );

  return {
    bodyHidden,
    contentAccessMode,
    detail: {
      failed: detailFailed,
      retry: () => void detail.mutate(),
      // Stale detail fetched under a looser redaction profile must not render.
      topic: detailRenderable ? detail.data : undefined,
    },
    includeBody,
    isForbidden,
    messages: {
      hasData: Boolean(messages.data),
      hasError: Boolean(messages.error),
      hasOlder,
      isLoading: messages.isLoading,
      items,
      loadOlder: () => {
        if (!hasOlder) return;
        void feed.loadOlder();
      },
      loadingOlder: feed.loadingOlder,
      olderError: feed.olderError,
      /** Changes whenever the transcript restarts from the newest page (topic, body mode, reset). */
      resetKey: `${userId}:${topicId}:${includeBody ? 'body' : 'meta'}:${feed.generation}`,
      retry: () => void messages.mutate(),
    },
    onToggleBody,
  };
};

export type TopicEvidence = ReturnType<typeof useTopicEvidence>;
