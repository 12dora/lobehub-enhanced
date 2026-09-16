import type { BuiltinServerRuntimeOutput, ReminderScheduleInput } from '@lobechat/types';
import { isReminderTaskConfig } from '@lobechat/types';

import type {
  CancelReminderParams,
  CancelReminderState,
  CreateReminderParams,
  CreateReminderState,
  DirectoryDepartmentHit,
  DirectoryUserHit,
  ListReminderCreatedRow,
  ListRemindersParams,
  ListRemindersState,
  ReceivedReminderView,
  SearchDirectoryParams,
  SearchDirectoryState,
} from '../types';
import {
  formatReminderRecipientLabel,
  isCreatedReminderResult,
  isNeedsClarificationResult,
  isNeedsConfirmationResult,
} from '../types';

export interface CreateReminderRuntimeInput extends CreateReminderParams {
  createdByAgentId?: string | null;
  topicId?: string | null;
}

export interface IReminderService {
  cancel: (taskId: string) => Promise<unknown>;
  create: (input: CreateReminderRuntimeInput) => Promise<unknown>;
  listCreated: (opts?: {
    includeFinished?: boolean;
    limit?: number;
  }) => Promise<ListReminderCreatedRow[]>;
  listReceived: (opts?: { limit?: number }) => Promise<ReceivedReminderView[]>;
  searchDirectory: (
    q: string,
    kind?: 'department' | 'user',
  ) => Promise<{
    ambiguous?: boolean;
    departments: DirectoryDepartmentHit[];
    serverNow: string;
    users: DirectoryUserHit[];
  }>;
}

const WEEKDAY_LABELS = ['', '一', '二', '三', '四', '五', '六', '日'];

const compactJson = (value: unknown): string => JSON.stringify(value);

