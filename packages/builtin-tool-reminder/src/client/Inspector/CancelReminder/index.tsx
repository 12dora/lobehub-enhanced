'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { CancelReminderParams, CancelReminderState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  identifierChip: css`
    flex-shrink: 0;

    margin-inline-start: 6px;
    padding-block: 2px;
    padding-inline: 8px;
    border: 1px dashed ${cssVar.colorErrorBorder};
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorError};
    text-decoration: line-through;

    background: transparent;
  `,
}));

export const CancelReminderInspector = memo<
  BuiltinInspectorProps<CancelReminderParams, CancelReminderState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const taskId = args?.taskId || partialArgs?.taskId || pluginState?.taskId;

  return (
    <div
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span style={{ color: cssVar.colorError }}>
        {t('builtins.lobe-reminder.apiName.cancelReminder')}
      </span>
      {taskId && <span className={styles.identifierChip}>{taskId}</span>}
    </div>
  );
});

CancelReminderInspector.displayName = 'CancelReminderInspector';
