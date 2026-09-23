'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CheckSquare, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TodoView } from '../../types';
import { RESULT_VISIBLE_ROW_LIMIT } from '../components/constants';
import { maskIdentifiers } from '../components/displayText';
import ErrorNotice from '../components/ErrorNotice';
import { ResultCard, ResultRow } from '../components/ResultCard';
import type { TodoRow } from './rows';
import { formatDateTime, toTodoRows } from './rows';
import { useUnnamedText } from './unnamed';

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

/** A merged todo card: the service reports `done`, the runtime adds `isDone`. */
type MergedTodoView = TodoView & { done?: boolean };

interface PendingApprovalView {
  createdAt?: number | string;
  originatorName?: string;
  processInstanceId?: string;
  taskId?: string;
  title?: string;
}

/**
 * Both `listTodos` shapes. The merged「我的钉钉待办」view (`approvals` / `appTodos` /
 * `orgTodos` / `notes`) replaced `{ items, count }`, which older messages still hold.
 */
interface TodoListState {
  approvals?: { count?: number; items?: PendingApprovalView[]; truncated?: boolean };
  appTodos?: MergedTodoView[];
  /** Legacy shape. */
  count?: number;
  /** Legacy shape. */
  items?: MergedTodoView[];
  notes?: string[];
  orgTodos?: MergedTodoView[];
  serverNow?: string;
  success?: boolean;
  truncated?: boolean;
}

/** Object rows only: history may hold anything, and a null row must not crash the card. */
const asRows = <T,>(value: unknown): T[] =>
  Array.isArray(value)
    ? (value.filter((item) => typeof item === 'object' && item !== null) as T[])
    : [];

const toMergedTodoRows = (items: unknown): TodoRow[] =>
  toTodoRows(
    asRows<MergedTodoView>(items).map((todo) => ({
      ...todo,
      isDone: todo.isDone === true || todo.done === true,
    })),
  );

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Past this, a date reads better than「5 周前」. */
const RELATIVE_LIMIT = 30 * DAY;

const RELATIVE_STEPS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['week', 7 * DAY],
  ['day', DAY],
  ['hour', HOUR],
  ['minute', MINUTE],
];

/** DingTalk wall-clock time without an offset is Asia/Shanghai (shared contract §5). */
const WALL_CLOCK = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;

const parseTimestamp = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;

  const text = value.trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return Number(text);

  const wallClock = WALL_CLOCK.exec(text);
  const ms = Date.parse(wallClock ? `${wallClock[1]}T${wallClock[2]}+08:00` : text);

  return Number.isNaN(ms) ? undefined : ms;
};

/** 「3 小时前」 style time; unreadable values show nothing rather than raw text. */
const formatRelativeTime = (value: unknown, locale?: string): string | undefined => {
  const ms = parseTimestamp(value);
  if (ms === undefined) return undefined;

  const elapsed = Math.max(0, Date.now() - ms);
  if (elapsed >= RELATIVE_LIMIT) return formatDateTime(ms)?.split(' ')[0];

  try {
    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

    for (const [unit, size] of RELATIVE_STEPS) {
      if (elapsed >= size) return formatter.format(-Math.floor(elapsed / size), unit);
    }

    return formatter.format(0, 'second');
  } catch {
    return formatDateTime(ms);
  }
};

const Section = ({ children, title }: { children: ReactNode; title?: string }) => (
  <Flexbox gap={6}>
    {title && (
      <span style={{ color: cssVar.colorTextSecondary, fontSize: 12, fontWeight: 500 }}>
        {title}
      </span>
    )}
    {children}
  </Flexbox>
);

const Overflow = ({ count }: { count: number }) => {
  const { t } = useTranslation('plugin');
  if (count <= 0) return null;

  return (
    <span style={{ color: cssVar.colorTextTertiary, fontSize: 12 }}>
      {t('builtins.lobe-dingtalk-workspace.ui.render.more', { count })}
    </span>
  );
};

interface TodoRowsProps {
  rows: TodoRow[];
  title?: string;
  /** Real total when the payload held fewer rows than it counted (legacy `count`). */
  total?: number;
}

