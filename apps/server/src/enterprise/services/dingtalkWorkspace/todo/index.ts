import { randomUUID } from 'node:crypto';

import debug from 'debug';

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
import {
  DingtalkWorkspaceError,
  sanitizeDingtalkApplyUrl,
} from '@/server/enterprise/services/dingtalkWorkspace/errors';
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
import {
  isTodoWriteApiName,
  ORG_TODO_UNAVAILABLE_NOTE,
  PERSONAL_TODO_ERROR_NOTE,
  PERSONAL_TODO_MERGED_NOTE,
  personalTodoAuthNote,
} from './types';

const log = debug('lobe-server:dingtalk-workspace:todo');

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
export {
  isTodoWriteApiName,
  ORG_TODO_UNAVAILABLE_NOTE,
  PERSONAL_TODO_ERROR_NOTE,
  PERSONAL_TODO_MERGED_NOTE,
  personalTodoAuthNote,
  TODO_WRITE_API_NAMES,
} from './types';

const MAX_CREATE_EXECUTORS = 100;
const MAX_UPDATE_EXECUTORS = 1000;
const MAX_LIST_PAGES = 10;
const MAX_LIST_ITEMS = 200;
const TODO_LIST_CACHE_MS = 60_000;
/** Merged listTodos result. Same window as listPendingApprovals. */
const MERGED_TODO_CACHE_MS = 5 * 60_000;
/** One page. A merged read is billed as a single organizations/tasks/query. */
const ORG_TODO_PAGE_SIZE = 20;
/** One page of the caller's own dws todos. Same size as the org page. */
const PERSONAL_TODO_PAGE_SIZE = 20;

/**
 * Cache segment for whether this result merged 钉钉个人数据 todos.
 * `merged` is not reused for an unauthorized or feature-off result.
 */
type PersonalTodoCacheFlag = 'off' | 'merged' | 'auth' | 'error';

type CachedTodoList = { expiresAt: number; items: DingtalkTodoCard[] };
const todoListCache = new Map<string, CachedTodoList>();

type CachedMergedList = { expiresAt: number; value: DingtalkTodoListResult };
const mergedTodoCache = new Map<string, CachedMergedList>();
/** Bumped with every merged-list invalidation, including personal todo writes. */
const mergedTodoGeneration = new Map<string, number>();
let mergedInvalidationCount = 0;

export const resetTodoListCacheForTest = (): void => {
  todoListCache.clear();
  mergedTodoCache.clear();
  mergedTodoGeneration.clear();
  mergedInvalidationCount = 0;
};

/** How many times the merged list cache was dropped. Test seam for batch invalidation. */
export const todoMergedInvalidationCountForTest = (): number => mergedInvalidationCount;

/** userId + verified staff/union id, so a rebound DingTalk identity cannot reuse the old list. */
const mergedCacheKey = (
  userId: string,
  identity: { staffId: string; unionId: string },
  done: boolean | undefined,
  personal: PersonalTodoCacheFlag,
  platform?: string | null,
): string => {
  const doneFlag = done === true ? '1' : done === false ? '0' : '*';
  const surface = platform === 'dingtalk' ? 'dt' : 'web';
  return `${userId}:${identity.staffId}:${identity.unionId}:${doneFlag}:${personal}:${surface}`;
};

const readMergedCache = (key: string): DingtalkTodoListResult | undefined => {
  const entry = mergedTodoCache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) return undefined;
  return entry.value;
};

const invalidateMergedCache = (userId: string): void => {
  mergedInvalidationCount += 1;
  const prefix = `${userId}:`;
  for (const key of mergedTodoCache.keys()) {
    if (key.startsWith(prefix)) mergedTodoCache.delete(key);
  }
  mergedTodoGeneration.set(userId, (mergedTodoGeneration.get(userId) ?? 0) + 1);
};

/** Drop this user's merged listTodos cache. Personal todo writes call this. */
export const invalidateDingtalkTodoListCache = (userId: string): void => {
  invalidateMergedCache(userId);
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

const personalErrorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
};

const isPersonalAuthError = (error: unknown): boolean => {
  const code = personalErrorCode(error);
  return code === 'DINGTALK_PERSONAL_UNAUTHORIZED' || code === 'DINGTALK_PERSONAL_EXPIRED';
};

const parsePersonalTodoPayload = (
  payload: unknown,
): { hasMore: boolean; rows: unknown[] } | undefined => {
  const root = asRecord(payload);
  if (root.ok === false) return undefined;
  const nested = asRecord(root.data);
  if (Array.isArray(nested.todos)) {
    return { hasMore: nested.hasMore === true, rows: nested.todos };
  }
  if (Array.isArray(root.todos)) {
    return { hasMore: root.hasMore === true, rows: root.todos };
  }
  return undefined;
};

