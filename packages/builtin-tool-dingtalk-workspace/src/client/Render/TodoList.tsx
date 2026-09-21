'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CheckSquare } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ListTodosState } from '../../types';
import { RESULT_VISIBLE_ROW_LIMIT } from '../components/constants';
import ErrorNotice from '../components/ErrorNotice';
import { ResultCard, ResultRow } from '../components/ResultCard';
import { toTodoRows } from './rows';

const PRIORITY_KEYS = {
  10: 'builtins.lobe-dingtalk-workspace.ui.render.priority.low',
  20: 'builtins.lobe-dingtalk-workspace.ui.render.priority.normal',
  30: 'builtins.lobe-dingtalk-workspace.ui.render.priority.high',
  40: 'builtins.lobe-dingtalk-workspace.ui.render.priority.urgent',
} as const;

const priorityKey = (priority?: number) =>
  priority === 10 || priority === 20 || priority === 30 || priority === 40
    ? PRIORITY_KEYS[priority]
    : undefined;

/** `listTodos` result: dense rows with due time and priority. */
const TodoList = memo<BuiltinRenderProps<Record<string, unknown>, ListTodosState>>(
  ({ pluginError, pluginState }) => {
    const { t } = useTranslation('plugin');

    if (pluginError) return <ErrorNotice error={pluginError} />;

    const rows = toTodoRows(pluginState?.items);
    const total = pluginState?.count ?? rows.length;
    const visible = rows.slice(0, RESULT_VISIBLE_ROW_LIMIT);
    const overflow = Math.max(total - visible.length, 0);

    return (
      <ResultCard
        icon={CheckSquare}
        title={t('builtins.lobe-dingtalk-workspace.ui.apiLabel.listTodos')}
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
            {visible.map((row) => {
              const priority = priorityKey(row.priority);

              return (
                <ResultRow
                  key={row.key}
                  meta={[row.due, priority ? t(priority) : undefined].filter(Boolean).join(' · ')}
                  title={row.subject}
                  tag={t(
                    row.isDone
                      ? 'builtins.lobe-dingtalk-workspace.ui.render.tag.done'
                      : 'builtins.lobe-dingtalk-workspace.ui.render.tag.pending',
                  )}
                />
              );
            })}
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

TodoList.displayName = 'DingtalkWorkspaceTodoList';

export default TodoList;
