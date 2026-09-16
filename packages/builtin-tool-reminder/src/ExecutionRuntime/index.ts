import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  CancelReminderParams,
  CancelReminderState,
  CreateReminderParams,
  CreateReminderState,
  DirectoryDepartmentHit,
  DirectoryUserHit,
  ListRemindersParams,
  ListRemindersState,
  NeedsConfirmationAudience,
  ReceivedReminderView,
  ReminderView,
  SearchDirectoryParams,
  SearchDirectoryState,
} from '../types';
import { isNeedsConfirmationResult } from '../types';

export interface IReminderService {
  cancel: (id: string) => Promise<unknown>;
  create: (
    input: CreateReminderParams,
  ) => Promise<ReminderView | { audience: NeedsConfirmationAudience[]; needsConfirmation: true }>;
  listCreated: (opts?: { limit?: number; status?: string }) => Promise<ReminderView[]>;
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

const formatFireAt = (value: Date | string): string => {
  if (value instanceof Date) return value.toISOString();
  return value;
};

const formatRepeat = (repeat: ReminderView['repeat']): string => {
  if (!repeat) return '一次性';
  if (repeat.freq === 'daily') return `每天 ${repeat.time}`;
  if (repeat.freq === 'weekly') {
    const days = (repeat.weekdays ?? [])
      .map((day) => WEEKDAY_LABELS[day] ?? String(day))
      .join('、');
    return days ? `每周${days} ${repeat.time}` : `每周 ${repeat.time}`;
  }
  if (repeat.freq === 'monthly') {
    const days = (repeat.monthDays ?? []).join('、');
    return days ? `每月 ${days} 日 ${repeat.time}` : `每月 ${repeat.time}`;
  }
  return repeat.freq;
};

const formatRecipient = (recipient: NonNullable<ReminderView['recipients']>[number]): string => {
  if (recipient.kind === 'department') {
    const count = typeof recipient.memberCount === 'number' ? ` · ${recipient.memberCount} 人` : '';
    return `@${recipient.displayName}${count}`;
  }
  const dept = recipient.deptName ? ` · ${recipient.deptName}` : '';
  return `@${recipient.displayName}${dept}`;
};

const toReminderView = (
  row: ReminderView & { repeatRule?: ReminderView['repeat'] },
): ReminderView => ({
  content: row.content,
  creatorName: row.creatorName,
  fireAt: row.fireAt,
  id: row.id,
  recipients: row.recipients,
  repeat: row.repeat ?? row.repeatRule ?? null,
  status: row.status,
});

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

/**
 * Reminder execution runtime. Accepts ReminderService (or a test double) via
 * constructor injection — no React, no Zustand, no `@/services` imports.
 */
export class ReminderExecutionRuntime {
  constructor(private service: IReminderService) {}

  async searchDirectory(args: SearchDirectoryParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.searchDirectory(args.q, args.kind);
      const users = result.users ?? [];
      const departments = result.departments ?? [];
      const ambiguous = hasAmbiguousUsers(users, result.ambiguous);
      const payload = {
        ambiguous,
        departments: departments.map((dept) => ({
          deptId: dept.deptId,
          memberCount: dept.memberCount,
          name: dept.name,
          pathNames: dept.pathNames,
        })),
        serverNow: result.serverNow,
        users: users.map((user) => ({
          active: user.active,
          deptPath: user.deptPath,
          leafDeptName: user.leafDeptName,
          name: user.name,
          staffId: user.staffId,
        })),
      };
      const instruction = ambiguous
        ? '存在同名人员，请列出「姓名 · 最小部门」请用户选择后再调用 createReminder，不要猜测，也不要创建。'
        : '请使用返回的 staffId / deptId 调用 createReminder，不要用姓名猜测。';
      const state: SearchDirectoryState = {
        ambiguous,
        departmentCount: departments.length,
        hits: { departments, users },
        serverNow: result.serverNow,
        userCount: users.length,
      };
      return {
        content: `${instruction}\n${JSON.stringify(payload, null, 2)}`,
        state,
        success: true,
      };
    } catch (error) {
      return {
        content: errorMessage(error),
        error,
        success: false,
      };
    }
  }

  async createReminder(args: CreateReminderParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.create(args);
      if (isNeedsConfirmationResult(result)) {
        const state: CreateReminderState = {
          audience: result.audience,
          needsConfirmation: true,
          success: true,
        };
        return {
          content: [
            '部门受众超过 30 人，需要用户确认后再创建。未创建提醒。',
            '请向用户确认后，以 confirmLargeAudience=true 再次调用 createReminder。',
            JSON.stringify({ audience: result.audience, needsConfirmation: true }, null, 2),
          ].join('\n'),
          state,
          success: true,
        };
      }

      const reminder = toReminderView(result);
      const recipients = (reminder.recipients ?? []).map(formatRecipient).join('、') || '（无）';
      const state: CreateReminderState = {
        needsConfirmation: false,
        reminder,
        success: true,
      };
      return {
        content: [
          '已创建定时提醒',
          `- 收件人: ${recipients}`,
          `- 时间: ${formatFireAt(reminder.fireAt)}`,
          `- 周期: ${formatRepeat(reminder.repeat)}`,
          `- 内容: ${reminder.content}`,
          `- id: ${reminder.id}`,
          `- 设置人: ${reminder.creatorName}`,
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
          : code === 'REMINDER_RECIPIENT_UNKNOWN'
            ? `收件人无法解析（REMINDER_RECIPIENT_UNKNOWN）：${message}`
            : message;
      return {
        content,
        error,
        success: false,
      };
    }
  }

  async listReminders(args: ListRemindersParams = {}): Promise<BuiltinServerRuntimeOutput> {
    try {
      const scope = args.scope === 'received' ? 'received' : 'created';
      if (scope === 'received') {
        const items = await this.service.listReceived();
        const state: ListRemindersState = { count: items.length, items, scope, success: true };
        return {
          content: JSON.stringify({ items, scope }, null, 2),
          state,
          success: true,
        };
      }

      const items = (await this.service.listCreated()).map(toReminderView);
      const state: ListRemindersState = { count: items.length, items, scope, success: true };
      return {
        content: JSON.stringify({ items, scope }, null, 2),
        state,
        success: true,
      };
    } catch (error) {
      return {
        content: errorMessage(error),
        error,
        success: false,
      };
    }
  }

  async cancelReminder(args: CancelReminderParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      await this.service.cancel(args.id);
      const state: CancelReminderState = { id: args.id, success: true };
      return {
        content: `已取消提醒 ${args.id}`,
        state,
        success: true,
      };
    } catch (error) {
      return {
        content: errorMessage(error),
        error,
        success: false,
      };
    }
  }
}

export const createReminderRuntime = (service: IReminderService) =>
  new ReminderExecutionRuntime(service);
