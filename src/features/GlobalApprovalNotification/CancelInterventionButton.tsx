'use client';

import { ActionIcon } from '@lobehub/ui/base-ui';
import { X } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation';

interface CancelInterventionButtonProps {
  /** The pending tool message of the intervention currently shown on the card. */
  messageId: string;
}

/**
 * Header-level "cancel this action" affordance for the global approval card.
 *
 * Cancelling reuses the footer's reject path (`rejectAndContinueToolCall`) with a
 * fixed reason, so the run resumes and the assistant acknowledges the cancel in
 * one line instead of silently dropping the turn. Works for every tool — the
 * store action is the same one the generic approval footer calls, not something
 * per-toolset.
 *
 * Must render *inside* the card's `ConversationProvider`: the action lives on
 * the per-conversation store so the reject lands on this card's own
 * agent / topic rather than whatever conversation is on screen.
 */
const CancelInterventionButton = memo<CancelInterventionButtonProps>(({ messageId }) => {
  const { t } = useTranslation('chat');
  const [loading, setLoading] = useState(false);
  const rejectAndContinueToolCall = useConversationStore((s) => s.rejectAndContinueToolCall);

  // An optimistic tool message has no server row yet, so there is nothing to
  // reject — same guard the approval footer applies to its submit button.
  const isMessageCreating = messageId.startsWith('tmp_');
  const disabled = loading || isMessageCreating;

  const handleCancel = useCallback(async () => {
    if (loading || isMessageCreating) return;
    setLoading(true);
    try {
      await rejectAndContinueToolCall(messageId, t('globalApproval.cancelReason'));
    } finally {
      // A successful cancel drops the intervention (and often the whole card)
      // out of the list, so this may run after unmount — a no-op in React.
      setLoading(false);
    }
  }, [isMessageCreating, loading, messageId, rejectAndContinueToolCall, t]);

  return (
    <ActionIcon
      aria-label={t('globalApproval.cancel')}
      disabled={disabled}
      icon={X}
      loading={loading}
      size="small"
      title={t('globalApproval.cancel')}
      onClick={handleCancel}
    />
  );
});

CancelInterventionButton.displayName = 'CancelInterventionButton';

export default CancelInterventionButton;