/** Asia/Shanghai ISO-like clock. `hourCycle: 'h23'` so midnight is 00, not 24. */
const formatServerNow = (now: Date = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+08:00`;
};

/** Every LLM-facing instant must be Asia/Shanghai, never `Date.toISOString()` / Zulu. */
const formatInstant = (value: Date | string | null | undefined): string | null => {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return formatServerNow(date);
};

const describeSchedule = (schedule: ReminderScheduleInput, summary?: string): string => {
  if (summary) return summary;
  const { date, kind, monthDays, time, weekdays } = schedule;
  if (kind === 'once') return `${date ?? ''} ${time} 一次`.trim();
  if (kind === 'daily') return `每天 ${time}`;
  if (kind === 'weekly') {
    const days = (weekdays ?? []).map((day) => WEEKDAY_LABELS[day] ?? String(day)).join('、');
    return days ? `每周${days} ${time}` : `每周 ${time}`;
  }
  const days = (monthDays ?? []).join('、');
  return days ? `每月 ${days} 日 ${time}` : `每月 ${time}`;
};

const hasAmbiguousUsers = (users: DirectoryUserHit[], flagged?: boolean): boolean => {
  if (flagged) return true;
  const counts = new Map<string, number>();
  for (const user of users) {
    const key = user.name.trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count >= 2);
};

const extractErrorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as Record<string, unknown>;
  if (typeof record.code === 'string' && record.code.startsWith('REMINDER_')) return record.code;
  const data = record.data;
  if (data && typeof data === 'object') {
    const code = (data as Record<string, unknown>).code;
    if (typeof code === 'string' && code.startsWith('REMINDER_')) return code;
  }
  if (typeof record.message === 'string') {
    const match = record.message.match(/REMINDER_[A-Z_]+/);
    if (match) return match[0];
  }
  return undefined;
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (
    error &&
    typeof error === 'object' &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return 'Tool execution failed';
};

const withServerNow = (content: string, serverNow: string): string =>
  content.includes('"serverNow"') ? content : `${content}\n${compactJson({ serverNow })}`;

const failResult = (content: string, error?: unknown): BuiltinServerRuntimeOutput => ({
  content: `${content}\n${compactJson({ serverNow: formatServerNow() })}`,
  error,
  success: false,
});

/**
 * Reminder execution runtime. Accepts ReminderTaskService (or a test double)
 * via constructor injection — no React, no Zustand, no `@/services` imports.
 */
export class ReminderExecutionRuntime {
  constructor(private service: IReminderService) {}

  async searchDirectory(args: SearchDirectoryParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.searchDirectory(args.q, args.kind);
      const users = result.users ?? [];
      const departments = result.departments ?? [];
      const ambiguous = hasAmbiguousUsers(users, result.ambiguous);
      const serverNow = result.serverNow || formatServerNow();
      const payload = {
        ambiguous,
        departments: departments.map((dept) => ({
          deptId: dept.deptId,
          memberCount: dept.memberCount,
          name: dept.name,
          pathNames: dept.pathNames,
        })),
        serverNow,
        users: users.map((user) => ({
          active: user.active,
          deptPath: user.deptPath,
          leafDeptName: user.leafDeptName,
          name: user.name,
          staffId: user.staffId,
        })),
      };
      const instruction = ambiguous
        ? '存在同名人员，请列出「姓名 · 部门」请用户选择后再调用 createReminder，不要猜测。'
        : '可使用 staffId / deptId（staff:<id>/dept:<id>）或姓名调用 createReminder。';
      const state: SearchDirectoryState = {
        ambiguous,
        departmentCount: departments.length,
        hits: { departments, users },
        serverNow,
        userCount: users.length,
      };
      return {
        content: `${instruction}\n${compactJson(payload)}`,
        state,
        success: true,
      };
    } catch (error) {
      return failResult(errorMessage(error), error);
    }
  }

  async createReminder(args: CreateReminderRuntimeInput): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.create(args);
      const serverNow = formatServerNow();

      if (isNeedsClarificationResult(result)) {
        const state: CreateReminderState = {
          ambiguous: result.ambiguous,
          needsClarification: true,
          serverNow,
          status: 'needs_clarification',
          success: true,
          unknown: result.unknown,
        };
        return {
          content: withServerNow(
            [
              '收件人无法唯一解析，未创建提醒。请列出候选「姓名 · 部门」请用户选择后重试。',
              compactJson({
                ambiguous: result.ambiguous,
                serverNow,
                status: 'needs_clarification',
                unknown: result.unknown,
              }),
            ].join('\n'),
            serverNow,
          ),
          state,
          success: true,
        };
      }

      if (isNeedsConfirmationResult(result)) {
        const state: CreateReminderState = {
          audience: result.audience,
          needsConfirmation: true,
          serverNow,
          status: 'needs_confirmation',
          success: true,
        };
        return {
          content: withServerNow(
            [
              '部门受众较大，需要用户确认后再创建。未创建提醒。',
              '请向用户确认后，以 confirmLargeAudience=true 再次调用 createReminder。',
              compactJson({
                audience: result.audience,
                serverNow,
                status: 'needs_confirmation',
              }),
            ].join('\n'),
            serverNow,
          ),
          state,
          success: true,
        };
      }

      if (!isCreatedReminderResult(result)) {
        return failResult(`Unexpected createReminder result`);
      }

      const config = isReminderTaskConfig(result.task.config)
        ? result.task.config.reminder
        : undefined;
      const recipients = result.reminder.recipients ?? [];
      const scheduleSummary = describeSchedule(args.schedule, config?.scheduleSummary);
      const nextFireAt = result.reminder.fireAt ?? undefined;
      const nextFireLabel = formatInstant(nextFireAt) ?? '';
      const recipientLabels = recipients.map(formatReminderRecipientLabel).join('、') || '（无）';
      const state: CreateReminderState = {
        needsClarification: false,
        needsConfirmation: false,
        reminder: {
          content: result.reminder.content,
          identifier: result.task.identifier,
          nextFireAt,
          recipients,
          reminderId: result.reminder.id,
          scheduleSummary,
          taskId: result.task.id,
        },
        serverNow,
        status: 'created',
        success: true,
      };
      return {
        content: [
          '已创建定时提醒',
          `- 收件人: ${recipientLabels}`,
          `- 时间: ${nextFireLabel}`,
          `- 周期: ${scheduleSummary}`,
          `- 内容: ${result.reminder.content}`,
          `- 任务编号: ${result.task.identifier}`,
          compactJson({
            serverNow,
            taskId: result.task.id,
            taskIdentifier: result.task.identifier,
          }),
        ].join('\n'),
        state,
        success: true,
      };
    } catch (error) {
      const code = extractErrorCode(error);
      const message = errorMessage(error);
      const content =
        code === 'REMINDER_TIME_PAST'
          ? `发送时间无效（REMINDER_TIME_PAST）：${message}`
          : code === 'REMINDER_CONTENT_EMPTY'
            ? `提醒内容为空（REMINDER_CONTENT_EMPTY）：${message}`
            : code === 'REMINDER_RECIPIENT_UNKNOWN'
              ? `收件人无法解析（REMINDER_RECIPIENT_UNKNOWN）：${message}`
              : message;
      return failResult(content, error);
    }
  }

  async listReminders(args: ListRemindersParams = {}): Promise<BuiltinServerRuntimeOutput> {
    try {
      const scope = args.scope === 'received' ? 'received' : 'created';
      const serverNow = formatServerNow();
      if (scope === 'received') {
        const items = await this.service.listReceived();
        const state: ListRemindersState = {
          count: items.length,
          items,
          scope,
          serverNow,
          success: true,
        };
        return {
          content: compactJson({
            items: items.map((item) => ({
              content: item.content,
              creatorName: item.creatorName,
              firedAt: formatInstant(item.firedAt),
            })),
            scope,
            serverNow,
          }),
          state,
          success: true,
        };
      }

      const items = await this.service.listCreated();
      const state: ListRemindersState = {
        count: items.length,
        items,
        scope,
        serverNow,
        success: true,
      };
      return {
        content: compactJson({
          items: items.map((item) => ({
            content: item.content,
            nextFireAt: formatInstant(item.nextFireAt),
            recipients: (item.recipients ?? []).map(formatReminderRecipientLabel),
            scheduleSummary: item.scheduleSummary,
            status: item.status,
            taskId: item.taskId,
            taskIdentifier: item.taskIdentifier,
          })),
          scope,
          serverNow,
        }),
        state,
        success: true,
      };
    } catch (error) {
      return failResult(errorMessage(error), error);
    }
  }

  async cancelReminder(args: CancelReminderParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      await this.service.cancel(args.taskId);
      const serverNow = formatServerNow();
      const state: CancelReminderState = { serverNow, success: true, taskId: args.taskId };
      return {
        content: `已取消提醒 ${args.taskId}\n${compactJson({ serverNow, taskId: args.taskId })}`,
        state,
        success: true,
      };
    } catch (error) {
      return failResult(errorMessage(error), error);
    }
  }
}

export const createReminderRuntime = (service: IReminderService) =>
  new ReminderExecutionRuntime(service);
