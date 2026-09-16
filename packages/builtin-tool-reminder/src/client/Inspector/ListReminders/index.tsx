'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ListRemindersParams, ListRemindersState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  countChip: css`
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
  scope: css`
    flex-shrink: 0;
    margin-inline-start: 6px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

export const ListRemindersInspector = memo<
  BuiltinInspectorProps<ListRemindersParams, ListRemindersState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const scope = args?.scope || partialArgs?.scope || pluginState?.scope;
  const count = pluginState?.count;

  if (isArgumentsStreaming && !scope) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-reminder.apiName.listReminders')}</span>
      </div>
    );
  }

  return (
    <div
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-reminder.apiName.listReminders')}</span>
      {scope && <span className={styles.scope}>· {scope}</span>}
      {typeof count === 'number' && <span className={styles.countChip}>{count}</span>}
    </div>
  );
});

ListRemindersInspector.displayName = 'ListRemindersInspector';