const TodoRows = ({ rows, title, total }: TodoRowsProps) => {
  const { t } = useTranslation('plugin');
  const unnamed = useUnnamedText();
  const visible = rows.slice(0, RESULT_VISIBLE_ROW_LIMIT);

  return (
    <Section title={title}>
      {visible.map((row) => {
        const priority = priorityKey(row.priority);

        return (
          <ResultRow
            key={row.key}
            meta={[row.due, priority ? t(priority) : undefined].filter(Boolean).join(' · ')}
            title={row.subject ?? unnamed.todo}
            tag={t(
              row.isDone
                ? 'builtins.lobe-dingtalk-workspace.ui.render.tag.done'
                : 'builtins.lobe-dingtalk-workspace.ui.render.tag.pending',
            )}
          />
        );
      })}
      <Overflow count={Math.max(total ?? 0, rows.length) - visible.length} />
    </Section>
  );
};

/**
 * `listTodos` result — the merged「我的钉钉待办」: approvals waiting for me, todos
 * this assistant created, and org todos when the tenant can read them. Rows show
 * names only; approval and todo ids stay React keys.
 */
const TodoList = memo<BuiltinRenderProps<Record<string, unknown>, TodoListState>>(
  ({ pluginError, pluginState }) => {
    const { i18n, t } = useTranslation('plugin');
    const unnamed = useUnnamedText();

    if (pluginError) return <ErrorNotice error={pluginError} />;

    const state: TodoListState = pluginState ?? {};
    const isMerged =
      state.approvals !== undefined || state.appTodos !== undefined || state.orgTodos !== undefined;

    const approvalItems = asRows<PendingApprovalView>(state.approvals?.items);
    const reportedApprovals = state.approvals?.count;
    const approvalCount =
      typeof reportedApprovals === 'number'
        ? Math.max(reportedApprovals, approvalItems.length)
        : approvalItems.length;
    const appRows = toMergedTodoRows(state.appTodos);
    const orgRows = toMergedTodoRows(state.orgTodos);
    const legacyRows = isMerged ? [] : toMergedTodoRows(state.items);

    const total = isMerged
      ? approvalCount + appRows.length + orgRows.length
      : typeof state.count === 'number'
        ? state.count
        : legacyRows.length;
    const note = (Array.isArray(state.notes) ? state.notes : []).find(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    );
    const locale = i18n?.language;
    const visibleApprovals = approvalItems.slice(0, RESULT_VISIBLE_ROW_LIMIT);

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
        {note && (
          <Flexbox
            horizontal
            align={'flex-start'}
            gap={6}
            style={{ color: cssVar.colorTextTertiary, fontSize: 12, lineHeight: 1.6 }}
          >
            <Icon icon={Info} size={12} style={{ flexShrink: 0, marginBlockStart: 3 }} />
            <span>{note}</span>
          </Flexbox>
        )}
        {total === 0 ? (
          <span style={{ color: cssVar.colorTextTertiary, fontSize: 13 }}>
            {t('builtins.lobe-dingtalk-workspace.ui.render.todo.empty')}
          </span>
        ) : isMerged ? (
          <>
            {approvalCount > 0 && (
              <Section
                title={t('builtins.lobe-dingtalk-workspace.ui.render.todo.approvals', {
                  count: approvalCount,
                })}
              >
                {visibleApprovals.map((approval, index) => (
                  <ResultRow
                    key={approval.taskId ?? approval.processInstanceId ?? String(index)}
                    title={maskIdentifiers(approval.title, unnamed.mask) ?? unnamed.item}
                    meta={[
                      maskIdentifiers(approval.originatorName, unnamed.mask),
                      formatRelativeTime(approval.createdAt, locale),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                ))}
                <Overflow count={approvalCount - visibleApprovals.length} />
              </Section>
            )}
            {appRows.length > 0 && (
              <TodoRows
                rows={appRows}
                title={t('builtins.lobe-dingtalk-workspace.ui.render.todo.appTodos')}
              />
            )}
            {orgRows.length > 0 && (
              <TodoRows
                rows={orgRows}
                title={t('builtins.lobe-dingtalk-workspace.ui.render.todo.orgTodos')}
              />
            )}
          </>
        ) : (
          <TodoRows rows={legacyRows} total={total} />
        )}
      </ResultCard>
    );
  },
);

TodoList.displayName = 'DingtalkWorkspaceTodoList';

export default TodoList;
