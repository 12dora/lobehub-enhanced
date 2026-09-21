'use client';

import { ActionIcon } from '@lobehub/ui/base-ui';
import { X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Tool result persisted when the user cancels an approval.
 *
 * Deliberately **not** localized: this string is the tool message `content`, the
 * only part of a cancelled intervention the model still sees on the user's next
 * turn (`pluginIntervention` never reaches the LLM). It must read as an
 * instruction to the model, not as UI copy.
 */
export const CANCEL_INTERVENTION_REASON = 'The user cancelled this action. It was not executed.';

interface CancelInterventionButtonProps {
  disabled?: boolean;
  loading?: boolean;
  onCancel: () => void;
}

/**
 * "Cancel this action" affordance for pending approval cards.
 *
 * Presentational on purpose: `ApprovalActions` owns the store call and the
 * in-flight state so that approve, reject and cancel share **one** lock — an X
 * with its own flag would stay clickable through an approve and let the user
 * cancel an action that is already being executed.
 *
 * Mounted by `ApprovalActions`, so it follows the approve / reject footer into
 * every host that shows one (the in-conversation `InterventionBar` and the
 * floating global approval card) and stays off custom interactions (ask-user …),
 * which carry their own close affordance.
 */
const CancelInterventionButton = memo<CancelInterventionButtonProps>(
  ({ disabled, loading, onCancel }) => {
    const { t } = useTranslation('chat');

    return (
      <ActionIcon
        aria-label={t('globalApproval.cancel')}
        disabled={disabled}
        icon={X}
        loading={loading}
        size="small"
        title={t('globalApproval.cancel')}
        onClick={onCancel}
      />
    );
  },
);

CancelInterventionButton.displayName = 'CancelInterventionButton';

export default CancelInterventionButton;
