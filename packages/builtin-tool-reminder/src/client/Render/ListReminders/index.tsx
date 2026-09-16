'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { ListIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import {
  DEFAULT_REMINDER_TIMEZONE,
  formatReminderTime,
} from '@/features/AgentTasks/ReminderList/formatters';

import type { ListReminderRow, ListRemindersParams, ListRemindersState } from '../../../types';
import { isListReminderRow, listReminderRowTime } from '../../../types';
import { ReminderCard } from '../shared';

/** Rows shown before collapsing into `+N`. */
const MINI_LIST_LIMIT = 5;

/**
 * The runtime now puts `items` on pluginState. `parseRows(content)` is the
 * fallback for older messages that only had `{ items, scope }` in the tool text.
 */
const parseRows = (content: unknown): ListReminderRow[] => {
  let payload: unknown = content;
  if (typeof content === 'string') {
    try {
      payload = JSON.parse(content);
    } catch {
      return [];
    }
  }

  if (typeof payload !== 'object' || payload === null || !('items' in payload)) return [];
  const { items } = payload;
  return Array.isArray(items) ? items.filter(isListReminderRow) : [];
};

/** `listReminders` result: a mini list of the reminders the tool returned. */
export const ListRemindersRender = memo<
  BuiltinRenderProps<ListRemindersParams, ListRemindersState>
>(({ content, pluginState }) => {
  const { t } = useTranslation('plugin');

  const scope = pluginState?.scope === 'received' ? 'received' : 'created';
  const rows: ListReminderRow[] = pluginState?.items ?? parseRows(content);
  const count = pluginState?.count ?? rows.length;
  const visible = rows.slice(0, MINI_LIST_LIMIT);
  const overflow = Math.max(count - visible.length, 0);

  return (
    <ReminderCard
      icon={ListIcon}
      title={t(
        scope === 'received'
          ? 'builtins.lobe-reminder.render.list.title.received'
          : 'builtins.lobe-reminder.render.list.title.created',
      )}
    >
      {count === 0 ? (
        <Text fontSize={13} style={{ color: cssVar.colorTextTertiary }}>
          {t('builtins.lobe-reminder.render.list.empty')}
        </Text>
      ) : (
        <>
          {visible.map((row, index) => {
            const time = formatReminderTime(listReminderRowTime(row), DEFAULT_REMINDER_TIMEZONE);
            const identifier = 'taskIdentifier' in row ? row.taskIdentifier : undefined;
            const label = [time, row.content].filter(Boolean).join(' · ');

            return (
              <Text fontSize={13} key={row.id ?? identifier ?? index}>
                {identifier ? <Link to={`/task/${identifier}`}>{identifier}</Link> : null}
                {identifier ? ' · ' : null}
                {label}
              </Text>
            );
          })}
          {overflow > 0 && (
            <Text fontSize={12} style={{ color: cssVar.colorTextTertiary }}>
              {t('builtins.lobe-reminder.render.list.more', { count: overflow })}
            </Text>
          )}
        </>
      )}
    </ReminderCard>
  );
});

ListRemindersRender.displayName = 'ListRemindersRender';

export default ListRemindersRender;
