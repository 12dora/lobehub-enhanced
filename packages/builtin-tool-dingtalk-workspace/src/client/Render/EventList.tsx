'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CalendarDays } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ListEventsState } from '../../types';
import { RESULT_VISIBLE_ROW_LIMIT } from '../components/constants';
import ErrorNotice from '../components/ErrorNotice';
import { ResultCard, ResultRow } from '../components/ResultCard';
import { toEventRows } from './rows';
import { useUnnamedText } from './unnamed';

/** `listEvents` result: dense rows with time range and location. */
const EventList = memo<BuiltinRenderProps<Record<string, unknown>, ListEventsState>>(
  ({ pluginError, pluginState }) => {
    const { t } = useTranslation('plugin');
    const unnamed = useUnnamedText();

    if (pluginError) return <ErrorNotice error={pluginError} />;

    const rows = toEventRows(pluginState?.items);
    const total = pluginState?.count ?? rows.length;
    const visible = rows.slice(0, RESULT_VISIBLE_ROW_LIMIT);
    const overflow = Math.max(total - visible.length, 0);

    return (
      <ResultCard
        icon={CalendarDays}
        title={t('builtins.lobe-dingtalk-workspace.ui.apiLabel.listEvents')}
        meta={
          total > 0
            ? t('builtins.lobe-dingtalk-workspace.ui.render.count', { count: total })
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
                meta={[row.timeRange, row.location].filter(Boolean).join(' · ')}
                title={row.summary ?? unnamed.event}
                tag={
                  row.isAllDay ? t('builtins.lobe-dingtalk-workspace.ui.render.allDay') : undefined
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

EventList.displayName = 'DingtalkWorkspaceEventList';

export default EventList;
