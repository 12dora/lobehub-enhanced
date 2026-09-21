import { randomUUID } from 'node:crypto';

import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import {
  AUDIT_ACTION,
  AUDIT_TARGET_TYPE,
} from '@/server/enterprise/services/audit/auditActionCatalog';
import { assertDingtalkFeature } from '@/server/enterprise/services/dingtalkWorkspace/capabilities';
import { dingtalkWorkspaceRequest } from '@/server/enterprise/services/dingtalkWorkspace/client';
import { requireVerifiedDingtalkIdentity } from '@/server/enterprise/services/dingtalkWorkspace/identity';
import { PlatformAuditService } from '@/server/enterprise/services/platformAudit';

import {
  actingAsFromIdentity,
  failWorkspace,
  formatStaffLabel,
  resolveStaffTokens,
} from './staffTokens';
import type {
  DingtalkTodoCard,
  DingtalkTodoCreateInput,
  DingtalkTodoIdentity,
  DingtalkTodoIdInput,
  DingtalkTodoListInput,
  DingtalkTodoListResult,
  DingtalkTodoUpdateInput,
  DingtalkWorkspacePreview,
} from './types';
import { isTodoWriteApiName } from './types';

export type { DingtalkStaffCandidate, DingtalkStaffRef } from './staffTokens';
export type {
  DingtalkTodoCard,
  DingtalkTodoCreateInput,
  DingtalkTodoIdInput,
  DingtalkTodoListInput,
  DingtalkTodoListResult,
  DingtalkTodoUpdateInput,
  DingtalkWorkspacePreview,
  DingtalkWorkspacePreviewLine,
  TodoWriteApiName,
} from './types';
export { isTodoWriteApiName, TODO_WRITE_API_NAMES } from './types';

const MAX_CREATE_EXECUTORS = 100;
const MAX_UPDATE_EXECUTORS = 1000;
const MAX_LIST_PAGES = 10;
const MAX_LIST_ITEMS = 200;
const TODO_LIST_CACHE_MS = 60_000;

type CachedTodoList = { expiresAt: number; items: DingtalkTodoCard[] };
const todoListCache = new Map<string, CachedTodoList>();

export const resetTodoListCacheForTest = (): void => {
  todoListCache.clear();
};
const PRIORITY_VALUES = new Set([10, 20, 30, 40]);
const PRIORITY_LABEL: Record<number, string> = {
  10: '较低',
  20: '普通',
  30: '较高',
  40: '紧急',
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const asStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
};

const todoPath = (unionId: string, suffix = ''): string =>
  `/v1.0/todo/users/${encodeURIComponent(unionId)}${suffix}`;

export const resolvePublicAppUrl = (): string => {
  const raw = typeof appEnv.APP_URL === 'string' ? appEnv.APP_URL.trim() : '';
  if (!raw) return failWorkspace('DINGTALK_NOT_CONFIGURED');
  return raw.replace(/\/+$/, '');
};

const parseDueTimeMs = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return failWorkspace('DINGTALK_INVALID');
  const asEpoch = Number(trimmed);
  if (/^\d+$/.test(trimmed) && Number.isFinite(asEpoch)) return asEpoch;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return failWorkspace('DINGTALK_INVALID');
  return parsed;
};

