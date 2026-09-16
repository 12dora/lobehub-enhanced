'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { ListIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DEFAULT_REMINDER_TIMEZONE,
  formatReminderTime,
} from '@/features/AgentTasks/ReminderList/formatters';

import type { ListRemindersParams, ListRemindersState } from '../../../types';
import { ReminderCard } from '../shared';

/** Rows shown before collapsing into `+N`. */
const MINI_LIST_LIMIT = 5;

interface MiniRow {
  content?: string;
  creatorName?: string;
  fireAt?: Date | string;
  firedAt?: Date | string;
  id?: string;
}

/**
 * The runtime puts the rows in the tool content (`{ items, scope }` JSON) and
 * only the count in the state, so parse the content when it is available.
 */
const parseRows = (content: unknown): MiniRow[] => {
  const payload =
    typeof content === 'string'
      ? (() => {
          try {
            return JSON.parse(content);
          } catch {
            return undefined;
          }
        })()
      : content;

  const items = (payload as { items?: unknown } | undefined)?.items;

  return Array.isArray(items) ? (items as MiniRow[]) : [];
};

/** `listReminders` result: a mini list of the reminders the tool returned. */
export const ListRemindersRender = memo<
  BuiltinRenderProps<ListRemindersParams, ListRemindersState>
>(({ content, pluginState }) => {
  const { t } = useTranslation('plugin');

  const scope = pluginState?.scope === 'received' ? 'received' : 'created';
  const rows = pluginState?.items ?? parseRows(content);
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
            const time = formatReminderTime(row.firedAt ?? row.fireAt, DEFAULT_REMINDER_TIMEZONE);

            return (
              <Text fontSize={13} key={row.id ?? index}>
                {[time, row.content].filter(Boolean).join(' · ')}
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
