import { randomUUID } from 'node:crypto';

import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import {
  AUDIT_ACTION,
  AUDIT_TARGET_TYPE,
} from '@/server/enterprise/services/audit/auditActionCatalog';
import { DingtalkApprovalService } from '@/server/enterprise/services/dingtalkWorkspace/approval';
import { DEFAULT_LIST_LIMIT } from '@/server/enterprise/services/dingtalkWorkspace/approval/types';
import { assertDingtalkFeature } from '@/server/enterprise/services/dingtalkWorkspace/capabilities';
import { dingtalkWorkspaceRequest } from '@/server/enterprise/services/dingtalkWorkspace/client';
import { DingtalkWorkspaceError } from '@/server/enterprise/services/dingtalkWorkspace/errors';
import { requireVerifiedDingtalkIdentity } from '@/server/enterprise/services/dingtalkWorkspace/identity';
import { PlatformAuditService } from '@/server/enterprise/services/platformAudit';

import {
  CUSTOM_TODO_READ_SCOPE,
  discoverOrgTodoReadGate,
  peekOrgTodoReadGate,
  rememberOrgTodoReadGate,
} from './orgReadGate';
import {
  actingAsFromIdentity,
  failWorkspace,
  formatStaffLabel,
  resolveStaffTokens,
} from './staffTokens';
import type {
  DingtalkMergedApprovalItem,
  DingtalkMergedApprovals,
  DingtalkMergedTodoCard,
  DingtalkTodoCard,
  DingtalkTodoCreateInput,
  DingtalkTodoIdentity,
  DingtalkTodoIdInput,
  DingtalkTodoListInput,
  DingtalkTodoListResult,
  DingtalkTodoUpdateInput,
  DingtalkWorkspacePreview,
} from './types';
import { isTodoWriteApiName, ORG_TODO_UNAVAILABLE_NOTE } from './types';

export { resetOrgTodoReadGateForTest } from './orgReadGate';
export type { DingtalkStaffCandidate, DingtalkStaffRef } from './staffTokens';
export type {
  DingtalkMergedApprovalItem,
  DingtalkMergedApprovals,
  DingtalkMergedTodoCard,
  DingtalkMergedTodoSource,
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
export { isTodoWriteApiName, ORG_TODO_UNAVAILABLE_NOTE, TODO_WRITE_API_NAMES } from './types';

const MAX_CREATE_EXECUTORS = 100;
const MAX_UPDATE_EXECUTORS = 1000;
const MAX_LIST_PAGES = 10;
const MAX_LIST_ITEMS = 200;
const TODO_LIST_CACHE_MS = 60_000;
/** Merged listTodos result. Same window as listPendingApprovals. */
const MERGED_TODO_CACHE_MS = 5 * 60_000;
/** One page. A merged read is billed as a single organizations/tasks/query. */
const ORG_TODO_PAGE_SIZE = 20;

type CachedTodoList = { expiresAt: number; items: DingtalkTodoCard[] };
const todoListCache = new Map<string, CachedTodoList>();

type CachedMergedList = { expiresAt: number; value: DingtalkTodoListResult };
const mergedTodoCache = new Map<string, CachedMergedList>();

export const resetTodoListCacheForTest = (): void => {
  todoListCache.clear();
  mergedTodoCache.clear();
};

/** userId + verified staff/union id, so a rebound DingTalk identity cannot reuse the old list. */
const mergedCacheKey = (
  userId: string,
  identity: { staffId: string; unionId: string },
  done: boolean | undefined,
): string => {
  const doneFlag = done === true ? '1' : done === false ? '0' : '*';
  return `${userId}:${identity.staffId}:${identity.unionId}:${doneFlag}`;
};

const readMergedCache = (key: string): DingtalkTodoListResult | undefined => {
  const entry = mergedTodoCache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) return undefined;
  return entry.value;
};

const invalidateMergedCache = (userId: string): void => {
  const prefix = `${userId}:`;
  for (const key of mergedTodoCache.keys()) {
    if (key.startsWith(prefix)) mergedTodoCache.delete(key);
  }
};

const emptyApprovals = (): DingtalkMergedApprovals => ({
  count: 0,
  items: [],
  truncated: false,
});