const formatDueTime = (ms: number): string => {
  const date = new Date(ms);
  const parts = new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`;
};

const mapTodoCard = (value: unknown): DingtalkTodoCard | null => {
  const row = asRecord(value);
  const taskId = asString(row.taskId) ?? asString(row.id);
  const subject = asString(row.subject);
  if (!taskId || !subject) return null;
  return {
    createdTime: asNumber(row.createdTime),
    creatorId: asString(row.creatorId),
    done: asBoolean(row.isDone) ?? asBoolean(row.done) ?? false,
    dueTime: asNumber(row.dueTime),
    modifiedTime: asNumber(row.modifiedTime),
    priority: asNumber(row.priority),
    sourceId: asString(row.sourceId),
    subject,
    taskId,
    todoType: asString(row.todoType),
  };
};

const parseCreateInput = (args: Record<string, unknown>): DingtalkTodoCreateInput => {
  const subject = asString(args.subject)?.trim();
  if (!subject) return failWorkspace('DINGTALK_INVALID');
  if (subject.length > 1024) return failWorkspace('DINGTALK_INVALID');
  const description = asString(args.description);
  if (description && description.length > 4096) return failWorkspace('DINGTALK_INVALID');
  const priority = asNumber(args.priority);
  if (priority !== undefined && !PRIORITY_VALUES.has(priority))
    return failWorkspace('DINGTALK_INVALID');
  return {
    description,
    dueTime: asString(args.dueTime),
    executorTokens: asStringArray(args.executorTokens),
    priority: priority as DingtalkTodoCreateInput['priority'],
    subject,
  };
};

const parseUpdateInput = (args: Record<string, unknown>): DingtalkTodoUpdateInput => {
  const taskId = asString(args.taskId)?.trim();
  if (!taskId) return failWorkspace('DINGTALK_INVALID');
  const subject = asString(args.subject)?.trim();
  if (subject !== undefined && subject.length === 0) return failWorkspace('DINGTALK_INVALID');
  if (subject && subject.length > 1024) return failWorkspace('DINGTALK_INVALID');
  const description = asString(args.description);
  if (description && description.length > 4096) return failWorkspace('DINGTALK_INVALID');
  const priority = asNumber(args.priority);
  if (priority !== undefined && !PRIORITY_VALUES.has(priority))
    return failWorkspace('DINGTALK_INVALID');
  const dueTime =
    args.dueTime === null ? null : typeof args.dueTime === 'string' ? args.dueTime : undefined;
  return {
    description,
    done: asBoolean(args.done),
    dueTime,
    executorTokens: asStringArray(args.executorTokens),
    priority: priority as DingtalkTodoUpdateInput['priority'],
    subject,
    taskId,
  };
};

export class DingtalkTodoService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  private cachedTodos(): DingtalkTodoCard[] | undefined {
    const entry = todoListCache.get(this.userId);
    if (!entry || entry.expiresAt <= Date.now()) return undefined;
    return entry.items;
  }

  private storeTodos(items: DingtalkTodoCard[]): void {
    todoListCache.set(this.userId, { expiresAt: Date.now() + TODO_LIST_CACHE_MS, items });
  }

  private rememberTodo(card: DingtalkTodoCard): void {
    const current = this.cachedTodos() ?? [];
    const items = [card, ...current.filter((item) => item.taskId !== card.taskId)];
    this.storeTodos(items);
  }

  private patchCachedTodo(
    taskId: string,
    patch: Partial<DingtalkTodoCard>,
  ): DingtalkTodoCard | undefined {
    const current = this.cachedTodos();
    if (!current) return undefined;
    let matched: DingtalkTodoCard | undefined;
    const items = current.map((item) => {
      if (item.taskId !== taskId) return item;
      matched = { ...item, ...patch };
      return matched;
    });
    this.storeTodos(items);
    return matched;
  }

  private forgetTodo(taskId: string): void {
    const current = this.cachedTodos();
    if (!current) return;
    this.storeTodos(current.filter((item) => item.taskId !== taskId));
  }

  private findCachedTodo(taskId: string): DingtalkTodoCard | undefined {
    return this.cachedTodos()?.find((item) => item.taskId === taskId);
  }

  private async requireTodo(taskId: string): Promise<DingtalkTodoCard> {
    const cached = this.findCachedTodo(taskId);
    if (cached) return cached;
    const listed = await this.listTodos();
    const found = listed.items.find((item) => item.taskId === taskId);
    if (!found) return failWorkspace('DINGTALK_NOT_FOUND');
    return found;
  }

  private async actor(): Promise<DingtalkTodoIdentity> {
    await assertDingtalkFeature('todo');
    const identity = await requireVerifiedDingtalkIdentity(this.db, this.userId);
    if (!identity.unionId) return failWorkspace('DINGTALK_IDENTITY_UNVERIFIED');
    return identity;
  }

  private async audit(
    action: 'create' | 'update' | 'complete' | 'delete',
    targetId: string,
    subject?: string,
  ) {
    const actions = {
      complete: AUDIT_ACTION.DINGTALK_TODO_COMPLETE,
      create: AUDIT_ACTION.DINGTALK_TODO_CREATE,
      delete: AUDIT_ACTION.DINGTALK_TODO_DELETE,
      update: AUDIT_ACTION.DINGTALK_TODO_UPDATE,
    } as const;
    await new PlatformAuditService(this.db).append({
      action: actions[action],
      actorUserId: this.userId,
      afterDiff: subject ? { subject } : null,
      result: 'success',
      targetId,
      targetType: AUDIT_TARGET_TYPE.DINGTALK_TODO,
    });
  }

  listTodos = async (input: DingtalkTodoListInput = {}): Promise<DingtalkTodoListResult> => {
    const identity = await this.actor();
    const items: DingtalkTodoCard[] = [];
    let nextToken: string | undefined;
    let truncated = false;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const body: Record<string, unknown> = {
        roleTypes: [['creator'], ['executor']],
      };
      if (typeof input.done === 'boolean') body.isDone = input.done;
      if (nextToken) body.nextToken = nextToken;
      const response = await dingtalkWorkspaceRequest<Record<string, unknown>>({
        api: 'v1',
        body,
        method: 'POST',
        path: todoPath(identity.unionId, '/org/tasks/query'),
      });
      const cards = Array.isArray(response.todoCards) ? response.todoCards : [];
      for (const card of cards) {
        const mapped = mapTodoCard(card);
        if (mapped) items.push(mapped);
        if (items.length >= MAX_LIST_ITEMS) break;
      }
      const token = asString(response.nextToken);
      if (items.length >= MAX_LIST_ITEMS) {
        truncated = items.length > MAX_LIST_ITEMS || Boolean(token);
        const capped = items.slice(0, MAX_LIST_ITEMS);
        if (typeof input.done !== 'boolean') this.storeTodos(capped);
        return { items: capped, truncated };
      }
      if (!token) {
        if (typeof input.done !== 'boolean') this.storeTodos(items);
        return { items, truncated };
      }
      nextToken = token;
    }
    truncated = true;
    if (typeof input.done !== 'boolean') this.storeTodos(items);
    return { items, truncated };
  };

  createTodo = async (input: DingtalkTodoCreateInput): Promise<DingtalkTodoCard> => {
    const identity = await this.actor();
    const subject = input.subject.trim();
    if (!subject) return failWorkspace('DINGTALK_INVALID');
    if (subject.length > 1024) return failWorkspace('DINGTALK_INVALID');
    const executors = await resolveStaffTokens(this.db, input.executorTokens, MAX_CREATE_EXECUTORS);
    const executorIds =
      executors.length > 0 ? executors.map((item) => item.unionId) : [identity.unionId];
    const appUrl = resolvePublicAppUrl();
    const dueTime = parseDueTimeMs(input.dueTime);
    const created = await dingtalkWorkspaceRequest<Record<string, unknown>>({
      api: 'v1',
      body: {
        creatorId: identity.unionId,
        description: input.description,
        detailUrl: { appUrl, pcUrl: appUrl },
        dueTime,
        executorIds,
        priority: input.priority,
        sourceId: `aihub-todo-${randomUUID()}`,
        subject,
      },
      method: 'POST',
      path: todoPath(identity.unionId, '/tasks'),
      query: { operatorId: identity.unionId },
    });
    const card = mapTodoCard(created);
    if (!card) return failWorkspace('DINGTALK_UNAVAILABLE');
    this.rememberTodo(card);
    await this.audit('create', card.taskId, card.subject);
    return card;
  };

  updateTodo = async (
    input: DingtalkTodoUpdateInput,
  ): Promise<{ ok: boolean; subject?: string; taskId: string }> => {
    const identity = await this.actor();
    if (!input.taskId.trim()) return failWorkspace('DINGTALK_INVALID');
    const executors = await resolveStaffTokens(this.db, input.executorTokens, MAX_UPDATE_EXECUTORS);
    const body: Record<string, unknown> = {};
    if (input.subject !== undefined) body.subject = input.subject.trim();
    if (input.description !== undefined) body.description = input.description;
    if (input.dueTime === null) body.dueTime = null;
    else if (input.dueTime !== undefined) body.dueTime = parseDueTimeMs(input.dueTime);
    if (input.done !== undefined) body.done = input.done;
    if (input.priority !== undefined) body.priority = input.priority;
    if (input.executorTokens) body.executorIds = executors.map((item) => item.unionId);
    await dingtalkWorkspaceRequest({
      api: 'v1',
      body,
      method: 'PUT',
      path: todoPath(identity.unionId, `/tasks/${encodeURIComponent(input.taskId)}`),
      query: { operatorId: identity.unionId },
    });
    const dueTime =
      input.dueTime === null
        ? undefined
        : input.dueTime !== undefined
          ? parseDueTimeMs(input.dueTime)
          : undefined;
    const patched = this.patchCachedTodo(input.taskId, {
      ...(input.subject !== undefined ? { subject: input.subject.trim() } : {}),
      ...(input.done !== undefined ? { done: input.done } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.dueTime === null ? { dueTime: undefined } : {}),
      ...(dueTime !== undefined ? { dueTime } : {}),
    });
    const subject = patched?.subject ?? input.subject ?? this.findCachedTodo(input.taskId)?.subject;
    await this.audit('update', input.taskId, input.subject);
    return { ok: true, subject, taskId: input.taskId };
  };

  completeTodo = async (
    input: DingtalkTodoIdInput,
  ): Promise<{ ok: boolean; subject?: string; taskId: string }> => {
    const identity = await this.actor();
    if (!input.taskId.trim()) return failWorkspace('DINGTALK_INVALID');
    await dingtalkWorkspaceRequest({
      api: 'v1',
      body: { done: true },
      method: 'PUT',
      path: todoPath(identity.unionId, `/tasks/${encodeURIComponent(input.taskId)}`),
      query: { operatorId: identity.unionId },
    });
    const patched = this.patchCachedTodo(input.taskId, { done: true });
    const subject = patched?.subject ?? this.findCachedTodo(input.taskId)?.subject;
    await this.audit('complete', input.taskId);
    return { ok: true, subject, taskId: input.taskId };
  };

  deleteTodo = async (
    input: DingtalkTodoIdInput,
  ): Promise<{ ok: boolean; subject?: string; taskId: string }> => {
    const identity = await this.actor();
    if (!input.taskId.trim()) return failWorkspace('DINGTALK_INVALID');
    await dingtalkWorkspaceRequest({
      api: 'v1',
      method: 'DELETE',
      path: todoPath(identity.unionId, `/tasks/${encodeURIComponent(input.taskId)}`),
      query: { operatorId: identity.unionId },
    });
    const subject = this.findCachedTodo(input.taskId)?.subject;
    this.forgetTodo(input.taskId);
    await this.audit('delete', input.taskId);
    return { ok: true, subject, taskId: input.taskId };
  };

  preview = async (input: {
    apiName: string;
    args?: Record<string, unknown>;
  }): Promise<DingtalkWorkspacePreview> => {
    const identity = await this.actor();
    if (!isTodoWriteApiName(input.apiName)) return failWorkspace('DINGTALK_INVALID');
    const args = input.args ?? {};
    const actingAs = await actingAsFromIdentity(this.db, identity);
    const warnings = ['仅能查看和编辑通过本应用创建的待办'];

    if (input.apiName === 'createTodo') {
      const parsed = parseCreateInput(args);
      const executors = await resolveStaffTokens(
        this.db,
        parsed.executorTokens,
        MAX_CREATE_EXECUTORS,
      );
      const dueMs = parseDueTimeMs(parsed.dueTime);
      const lines = [
        { label: '标题', value: parsed.subject },
        ...(parsed.description ? [{ label: '说明', value: parsed.description }] : []),
        ...(dueMs ? [{ label: '截止时间', value: formatDueTime(dueMs) }] : []),
        {
          label: '执行人',
          value:
            executors.length > 0
              ? executors.map(formatStaffLabel).join('、')
              : formatStaffLabel(actingAs),
        },
        ...(parsed.priority
          ? [{ label: '优先级', value: PRIORITY_LABEL[parsed.priority] ?? String(parsed.priority) }]
          : []),
      ];
      return { actingAs, danger: false, lines, title: '创建待办', warnings };
    }

    if (input.apiName === 'updateTodo') {
      const parsed = parseUpdateInput(args);
      const existing = await this.requireTodo(parsed.taskId);
      const executors = await resolveStaffTokens(
        this.db,
        parsed.executorTokens,
        MAX_UPDATE_EXECUTORS,
      );
      const dueMs =
        parsed.dueTime === null ? undefined : parseDueTimeMs(parsed.dueTime ?? undefined);
      const changingDue = parsed.dueTime === null || dueMs !== undefined;
      const lines = [
        { label: '待办', value: existing.subject },
        ...(parsed.subject ? [{ label: '标题', value: parsed.subject }] : []),
        ...(parsed.description ? [{ label: '说明', value: parsed.description }] : []),
        ...(!changingDue && existing.dueTime
          ? [{ label: '截止时间', value: formatDueTime(existing.dueTime) }]
          : []),
        ...(parsed.dueTime === null ? [{ label: '截止时间', value: '清除' }] : []),
        ...(dueMs ? [{ label: '截止时间', value: formatDueTime(dueMs) }] : []),
        ...(parsed.executorTokens
          ? [
              {
                label: '执行人',
                value: executors.map(formatStaffLabel).join('、') || '（空）',
              },
            ]
          : []),
        ...(parsed.priority
          ? [{ label: '优先级', value: PRIORITY_LABEL[parsed.priority] ?? String(parsed.priority) }]
          : []),
        ...(parsed.done !== undefined
          ? [{ label: '完成状态', value: parsed.done ? '已完成' : '未完成' }]
          : []),
      ];
      return { actingAs, danger: false, lines, title: '更新待办', warnings };
    }

    const taskId = asString(args.taskId)?.trim();
    if (!taskId) return failWorkspace('DINGTALK_INVALID');
    const existing = await this.requireTodo(taskId);
    const lines = [
      { label: '待办', value: existing.subject },
      ...(existing.dueTime ? [{ label: '截止时间', value: formatDueTime(existing.dueTime) }] : []),
    ];
    if (input.apiName === 'completeTodo') {
      return {
        actingAs,
        danger: false,
        lines,
        title: '完成待办',
        warnings,
      };
    }
    return {
      actingAs,
      danger: true,
      lines,
      title: '删除待办',
      warnings,
    };
  };
}
