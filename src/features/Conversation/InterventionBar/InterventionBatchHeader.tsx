import { Button } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './style';

export interface InterventionBatchProgress {
  /** 1-based position of the call being decided. */
  current: number;
  mode: 'approve' | 'reject';
  total: number;
}

interface InterventionBatchHeaderProps {
  /** Pending approve / reject calls of the turn. */
  count: number;
  onApproveAll: () => void;
  onRejectAll: () => void;
  onStop: () => void;
  progress?: InterventionBatchProgress;
}

/**
 * 「共 N 项待确认」 with one-click 「全部批准」 / 「全部拒绝」 for calls one assistant
 * turn parked together. While a batch runs it shows 「正在批准 2/3」 and locks both
 * buttons; approve-all can be stopped (the call already approved still runs).
 */
const InterventionBatchHeader = memo<InterventionBatchHeaderProps>(
  ({ count, onApproveAll, onRejectAll, onStop, progress }) => {
    const { t } = useTranslation('chat');
    const busy = !!progress;

    const title = progress
      ? progress.mode === 'approve'
        ? t('tool.intervention.batch.approving', {
            current: progress.current,
            total: progress.total,
          })
        : t('tool.intervention.batch.rejecting', {
            current: progress.current,
            total: progress.total,
          })
      : t('tool.intervention.batch.pendingCount', { count });

    return (
      <div
        className={styles.batchHeader}
        onKeyDown={(event) => {
          // Enter / Space on a focused header button must press that button: the
          // bar's page-level hotkeys would otherwise take Enter as "submit the
          // active call" and swallow the click.
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
        }}
      >
        <span aria-live={'polite'} className={styles.batchTitle}>
          {title}
        </span>
        <div className={styles.batchActions}>
          {progress?.mode === 'approve' && (
            <Button size={'small'} type={'text'} onClick={onStop}>
              {t('tool.intervention.batch.stop')}
            </Button>
          )}
          <Button
            disabled={busy}
            loading={progress?.mode === 'reject'}
            size={'small'}
            onClick={onRejectAll}
          >
            {t('tool.intervention.batch.rejectAll')}
          </Button>
          <Button
            disabled={busy}
            loading={progress?.mode === 'approve'}
            size={'small'}
            type={'primary'}
            onClick={onApproveAll}
          >
            {t('tool.intervention.batch.approveAll')}
          </Button>
        </div>
      </div>
    );
  },
);

InterventionBatchHeader.displayName = 'InterventionBatchHeader';

export default InterventionBatchHeader;
