'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { CreateReminderParams, CreateReminderState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    align-items: center;

    min-width: 0;
    max-width: 240px;
    margin-inline-start: 6px;
    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  identifierChip: css`
    flex-shrink: 0;

    margin-inline-start: 6px;
    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  warnChip: css`
    flex-shrink: 0;

    margin-inline-start: 6px;
    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorWarning};

    background: ${cssVar.colorWarningBg};
  `,
}));

export const CreateReminderInspector = memo<
  BuiltinInspectorProps<CreateReminderParams, CreateReminderState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const content = args?.content || partialArgs?.content;
  const reminderId = pluginState?.reminder?.id;
  const recipientCount = args?.recipients?.length ?? partialArgs?.recipients?.length;

  if (isArgumentsStreaming && !content) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-reminder.apiName.createReminder')}</span>
      </div>
    );
  }

  return (
    <div
      style={{ flexWrap: 'wrap', gap: 4 }}
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-reminder.apiName.createReminder')}</span>
      {reminderId && <span className={styles.identifierChip}>{reminderId}</span>}
      {pluginState?.needsConfirmation && (
        <span className={styles.warnChip} style={{ color: cssVar.colorWarning }}>
          {t('builtins.lobe-reminder.inspector.needsConfirmation')}
        </span>
      )}
      {content && <span className={styles.chip}>{content}</span>}
      {typeof recipientCount === 'number' && recipientCount > 0 && (
        <span className={styles.identifierChip}>{recipientCount}</span>
      )}
    </div>
  );
});

CreateReminderInspector.displayName = 'CreateReminderInspector';
