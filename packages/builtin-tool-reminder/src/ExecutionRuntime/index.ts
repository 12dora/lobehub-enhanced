import type { BuiltinServerRuntimeOutput, ReminderScheduleInput } from '@lobechat/types';
import { isReminderTaskConfig } from '@lobechat/types';

import type {
  CancelReminderParams,
  CancelReminderState,
  ClarificationCandidate,
  CreateReminderClarificationResult,
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

const CREATE_REMINDER_RETRY_CONTENT =
  '临时冲突，请用相同参数重试一次 createReminder（收件人已解析成功，无需重新搜索）';

/** LLM-visible copy for unexpected failures. Never include raw error text. */
export const REMINDER_INTERNAL_TOOL_CONTENT =
  '提醒操作失败（内部错误），请稍后重试。不要向用户展示技术细节。';

const KNOWN_REMINDER_ERROR_CODES = new Set([
  'REMINDER_CONTENT_EMPTY',
  'REMINDER_CREATE_RETRY',
  'REMINDER_INTERNAL',
  'REMINDER_NOT_FOUND',
  'REMINDER_RECIPIENT_UNKNOWN',
  'REMINDER_SCHEDULE_INVALID',
  'REMINDER_TIME_PAST',
]);

interface ReminderToolFailure {
  code: string;
  message: string;
}

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

const failResult = (content: string, error?: ReminderToolFailure): BuiltinServerRuntimeOutput => ({
  content: `${content}\n${compactJson({ serverNow: formatServerNow() })}`,
  error,
  success: false,
});

const toStaffToken = (staffId: string): string =>
  staffId.startsWith('staff:') ? staffId : `staff:${staffId}`;

const formatClarificationCandidate = (candidate: ClarificationCandidate): string => {
  const token = toStaffToken(candidate.staffId);
  const dept = candidate.leafDeptName || candidate.deptPath;
  return dept ? `${candidate.name} · ${dept}（${token}）` : `${candidate.name}（${token}）`;
};

const formatNarrowedCandidate = (candidate: ClarificationCandidate): string => {
  const token = toStaffToken(candidate.staffId);
  const dept = candidate.leafDeptName || candidate.deptPath;
  return dept ? `${candidate.name} · ${dept}，${token}` : `${candidate.name}，${token}`;
};

const isScheduleToolError = (code: string | undefined, message: string): boolean => {
  if (code === 'REMINDER_SCHEDULE_INVALID') return true;
  return message.startsWith('Missing required field:') || message.startsWith('Invalid schedule:');
};

const friendlyReminderErrorContent = (code: string, message: string): string => {
  switch (code) {
    case 'REMINDER_TIME_PAST': {
      return `发送时间无效（REMINDER_TIME_PAST）：${message}`;
    }
    case 'REMINDER_CONTENT_EMPTY': {
      return `提醒内容为空（REMINDER_CONTENT_EMPTY）：${message}`;
    }
    case 'REMINDER_RECIPIENT_UNKNOWN': {
      return `收件人无法解析（REMINDER_RECIPIENT_UNKNOWN）：${message}`;
    }
    case 'REMINDER_CREATE_RETRY': {
      return CREATE_REMINDER_RETRY_CONTENT;
    }
    case 'REMINDER_SCHEDULE_INVALID': {
      return `日程无效（REMINDER_SCHEDULE_INVALID）：${message}`;
    }
    case 'REMINDER_NOT_FOUND': {
      return `未找到提醒（REMINDER_NOT_FOUND）：${message}`;
    }
    default: {
      return REMINDER_INTERNAL_TOOL_CONTENT;
    }
  }
};

/**
 * Every reminder API funnels failures through this sanitizer. Known REMINDER_*
 * codes keep their friendly copy; anything else becomes a generic internal
 * error. The raw error object is never attached to the LLM-visible payload.
 */
const sanitizeReminderFailure = (
  error: unknown,
): { content: string; error: ReminderToolFailure } => {
  const code = extractErrorCode(error);
  const message = errorMessage(error);

  if (code && KNOWN_REMINDER_ERROR_CODES.has(code) && code !== 'REMINDER_INTERNAL') {
    const content = friendlyReminderErrorContent(code, message);
    return { content, error: { code, message: content } };
  }

  if (isScheduleToolError(code, message)) {
    return {
      content: message,
      error: { code: 'REMINDER_SCHEDULE_INVALID', message },
    };
  }

  console.error('[lobe-reminder] failed', error);
  return {
    content: REMINDER_INTERNAL_TOOL_CONTENT,
    error: { code: 'REMINDER_INTERNAL', message: REMINDER_INTERNAL_TOOL_CONTENT },
  };
};

const reminderFailureResult = (error: unknown): BuiltinServerRuntimeOutput => {
  const sanitized = sanitizeReminderFailure(error);
  return failResult(sanitized.content, sanitized.error);
};

const buildClarificationContent = (
  result: CreateReminderClarificationResult,
  serverNow: string,
): { content: string; state: CreateReminderState } => {
  const unknown = result.unknown ?? [];
  const ambiguous = result.ambiguous ?? [];
  const unknownSuggestions = result.unknownSuggestions;
  const suggestionByQuery = new Map((unknownSuggestions ?? []).map((item) => [item.query, item]));

  const lines = ['收件人无法唯一解析，未创建提醒。'];
  const unknownWithoutSuggestions: string[] = [];

  for (const query of unknown) {
    const suggestion = suggestionByQuery.get(query);
    const candidates = suggestion?.candidates ?? [];
    if (candidates.length === 1) {
      const candidate = candidates[0];
      const listed = formatClarificationCandidate(candidate);
      if (suggestion?.reason === 'user_text') {
        lines.push(
          `未找到「${query}」。用户原文写的是「${candidate.name}」（${formatNarrowedCandidate(candidate)}），请直接用该 token 重试 createReminder。`,
        );
        continue;
      }
      if (suggestion?.reason === 'co_recipient_dept') {
        const dept = candidate.leafDeptName || candidate.deptPath;
        lines.push(
          `未找到「${query}」。与其他收件人同在${dept}（${formatNarrowedCandidate(candidate)}），请直接用该 token 重试 createReminder。`,
        );
        continue;
      }
      lines.push(
        `未找到「${query}」。通讯录中最接近：${listed}。请直接用该 token 重试 createReminder，不要改写汉字、不要询问用户。`,
      );
      continue;
    }
    if (candidates.length > 1) {
      const listed = candidates.map(formatClarificationCandidate).join('、');
      lines.push(
        `未找到「${query}」。通讯录中最接近：${listed}。请列出候选「姓名 · 部门」请用户选择后再重试，不要自行挑选。`,
      );
      continue;
    }
    unknownWithoutSuggestions.push(query);
  }

  if (unknownWithoutSuggestions.length > 0) {
    const names = unknownWithoutSuggestions.map((query) => `「${query}」`).join('、');
    lines.push(
      `未找到${names}。请调用一次 searchDirectory，然后用返回结果中的 staff:<id>/dept:<id> token 原样重试 createReminder（逐字复制，不要改写汉字）。`,
    );
  }

  if (ambiguous.length > 0) {
    lines.push('存在同名人员，请列出候选「姓名 · 部门」请用户选择后再重试。');
  }

  const payload = {
    ambiguous,
    serverNow,
    status: 'needs_clarification' as const,
    unknown,
    ...(unknownSuggestions?.length ? { unknownSuggestions } : {}),
  };
  const state: CreateReminderState = {
    ambiguous,
    needsClarification: true,
    serverNow,
    status: 'needs_clarification',
    success: true,
    unknown,
    ...(unknownSuggestions?.length ? { unknownSuggestions } : {}),
  };

  return {
    content: withServerNow(`${lines.join('\n')}\n${compactJson(payload)}`, serverNow),
    state,
  };
};

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
        : '请将返回的 staff:<id>/dept:<id> token 原样传入 createReminder（逐字复制，不要改写汉字）。';
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
      return reminderFailureResult(error);
    }
  }

  async createReminder(args: CreateReminderRuntimeInput): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.create(args);
      const serverNow = formatServerNow();

      if (isNeedsClarificationResult(result)) {
        const clarification = buildClarificationContent(result, serverNow);
        return {
          content: clarification.content,
          state: clarification.state,
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
      return reminderFailureResult(error);
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
      return reminderFailureResult(error);
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
      return reminderFailureResult(error);
    }
  }
}

export const createReminderRuntime = (service: IReminderService) =>
  new ReminderExecutionRuntime(service);
