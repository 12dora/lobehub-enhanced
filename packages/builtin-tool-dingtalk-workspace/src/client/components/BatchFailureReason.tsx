'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import LinkedText, { TextLink } from './LinkedText';

interface BatchFailureReasonProps {
  /** Vetted https target of the fix-it link (`toBatchActionHref`), when the item carries one. */
  actionHref?: string;
  actionLabel?: string;
  /** The mapped code title, or the cleaned reason — which may still hold a `[text](url)` link. */
  reason: string;
}

/**
 * Why one item of a batch write failed, plus the link to where it is fixed. Shared by the DingTalk
 * toolsets' batch cards, so a failed row reads and links the same everywhere.
 */
export const BatchFailureReason = memo<BatchFailureReasonProps>(
  ({ actionHref, actionLabel, reason }) => {
    const { t } = useTranslation('plugin');
    // A legacy reason may already link that very page: one link is enough.
    const href = actionHref && !reason.includes(actionHref) ? actionHref : undefined;

    return (
      <>
        <LinkedText text={reason} />
        {href && (
          <>
            {' '}
            <TextLink href={href}>{actionLabel || t('builtins.dingtalk.action.resolve')}</TextLink>
          </>
        )}
      </>
    );
  },
);

BatchFailureReason.displayName = 'DingtalkBatchFailureReason';

export default BatchFailureReason;
