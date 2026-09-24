import { toast } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import {
  BeforeApproveRefusedError,
  BeforeApproveTimeoutError,
  runBeforeApproveWhenReady,
} from '../Messages/AssistantGroup/Tool/Detail/Intervention/beforeApproveRegistry';
import { CANCEL_INTERVENTION_REASON } from '../Messages/AssistantGroup/Tool/Detail/Intervention/CancelInterventionButton';
import { dataSelectors, useConversationStore } from '../store';
import { type PendingIntervention } from '../store/slices/data/pendingInterventions';
import {
  ApproveAllQueue,
  type ApproveAllQueueState,
  type ApproveAllStopReason,
  IDLE_APPROVE_ALL_STATE,
  readQueueStoreView,
} from './approveAllQueue';
import { getInterventionBatch } from './interventionBatch';
import { type InterventionBatchProgress } from './InterventionBatchHeader';

export interface InterventionBatch {
  /** Tool message the approve-all queue is working on — the bar shows its tab. */
  activeToolMessageId?: string;
  approveAll: () => void;
  /** Approve / reject calls of the active tab's turn; the header shows for ≥ 2. */
  items: PendingIntervention[];
  progress?: InterventionBatchProgress;
  rejectAll: () => Promise<void>;
  stopApproveAll: () => void;
}

/**
 * Batch decisions for the calls one assistant turn parked together:
 * approve-all (a store-driven queue, see `ApproveAllQueue`) and reject-all
 * (`rejectAllToolCallings`: every row closed, the run resumed once).
 *
 * The queue lives in this component: leaving the conversation (unmount, or the
 * bar switching to another conversation) stops it.
 */
export const useInterventionBatch = (
  interventions: PendingIntervention[],
  activeIndex: number,
): InterventionBatch => {
  const { t } = useTranslation('chat');
  const context = useConversationStore((s) => s.context);
  const approveToolCall = useConversationStore((s) => s.approveToolCall);
  const contextKey = messageMapKey(context);

  // The assistant message that emitted each call (its tool row's parentId).
  const parentIds = useConversationStore(
    (s) =>
      interventions.map(
        (item) => dataSelectors.getDbMessageById(item.toolMessageId)(s)?.parentId ?? undefined,
      ),
    isEqual,
  );

  const { items, turnHasOtherPending } = useMemo(() => {
    const parentById = new Map(
      interventions.map((item, index) => [item.toolMessageId, parentIds[index]]),
    );
    const getTurnId = (item: PendingIntervention) => parentById.get(item.toolMessageId);

    const batch = getInterventionBatch(interventions, activeIndex, getTurnId);
    const turnId = batch[0] ? getTurnId(batch[0]) : undefined;

    return {
      items: batch,
      // Same turn, but decided one by one (blacklisted args, ask-user cards …).
      turnHasOtherPending:
        !!turnId &&
        interventions.some((item) => getTurnId(item) === turnId && !batch.includes(item)),
    };
  }, [interventions, activeIndex, parentIds]);

  const [queueState, setQueueState] = useState<ApproveAllQueueState>(IDLE_APPROVE_ALL_STATE);
  const [rejectProgress, setRejectProgress] = useState<{ current: number; total: number }>();
  const queueRef = useRef<ApproveAllQueue | null>(null);
  const rejectingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Navigating away, or the same bar now showing another conversation: a queue
  // never carries over.
  useEffect(() => () => queueRef.current?.stop('unmounted'), [contextKey]);

  const notifyStop = useCallback(
    (reason: ApproveAllStopReason, error?: unknown) => {
      if (error instanceof BeforeApproveTimeoutError) {
        toast.warning(t('tool.intervention.batch.previewTimeout'));
      } else if (error instanceof BeforeApproveRefusedError) {
        // The card that refused stays open and shows its own reason.
        toast.warning(t('tool.intervention.batch.checkRefused'));
      } else if (reason === 'failed' || reason === 'toolError') {
        toast.warning(t('tool.intervention.batch.stoppedOnFailure'));
      } else if (reason === 'manual') {
        toast.info(t('tool.intervention.batch.stoppedManual'));
      }
    },
    [t],
  );

  const approveAll = useCallback(() => {
    if (queueRef.current?.running || rejectingRef.current) return;
    if (items.length === 0) return;

    const groupIds = new Map(
      items.map((item) => [item.toolMessageId, item.assistantGroupId ?? '']),
    );
    const queueContext = context;

    const queue = new ApproveAllQueue({
      approve: (toolMessageId) => approveToolCall(toolMessageId, groupIds.get(toolMessageId) ?? ''),
      onChange: (state) => {
        if (mountedRef.current) setQueueState(state);
      },
      onStop: (reason, error) => {
        if (mountedRef.current) notifyStop(reason, error);
      },
      // The same check the card's own approve button runs (preview loaded, edits
      // flushed) — waited for once the queue opened the call's tab.
      prepare: (toolMessageId, signal) => runBeforeApproveWhenReady(toolMessageId, { signal }),
      read: () => readQueueStoreView(useChatStore.getState(), queueContext),
      subscribe: (listener) => useChatStore.subscribe(listener),
    });

    queueRef.current = queue;
    queue.start(items.map((item) => item.toolMessageId));
  }, [approveToolCall, context, items, notifyStop]);

  const stopApproveAll = useCallback(() => {
    queueRef.current?.stop('user');
  }, []);

  const rejectAll = useCallback(async () => {
    if (queueRef.current?.running || rejectingRef.current) return;

    const ids = items.map((item) => item.toolMessageId);
    if (ids.length === 0) return;

    rejectingRef.current = true;
    setRejectProgress({ current: 1, total: ids.length });

    try {
      const result = await useChatStore.getState().rejectAllToolCallings(ids, {
        cancelReason: CANCEL_INTERVENTION_REASON,
        context,
        onProgress: (rejected, total) => {
          if (mountedRef.current)
            setRejectProgress({ current: Math.min(rejected + 1, total), total });
        },
        // Calls of this turn left for one-by-one decisions keep the run parked:
        // it continues once the last of them is decided.
        resume: !turnHasOtherPending,
      });

      if (result.rejected < result.total) {
        toast.warning(t('tool.intervention.batch.rejectIncomplete'));
      }
    } catch (error) {
      console.error('[InterventionBar] reject all failed:', error);
      toast.warning(t('tool.intervention.batch.rejectIncomplete'));
    } finally {
      rejectingRef.current = false;
      if (mountedRef.current) setRejectProgress(undefined);
    }
  }, [context, items, t, turnHasOtherPending]);

  const progress: InterventionBatchProgress | undefined = queueState.running
    ? { current: queueState.current, mode: 'approve', total: queueState.total }
    : rejectProgress
      ? { ...rejectProgress, mode: 'reject' }
      : undefined;

  return {
    activeToolMessageId: queueState.running ? queueState.activeToolMessageId : undefined,
    approveAll,
    items,
    progress,
    rejectAll,
    stopApproveAll,
  };
};
