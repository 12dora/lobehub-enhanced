'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Users } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SearchDirectoryState } from '../../types';
import { RESULT_VISIBLE_ROW_LIMIT } from '../components/constants';
import ErrorNotice from '../components/ErrorNotice';
import { ResultCard, ResultRow } from '../components/ResultCard';
import { toDirectoryRows } from './rows';
import { useUnnamedText } from './unnamed';

/** `searchDirectory` result: people and departments that matched. */
const DirectoryList = memo<BuiltinRenderProps<Record<string, unknown>, SearchDirectoryState>>(
  ({ pluginError, pluginState }) => {
    const { t } = useTranslation('plugin');
    const unnamed = useUnnamedText();

    if (pluginError) return <ErrorNotice error={pluginError} />;

    const rows = toDirectoryRows(pluginState?.hits);
    const visible = rows.slice(0, RESULT_VISIBLE_ROW_LIMIT);
    const overflow = Math.max(rows.length - visible.length, 0);

    return (
      <ResultCard
        icon={Users}
        title={t('builtins.lobe-dingtalk-workspace.ui.apiLabel.searchDirectory')}
        meta={
          pluginState?.ambiguous
            ? t('builtins.lobe-dingtalk-workspace.ui.render.ambiguous')
            : undefined
        }
      >
        {visible.length === 0 ? (
          <span style={{ color: cssVar.colorTextTertiary, fontSize: 13 }}>
            {t('builtins.lobe-dingtalk-workspace.ui.render.empty')}
          </span>
        ) : (
          <Flexbox gap={6}>
            {visible.map((row) => (
              <ResultRow
                key={row.key}
                meta={row.meta}
                title={
                  row.name ?? (row.kind === 'department' ? unnamed.department : unnamed.person)
                }
              />
            ))}
            {overflow > 0 && (
              <span style={{ color: cssVar.colorTextTertiary, fontSize: 12 }}>
                {t('builtins.lobe-dingtalk-workspace.ui.render.more', { count: overflow })}
              </span>
            )}
          </Flexbox>
        )}
      </ResultCard>
    );
  },
);

DirectoryList.displayName = 'DingtalkWorkspaceDirectoryList';

export default DirectoryList;