const isCustomTodoReadForbidden = (error: unknown): boolean =>
  error instanceof DingtalkWorkspaceError &&
  error.code === 'DINGTALK_FORBIDDEN' &&
  (error.missingScopes ?? []).includes(CUSTOM_TODO_READ_SCOPE);

const tagTodos = (
  cards: DingtalkTodoCard[],
  source: DingtalkMergedTodoCard['source'],
  seen: Set<string>,
): DingtalkMergedTodoCard[] => {
  const items: DingtalkMergedTodoCard[] = [];
  for (const card of cards) {
    if (seen.has(card.taskId)) continue;
    seen.add(card.taskId);
    items.push({ ...card, source });
  }
  return items;
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

const mapTodoCards = (value: unknown): DingtalkTodoCard[] => {
  if (!Array.isArray(value)) return [];
  const cards: DingtalkTodoCard[] = [];
  for (const item of value) {
    const mapped = mapTodoCard(item);
    if (mapped) cards.push(mapped);
  }
  return cards;
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
    const listed = await this.loadWritableTodos();
    const found = listed.find((item) => item.taskId === taskId);
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

  /** Full app-todo pages for write previews. Not used by the billed merged read. */
  private loadWritableTodos = async (): Promise<DingtalkTodoCard[]> => {
    const cached = this.cachedTodos();
    if (cached) return cached;
    const identity = await this.actor();
    const items: DingtalkTodoCard[] = [];
    let nextToken: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const pageResult = await this.queryAppTodoPage(identity.unionId, {}, nextToken);
      items.push(...pageResult.cards);
      if (items.length >= MAX_LIST_ITEMS || !pageResult.nextToken) {
        const capped = items.slice(0, MAX_LIST_ITEMS);
        this.storeTodos(capped);
        return capped;
      }
      nextToken = pageResult.nextToken;
    }
    const capped = items.slice(0, MAX_LIST_ITEMS);
    this.storeTodos(capped);
    return capped;
  };

  private queryAppTodoPage = async (
    unionId: string,
    input: DingtalkTodoListInput,
    nextToken?: string,
  ): Promise<{ cards: DingtalkTodoCard[]; nextToken?: string }> => {
    const body: Record<string, unknown> = {
      roleTypes: [['creator'], ['executor']],
    };
    if (typeof input.done === 'boolean') body.isDone = input.done;
    if (nextToken) body.nextToken = nextToken;
    const response = await dingtalkWorkspaceRequest<Record<string, unknown>>({
      api: 'v1',
      body,
      method: 'POST',
      path: todoPath(unionId, '/org/tasks/query'),
    });
    return {
      cards: mapTodoCards(response.todoCards),
      nextToken: asString(response.nextToken),
    };
  };

  private queryOrgTodoPage = async (
    unionId: string,
    done: boolean | undefined,
  ): Promise<{ cards: DingtalkTodoCard[]; nextToken?: string }> => {
    const body: Record<string, unknown> = {
      maxResults: ORG_TODO_PAGE_SIZE,
      needPersonalTodo: true,
      nextToken: '0',
      roleTypes: [['creator'], ['executor']],
    };
    if (typeof done === 'boolean') body.isDone = done;
    const response = await dingtalkWorkspaceRequest<Record<string, unknown>>({
      api: 'v1',
      body,
      method: 'POST',
      path: todoPath(unionId, '/organizations/tasks/query'),
    });
    return {
      cards: mapTodoCards(response.todoCards).slice(0, ORG_TODO_PAGE_SIZE),
      nextToken: asString(response.nextToken),
    };
  };

  private loadApprovals = async (refresh?: boolean): Promise<DingtalkMergedApprovals> => {
    try {
      const pending = await new DingtalkApprovalService(this.db, this.userId).listPending({
        limit: DEFAULT_LIST_LIMIT,
        refresh,
      });
      const rows = pending.rows.slice(0, DEFAULT_LIST_LIMIT);
      const items: DingtalkMergedApprovalItem[] = rows.map((row) => ({
        ...(row.createdAt ? { createdAt: row.createdAt } : {}),
        ...(row.originatorName ? { originatorName: row.originatorName } : {}),
        processInstanceId: row.processInstanceId,
        source: 'approval',
        taskId: row.taskId,
        title: row.title,
      }));
      return {
        count: pending.rows.length,
        items,
        truncated: pending.truncated || pending.rows.length > DEFAULT_LIST_LIMIT,
      };
    } catch (error) {
      if (
        error instanceof DingtalkWorkspaceError &&
        (error.code === 'DINGTALK_FEATURE_DISABLED' || error.code === 'DINGTALK_NOT_CONFIGURED')
      ) {
        return emptyApprovals();
      }
      throw error;
    }
  };

  /**
   * One organizations/tasks/query when the gate is open or still unknown.
   * A remembered `unavailable` gate makes zero calls, including on refresh.
   */
  private loadOrgTodos = async (
    unionId: string,
    done: boolean | undefined,
  ): Promise<
    | { cards: DingtalkTodoCard[]; status: 'available'; truncated: boolean }
    | { status: 'skipped' }
    | { status: 'unavailable' }
  > => {
    const known = await peekOrgTodoReadGate();
    if (known === 'unavailable') return { status: 'unavailable' };

    const readPage = async () => this.queryOrgTodoPage(unionId, done);

    if (known === 'available') {
      try {
        const page = await readPage();
        return {
          cards: page.cards,
          status: 'available',
          truncated: Boolean(page.nextToken),
        };
      } catch (error) {
        if (isCustomTodoReadForbidden(error)) {
          await rememberOrgTodoReadGate('unavailable');
          return { status: 'unavailable' };
        }
        return { status: 'skipped' };
      }
    }

    let own: { cards: DingtalkTodoCard[]; nextToken?: string } | undefined;
    const discovered = await discoverOrgTodoReadGate(async () => {
      try {
        own = await readPage();
        return 'available';
      } catch (error) {
        if (isCustomTodoReadForbidden(error)) return 'unavailable';
        return undefined;
      }
    });

    if (discovered.fromThisProbe) {
      if (discovered.gate === 'unavailable') return { status: 'unavailable' };
      if (own) {
        return { cards: own.cards, status: 'available', truncated: Boolean(own.nextToken) };
      }
      return { status: 'skipped' };
    }

    if (discovered.gate === 'unavailable') return { status: 'unavailable' };
    if (discovered.gate !== 'available') return { status: 'skipped' };

    try {
      const page = await readPage();
      return { cards: page.cards, status: 'available', truncated: Boolean(page.nextToken) };
    } catch (error) {
      if (isCustomTodoReadForbidden(error)) {
        await rememberOrgTodoReadGate('unavailable');
        return { status: 'unavailable' };
      }
      return { status: 'skipped' };
    }
  };

  listTodos = async (input: DingtalkTodoListInput = {}): Promise<DingtalkTodoListResult> => {
    // Identity first. A cache hit must not skip verification, and the key includes
    // the verified staff/union id so a changed binding is a miss.
    const identity = await this.actor();
    const cacheKey = mergedCacheKey(this.userId, identity, input.done);
    if (!input.refresh) {
      const cached = readMergedCache(cacheKey);
      if (cached) return cached;
    }

    const appPage = await this.queryAppTodoPage(identity.unionId, input);
    const [approvals, org] = await Promise.all([
      this.loadApprovals(input.refresh),
      this.loadOrgTodos(identity.unionId, input.done),
    ]);

    const seen = new Set<string>();
    const appTodos = tagTodos(appPage.cards, 'assistant', seen);
    const notes: string[] = [];
    let orgTodos: DingtalkMergedTodoCard[] | undefined;
    let orgTruncated = false;
    if (org.status === 'unavailable') {
      notes.push(ORG_TODO_UNAVAILABLE_NOTE);
    } else if (org.status === 'available') {
      orgTodos = tagTodos(org.cards, 'org', seen);
      orgTruncated = org.truncated;
    }

    const result: DingtalkTodoListResult = {
      approvals,
      appTodos,
      notes,
      truncated: Boolean(appPage.nextToken) || orgTruncated,
    };
    if (orgTodos) result.orgTodos = orgTodos;
    mergedTodoCache.set(cacheKey, { expiresAt: Date.now() + MERGED_TODO_CACHE_MS, value: result });
    return result;
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
    invalidateMergedCache(this.userId);
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
    invalidateMergedCache(this.userId);
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
    invalidateMergedCache(this.userId);
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
    invalidateMergedCache(this.userId);
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
