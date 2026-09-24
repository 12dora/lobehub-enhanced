'use client';

import { Flexbox } from '@lobehub/ui';
import { cx } from 'antd-style';
import { CheckSquare } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TodoDetailState } from '../../types';
import { ExternalAction, ResultCard, ResultField } from '../components/ResultCard';
import { cardStyles } from '../components/styles';
import { asNames, asText, formatDateTime, isOverdue, toPriorityLevel } from './format';

/** `getTodo` result: one todo with its people, dates and a link back to DingTalk. */
const TodoDetail = memo<{ state: TodoDetailState }>(({ state }) => {
  const { t } = useTranslation('plugin');

  const todo = state.todo && typeof state.todo === 'object' ? state.todo : undefined;
  if (!todo) return null;

  const isDone = todo.isDone === true;
  const due = formatDateTime(todo.dueTime);
  const overdue = !isDone && isOverdue(todo.dueTime);
  const priority = toPriorityLevel(todo.priority);
  const createdTime = formatDateTime(todo.createdTime);
  const creator = asText(todo.creatorName);
  const executors = asNames(todo.executorNames);
  const participants = asNames(todo.participantNames);

  return (
    <ResultCard
      icon={CheckSquare}
      title={asText(todo.subject) ?? t('builtins.lobe-dingtalk-personal.render.unnamed.todo')}
      meta={
        isDone
          ? t('builtins.lobe-dingtalk-personal.render.todo.status.done')
          : t('builtins.lobe-dingtalk-personal.render.todo.status.open')
      }
    >
      <Flexbox gap={6}>
        {due && (
          <ResultField label={t('builtins.lobe-dingtalk-personal.render.field.due')}>
            <span className={cx(overdue && cardStyles.overdue)}>
              {overdue
                ? t('builtins.lobe-dingtalk-personal.render.todo.overdueAt', { time: due })
                : due}
            </span>
          </ResultField>
        )}
        {priority && (
          <ResultField label={t('builtins.lobe-dingtalk-personal.render.field.priority')}>
            {t(`builtins.lobe-dingtalk-personal.render.priority.${priority}` as const)}
          </ResultField>
        )}
        {creator && (
          <ResultField label={t('builtins.lobe-dingtalk-personal.render.field.creator')}>
            {creator}
          </ResultField>
        )}
        {executors.length > 0 && (
          <ResultField label={t('builtins.lobe-dingtalk-personal.render.field.executors')}>
            {executors.join('、')}
          </ResultField>
        )}
        {participants.length > 0 && (
          <ResultField label={t('builtins.lobe-dingtalk-personal.render.field.participants')}>
            {participants.join('、')}
          </ResultField>
        )}
        {createdTime && (
          <ResultField label={t('builtins.lobe-dingtalk-personal.render.field.createdTime')}>
            {createdTime}
          </ResultField>
        )}
      </Flexbox>
      <ExternalAction href={todo.detailUrl}>
        {t('builtins.lobe-dingtalk-personal.render.openInDingtalk')}
      </ExternalAction>
    </ResultCard>
  );
});

TodoDetail.displayName = 'DingtalkPersonalTodoDetail';

export default TodoDetail;