const mapPersonalTodoCard = (value: unknown, done: boolean): DingtalkMergedTodoCard | null => {
  const row = asRecord(value);
  const taskId = asString(row.taskId);
  const subject = asString(row.subject);
  if (!taskId || !subject) return null;
  const dueTime = asNumber(row.dueTime);
  const priority = asNumber(row.priority);
  const stage = asNumber(row.finalStatusStage) ?? asNumber(row.stage);
  const cardDone = asBoolean(row.isDone) ?? asBoolean(row.done) ?? done;
  return {
    done: cardDone,
    ...(dueTime !== undefined ? { dueTime } : {}),
    ...(priority !== undefined ? { priority } : {}),
    source: 'personal',
    ...(stage !== undefined ? { stage } : {}),
    subject,
    taskId,
  };
};

const replaceOrgUnavailableNote = (notes: string[], replacement: string): string[] => {
  const index = notes.indexOf(ORG_TODO_UNAVAILABLE_NOTE);
  if (index < 0) return notes;
  const next = notes.slice();
  next[index] = replacement;
  return next;
};

const pushNote = (notes: string[], note: string): string[] =>
  notes.includes(note) ? notes : [...notes, note];

/**
 * Feature off (or config unreadable) stays on the legacy list. Authorized users
 * merge; unauthorized/expired only swap the org note; other failures add a note.
 */
const resolvePersonalTodoFlag = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<PersonalTodoCacheFlag> => {
  try {
    const { DingtalkPersonalService, getDingtalkPersonalConfig } =
      await import('@/server/enterprise/services/dingtalkPersonal');
    const config = await getDingtalkPersonalConfig();
    if (!config?.features?.todo) return 'off';
    try {
      const status = await new DingtalkPersonalService(db, userId).getStatus();
      if (status.state === 'authorized') return 'merged';
      if (status.state === 'unauthorized' || status.state === 'expired') return 'auth';
      if (status.state === 'disabled') return 'off';
      return 'error';
    } catch (error) {
      log('personal todo status failed user=%s: %O', userId, error);
      return 'error';
    }
  } catch (error) {
    log('personal todo config failed user=%s: %O', userId, error);
    return 'off';
  }
};

const applyPersonalTodos = async (
  db: LobeChatDatabase,
  userId: string,
  input: DingtalkTodoListInput,
  result: DingtalkTodoListResult,
  flag: PersonalTodoCacheFlag,
  platform?: string | null,
): Promise<void> => {
  if (flag === 'off') return;
  if (flag === 'auth') {
    result.notes = replaceOrgUnavailableNote(
      result.notes,
      personalTodoAuthNote(appEnv.APP_URL, platform),
    );
    return;
  }
  if (flag === 'error') {
    result.notes = pushNote(result.notes, PERSONAL_TODO_ERROR_NOTE);
    return;
  }

  try {
    const { DingtalkPersonalService } =
      await import('@/server/enterprise/services/dingtalkPersonal');
    const payload = await new DingtalkPersonalService(db, userId).exec('todo.list', {
      page: 1,
      size: PERSONAL_TODO_PAGE_SIZE,
      status: input.done === true ? 'done' : 'open',
    });
    const parsed = parsePersonalTodoPayload(payload);
    if (!parsed) {
      result.notes = pushNote(result.notes, PERSONAL_TODO_ERROR_NOTE);
      return;
    }
    const appIds = new Set(result.appTodos.map((item) => item.taskId));
    const personalTodos: DingtalkMergedTodoCard[] = [];
    const seen = new Set<string>();
    for (const row of parsed.rows) {
      const card = mapPersonalTodoCard(row, input.done === true);
      if (!card || appIds.has(card.taskId) || seen.has(card.taskId)) continue;
      seen.add(card.taskId);
      personalTodos.push(card);
    }
    result.personalTodos = personalTodos;
    result.notes = pushNote(
      result.notes.filter((note) => note !== ORG_TODO_UNAVAILABLE_NOTE),
      PERSONAL_TODO_MERGED_NOTE,
    );
    if (parsed.hasMore) result.truncated = true;
  } catch (error) {
    log('personal todo.list failed user=%s code=%s: %O', userId, personalErrorCode(error), error);
    if (isPersonalAuthError(error)) {
      result.notes = replaceOrgUnavailableNote(
        result.notes,
        personalTodoAuthNote(appEnv.APP_URL, platform),
      );
      return;
    }
    result.notes = pushNote(result.notes, PERSONAL_TODO_ERROR_NOTE);
  }
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

const TODO_BATCH_LIMIT = 20;

/**
 * Auth, rate-limit, and org-policy failures stop a batch. A per-item miss does not.
 * `DINGTALK_FORBIDDEN` stops only when the app itself lacks permission (see
 * {@link forbiddenStopsTodoBatch}). Two consecutive `DINGTALK_UNAVAILABLE`
 * responses stop the rest.
 */
const TODO_BATCH_STOP_CODES = new Set<string>([
  'DINGTALK_NOT_CONFIGURED',
  'DINGTALK_FEATURE_DISABLED',
  'DINGTALK_PREMIUM_REQUIRED',
  'DINGTALK_RATE_LIMITED',
  'DINGTALK_IDENTITY_UNBOUND',
  'DINGTALK_IDENTITY_UNVERIFIED',
  'DINGTALK_IDENTITY_INACTIVE',
  'DINGTALK_NOT_APPROVAL_ADMIN',
  'DINGTALK_AUTOMATION_OFF',
]);

const TODO_BATCH_UNAVAILABLE_STREAK = 2;

/** App-wide 403 (missing scopes or an apply link). A "not the creator" 403 does not stop the batch. */
const forbiddenStopsTodoBatch = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const record = error as { applyUrl?: unknown; missingScopes?: unknown };
  const scopes = record.missingScopes;
  if (Array.isArray(scopes) && scopes.some((scope) => typeof scope === 'string' && scope.trim())) {
    return true;
  }
  return Boolean(sanitizeDingtalkApplyUrl(record.applyUrl));
};

