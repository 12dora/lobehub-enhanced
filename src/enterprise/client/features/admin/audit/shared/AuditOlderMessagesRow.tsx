'use client';

import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  row: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: center;

    margin-block-end: 8px;

    font-size: 12px;
  `,
}));

export interface AuditOlderMessagesRowProps {
  /** Shown once the oldest message is on screen; omit to render nothing at the start. */
  endLabel?: string;
  /** Failure of the last older-page request; the button retries it. */
  error?: string | null;
  hasOlder: boolean;
  loadingOlder?: boolean;
  onLoadOlder: () => void;
}

/**
 * Head of an audit transcript (newest at the bottom): the "load earlier messages" control with
 * its loading state, the failure of the last attempt, or the start-of-conversation marker.
 */
const AuditOlderMessagesRow = memo<AuditOlderMessagesRowProps>(
  ({ endLabel, error, hasOlder, loadingOlder, onLoadOlder }) => {
    const { t } = useTranslation('admin');

    if (hasOlder) {
      return (
        <div className={styles.row}>
          {error ? (
            <Text role="alert" type="danger">
              {error}
            </Text>
          ) : null}
          <Button loading={loadingOlder} size="small" type="default" onClick={onLoadOlder}>
            {t('audit.live.messages.loadOlder')}
          </Button>
        </div>
      );
    }

    if (!endLabel) return null;

    return (
      <div className={styles.row}>
        <Text type="secondary">{endLabel}</Text>
      </div>
    );
  },
);

AuditOlderMessagesRow.displayName = 'AuditOlderMessagesRow';

export default AuditOlderMessagesRow;
