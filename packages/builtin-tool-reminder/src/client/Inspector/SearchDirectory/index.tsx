'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { SearchDirectoryParams, SearchDirectoryState } from '../../../types';

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
  countChip: css`
    flex-shrink: 0;

    margin-inline-start: 6px;
    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
}));

export const SearchDirectoryInspector = memo<
  BuiltinInspectorProps<SearchDirectoryParams, SearchDirectoryState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const query = args?.q || partialArgs?.q;
  const hitCount = (pluginState?.userCount ?? 0) + (pluginState?.departmentCount ?? 0);

  if (isArgumentsStreaming && !query) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-reminder.apiName.searchDirectory')}</span>
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
      <span>{t('builtins.lobe-reminder.apiName.searchDirectory')}</span>
      {query && <span className={styles.chip}>{query}</span>}
      {pluginState?.ambiguous && (
        <span className={styles.countChip}>{t('builtins.lobe-reminder.inspector.ambiguous')}</span>
      )}
      {!isLoading && !isArgumentsStreaming && typeof pluginState?.userCount === 'number' && (
        <span className={styles.countChip}>{hitCount}</span>
      )}
    </div>
  );
});

SearchDirectoryInspector.displayName = 'SearchDirectoryInspector';