const readBatchApplyUrl = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object' || !('applyUrl' in error)) return undefined;
  return sanitizeDingtalkApplyUrl((error as { applyUrl?: unknown }).applyUrl);
};

export interface DingtalkTodoBatchItem {
  /** Sanitized https://open-dev.dingtalk.com permission-apply link, when DingTalk returned one. */
  applyUrl?: string;
  errorCode?: string;
  id: string;
  ok: boolean;
  skipped?: boolean;
  title?: string;
}

export interface DingtalkTodoBatchResult {
  items: DingtalkTodoBatchItem[];
}

const batchValidation = (message: string): never => {
  const error = new Error(message);
  Object.assign(error, { code: 'VALIDATION' });
  throw error;
};

const readTodoBatchIds = (
  value: unknown,
): { ids: string[] } | { reason: 'duplicate' | 'invalid' } => {
  if (!Array.isArray(value) || value.length < 1 || value.length > TODO_BATCH_LIMIT) {
    return { reason: 'invalid' };
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) return { reason: 'invalid' };
    if (seen.has(item)) return { reason: 'duplicate' };
    seen.add(item);
    ids.push(item);
  }
  return { ids };
};

const requireTodoBatchIds = (value: unknown): string[] => {
  const read = readTodoBatchIds(value);
  if ('reason' in read) {
    return batchValidation(
      read.reason === 'duplicate'
        ? '待办 id 不能重复。'
        : '待办 id 须为 1 到 20 个互不重复的非空字符串。',
    );
  }
  return read.ids;
};

const errorCodeOf = (error: unknown): string => {
  if (error instanceof DingtalkWorkspaceError) return error.code;
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  if (error instanceof Error) {
    const match = /DINGTALK_[A-Z_]+/.exec(error.message);
    if (match) return match[0];
  }
  return 'DINGTALK_INTERNAL';
};

/** Domain failures stay quiet. Anything else is unexpected and must show up in logs. */
const logUnexpectedTodoBatchError = (error: unknown): void => {
  if (error instanceof DingtalkWorkspaceError) return;
  const code = errorCodeOf(error);
  if (code.startsWith('DINGTALK_') && code !== 'DINGTALK_INTERNAL') return;
  console.error('[dingtalk.todo] batch item failed', {
    code,
    errorClass: error instanceof Error ? error.name : 'UnknownError',
  });
};

