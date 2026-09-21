'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Building2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ListMeetingRoomsState } from '../../types';
import { RESULT_VISIBLE_ROW_LIMIT } from '../components/constants';
import ErrorNotice from '../components/ErrorNotice';
import { ResultCard, ResultRow } from '../components/ResultCard';
import { toRoomRows } from './rows';

/** `listMeetingRooms` result: dense rows with capacity. */
const RoomList = memo<BuiltinRenderProps<Record<string, unknown>, ListMeetingRoomsState>>(
  ({ pluginError, pluginState }) => {
    const { t } = useTranslation('plugin');

    if (pluginError) return <ErrorNotice error={pluginError} />;

    const rows = toRoomRows(pluginState?.items);
    const total = pluginState?.count ?? rows.length;
    const visible = rows.slice(0, RESULT_VISIBLE_ROW_LIMIT);
    const overflow = Math.max(total - visible.length, 0);

    return (
      <ResultCard
        icon={Building2}
        title={t('builtins.lobe-dingtalk-workspace.ui.apiLabel.listMeetingRooms')}
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
                title={row.name}
                meta={
                  row.capacity
                    ? t('builtins.lobe-dingtalk-workspace.ui.render.capacity', {
                        count: row.capacity,
                      })
                    : undefined
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

RoomList.displayName = 'DingtalkWorkspaceRoomList';

export default RoomList;
