'use client';

import { Tag } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { CheckSquare } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ListMyTodosState, TodoItem } from '../../types';
import { RESULT_VISIBLE_ROW_LIMIT } from '../components/constants';
import { ExpandableList, ResultCard, ResultNote } from '../components/ResultCard';
import { cardStyles } from '../components/styles';
import type { PriorityLevel } from './format';
import { asRows, asText, formatDateTime, isOverdue, toPriorityLevel } from './format';

const PRIORITY_TAG_COLOR: Partial<Record<PriorityLevel, string>> = {
  high: 'warning',
  urgent: 'error',
};

const TODO_STATUSES = new Set(['all', 'done', 'open']);

interface TodoListProps {
  state: ListMyTodosState;
  title: string;
}

/**
 * `listMyTodos` result: the user's own DingTalk todos (including the ones they
 * created in the DingTalk client) with due date, priority and an overdue flag.
 */
const TodoList = memo<TodoListProps>(({ state, title }) => {
  const { t } = useTranslation('plugin');
  const todos = asRows<TodoItem>(state.todos);
  const status = TODO_STATUSES.has(state.status) ? state.status : undefined;
  // Only an open list can say a todo is late: a done or mixed list does not
  // tell which rows are still open.
  const canBeOverdue = status === 'open';
  const now = Date.now();
  const page = typeof state.page === 'number' && state.page > 1 ? state.page : undefined;

  const meta = [
    status ? t(`builtins.lobe-dingtalk-personal.render.todo.status.${status}` as const) : undefined,
    todos.length > 0
      ? t('builtins.lobe-dingtalk-personal.render.count', { count: todos.length })
      : undefined,
    page ? t('builtins.lobe-dingtalk-personal.render.page', { page }) : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ResultCard icon={CheckSquare} meta={meta || undefined} title={title}>
      {todos.length === 0 ? (
        <ResultNote>{t('builtins.lobe-dingtalk-personal.render.todo.empty')}</ResultNote>
      ) : (
        <ExpandableList
          items={todos}
          limit={RESULT_VISIBLE_ROW_LIMIT}
          renderItem={(todo, index) => {
            const due = formatDateTime(todo.dueTime);
            const overdue = canBeOverdue && isOverdue(todo.dueTime, now);
            const priority = toPriorityLevel(todo.priority);

            return (
              <div className={cardStyles.row} key={todo.taskId ?? String(index)}>
                <span className={cardStyles.rowTitle}>
                  {asText(todo.subject) ?? t('builtins.lobe-dingtalk-personal.render.unnamed.todo')}
                </span>
                {due && (
                  <span className={cx(cardStyles.rowMeta, overdue && cardStyles.overdue)}>
                    {overdue
                      ? t('builtins.lobe-dingtalk-personal.render.todo.overdueAt', { time: due })
                      : t('builtins.lobe-dingtalk-personal.render.todo.dueAt', { time: due })}
                  </span>
                )}
                {priority && priority !== 'normal' && (
                  <Tag
                    className={cardStyles.actionTag}
                    color={PRIORITY_TAG_COLOR[priority]}
                    size={'small'}
                  >
                    {t(`builtins.lobe-dingtalk-personal.render.priority.${priority}` as const)}
                  </Tag>
                )}
              </div>
            );
          }}
        />
      )}
      {state.hasMore === true && (
        <ResultNote>{t('builtins.lobe-dingtalk-personal.render.todo.hasMore')}</ResultNote>
      )}
    </ResultCard>
  );
});

TodoList.displayName = 'DingtalkPersonalTodoList';

export default TodoList;