export class DingtalkTodoService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    /** DingTalk chat uses SSO links in the personal-authorize note. */
    private readonly linkPlatform?: string | null,
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
    try {
      await new PlatformAuditService(this.db).append({
        action: actions[action],
        actorUserId: this.userId,
        afterDiff: subject ? { subject } : null,
        result: 'success',
        targetId,
        targetType: AUDIT_TARGET_TYPE.DINGTALK_TODO,
      });
    } catch (error) {
      console.error('[dingtalk.todo] audit append failed', {
        action,
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    }
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
    const personal = await resolvePersonalTodoFlag(this.db, this.userId);
    const cacheKey = mergedCacheKey(this.userId, identity, input.done, personal, this.linkPlatform);
    if (!input.refresh) {
      const cached = readMergedCache(cacheKey);
      if (cached) return cached;
    }
    const mergedGeneration = mergedTodoGeneration.get(this.userId) ?? 0;

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
    await applyPersonalTodos(this.db, this.userId, input, result, personal, this.linkPlatform);
    if ((mergedTodoGeneration.get(this.userId) ?? 0) !== mergedGeneration) return result;
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

  /** HTTP + cache patch. The caller invalidates the merged list and writes the audit row. */
  private completeTodoBody = async (
    input: DingtalkTodoIdInput,
  ): Promise<{ subject?: string; taskId: string }> => {
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
    return { subject, taskId: input.taskId };
  };

  /** HTTP + cache patch. The caller invalidates the merged list and writes the audit row. */
  private deleteTodoBody = async (
    input: DingtalkTodoIdInput,
  ): Promise<{ subject?: string; taskId: string }> => {
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
    return { subject, taskId: input.taskId };
  };

  completeTodo = async (
    input: DingtalkTodoIdInput,
  ): Promise<{ ok: boolean; subject?: string; taskId: string }> => {
    const result = await this.completeTodoBody(input);
    invalidateMergedCache(this.userId);
    await this.audit('complete', input.taskId);
    return { ok: true, subject: result.subject, taskId: result.taskId };
  };

  deleteTodo = async (
    input: DingtalkTodoIdInput,
  ): Promise<{ ok: boolean; subject?: string; taskId: string }> => {
    const result = await this.deleteTodoBody(input);
    invalidateMergedCache(this.userId);
    await this.audit('delete', input.taskId);
    return { ok: true, subject: result.subject, taskId: result.taskId };
  };

  private runTodoBatch = async (
    action: 'complete' | 'delete',
    taskIds: unknown,
  ): Promise<DingtalkTodoBatchResult> => {
    const ids = requireTodoBatchIds(taskIds);
    const write = action === 'complete' ? this.completeTodoBody : this.deleteTodoBody;
    const items: DingtalkTodoBatchItem[] = [];
    let stop = false;
    let wrote = false;
    let unavailableStreak = 0;
    for (const taskId of ids) {
      const cachedTitle = this.findCachedTodo(taskId)?.subject?.trim() || undefined;
      if (stop) {
        items.push({
          id: taskId,
          ok: false,
          skipped: true,
          ...(cachedTitle ? { title: cachedTitle } : {}),
        });
        continue;
      }
      try {
        const result = await write({ taskId });
        wrote = true;
        unavailableStreak = 0;
        await this.audit(action, taskId);
        const title = result.subject?.trim() || cachedTitle;
        items.push({ id: taskId, ok: true, ...(title ? { title } : {}) });
      } catch (error) {
        const code = errorCodeOf(error);
        const applyUrl = readBatchApplyUrl(error);
        items.push({
          ...(applyUrl ? { applyUrl } : {}),
          errorCode: code,
          id: taskId,
          ok: false,
          ...(cachedTitle ? { title: cachedTitle } : {}),
        });
        logUnexpectedTodoBatchError(error);
        if (code === 'DINGTALK_UNAVAILABLE') {
          unavailableStreak += 1;
          if (unavailableStreak >= TODO_BATCH_UNAVAILABLE_STREAK) stop = true;
        } else {
          unavailableStreak = 0;
          const stops =
            code === 'DINGTALK_FORBIDDEN'
              ? forbiddenStopsTodoBatch(error)
              : TODO_BATCH_STOP_CODES.has(code);
          if (stops) stop = true;
        }
      }
    }
    if (wrote) invalidateMergedCache(this.userId);
    return { items };
  };

  completeTodos = async (input: { taskIds: string[] }): Promise<DingtalkTodoBatchResult> =>
    this.runTodoBatch('complete', input?.taskIds);

  deleteTodos = async (input: { taskIds: string[] }): Promise<DingtalkTodoBatchResult> =>
    this.runTodoBatch('delete', input?.taskIds);

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

    if (input.apiName === 'completeTodos' || input.apiName === 'deleteTodos') {
      const read = readTodoBatchIds(args.taskIds);
      if ('reason' in read) return failWorkspace('DINGTALK_INVALID');
      const lines = [];
      for (const [index, taskId] of read.ids.entries()) {
        const existing = await this.requireTodo(taskId);
        lines.push({ label: '待办', value: `${index + 1}. ${existing.subject}` });
      }
      const count = read.ids.length;
      return {
        actingAs,
        danger: input.apiName === 'deleteTodos',
        lines,
        title: input.apiName === 'completeTodos' ? `完成 ${count} 项待办` : `删除 ${count} 项待办`,
        warnings,
      };
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
