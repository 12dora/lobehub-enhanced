'use client';

import { BatchFailureReason } from '@lobechat/builtin-tool-dingtalk-workspace/client';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckCircle2, ListChecks, XCircle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { BatchWriteState } from '../../types';
import { ResultCard } from '../components/ResultCard';
import { cardStyles } from '../components/styles';
import { toBatchWriteView } from './batchWrite';

const styles = createStaticStyles(({ css }) => ({
  error: css`
    flex: 0 1 auto;

    min-width: 0;
    max-width: 60%;

    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorErrorText};
    overflow-wrap: anywhere;
  `,
}));

/**
 * Result of a batch write (e.g. `completeTodos`): the server summary on top, then
 * one row per item — ✓ for done, ✗ plus the reason for a failure — so a partial
 * success says exactly which todos still need attention. A failure with a known code
 * reads as that code's short message; otherwise the cleaned reason. Either way the
 * item's fix-it link (https only) sits right after it.
 */
const BatchWriteResult = memo<{ state: BatchWriteState }>(({ state }) => {
  const { t } = useTranslation('plugin');

  const { failed, rows, succeeded, summary } = toBatchWriteView(state);
  if (rows.length === 0 && !summary) return null;

  const title =
    summary ?? t('builtins.lobe-dingtalk-personal.render.batch.result', { failed, succeeded });

  return (
    <ResultCard danger={succeeded === 0 && failed > 0} icon={ListChecks} title={title}>
      {rows.length > 0 && (
        <div className={cardStyles.rows}>
          {rows.map((row) => {
            const name = row.title ?? t('builtins.lobe-dingtalk-personal.render.unnamed.todo');
            const reason = row.errorCode
              ? t(`builtins.lobe-dingtalk-personal.render.error.${row.errorCode}` as const)
              : (row.error ?? t('builtins.lobe-dingtalk-personal.render.error.unknown'));

            return (
              <div className={cardStyles.row} data-status={row.ok ? 'ok' : 'failed'} key={row.key}>
                <Icon
                  icon={row.ok ? CheckCircle2 : XCircle}
                  size={14}
                  style={{
                    color: row.ok ? cssVar.colorSuccess : cssVar.colorError,
                    flexShrink: 0,
                    marginBlockStart: 3,
                  }}
                />
                <span className={cardStyles.rowTitle} title={name}>
                  {name}
                </span>
                {!row.ok && (
                  <span className={styles.error}>
                    <BatchFailureReason
                      actionHref={row.actionHref}
                      actionLabel={row.actionLabel}
                      reason={reason}
                    />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </ResultCard>
  );
});

BatchWriteResult.displayName = 'DingtalkPersonalBatchWriteResult';

export default BatchWriteResult;
