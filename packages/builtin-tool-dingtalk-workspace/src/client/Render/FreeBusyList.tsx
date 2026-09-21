'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Clock } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { QueryFreeBusyState } from '../../types';
import ErrorNotice from '../components/ErrorNotice';
import { ResultCard, ResultRow } from '../components/ResultCard';
import { toFreeBusyRows } from './rows';
import { useUnnamedText } from './unnamed';

/**
 * `queryFreeBusy` result: one row per person with their busy blocks. Titles and
 * details of other people's events are never part of this payload.
 */
const FreeBusyList = memo<BuiltinRenderProps<Record<string, unknown>, QueryFreeBusyState>>(
  ({ pluginError, pluginState }) => {
    const { t } = useTranslation('plugin');
    const unnamed = useUnnamedText();

    if (pluginError) return <ErrorNotice error={pluginError} />;

    const rows = toFreeBusyRows(pluginState?.people);

    return (
      <ResultCard
        icon={Clock}
        title={t('builtins.lobe-dingtalk-workspace.ui.apiLabel.queryFreeBusy')}
      >
        {rows.length === 0 ? (
          <span style={{ color: cssVar.colorTextTertiary, fontSize: 13 }}>
            {t('builtins.lobe-dingtalk-workspace.ui.render.empty')}
          </span>
        ) : (
          <Flexbox gap={6}>
            {rows.map((row) => (
              <ResultRow
                key={row.key}
                meta={row.ranges || undefined}
                title={row.name ?? unnamed.person}
                tag={
                  row.blockCount > 0
                    ? t('builtins.lobe-dingtalk-workspace.ui.render.busyBlocks', {
                        count: row.blockCount,
                      })
                    : t('builtins.lobe-dingtalk-workspace.ui.render.free')
                }
              />
            ))}
          </Flexbox>
        )}
      </ResultCard>
    );
  },
);

FreeBusyList.displayName = 'DingtalkWorkspaceFreeBusyList';

export default FreeBusyList;
