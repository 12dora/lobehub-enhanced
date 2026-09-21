import { DingTalkDirectoryModel } from '@/database/models/dingtalkDirectory';
import type { LobeChatDatabase } from '@/database/type';

import { DingtalkWorkspaceError } from '../errors';
import {
  getInstanceDetail,
  isPremiumUnavailable,
  listInstanceIds,
  listPremiumTodoTasks,
  listVisibleTemplates,
} from './api';
import { formSummary } from './formValues';
import { isRateLimitedError } from './scanPace';
import {
  type ApprovalListResult,
  type ApprovalScanIncomplete,
  type ApprovalScanIncompleteReason,
  DEFAULT_LIST_LIMIT,
  INCOMPLETE_CACHE_TTL_MS,
  type InitiatedApprovalRow,
  INSTANCE_DETAIL_CONCURRENCY,
  INSTANCE_IDS_QUERY_CONCURRENCY,
  MAX_LIST_LIMIT,
  PENDING_CACHE_TTL_MS,
  PENDING_INSTANCE_CAP,
  PENDING_LOOKBACK_MS,
  type PendingApprovalRow,
  type ProcessInstanceDetail,
  SCAN_TIME_BUDGET_MS,
  SUMMARY_FIELD_LIMIT,
  type VisibleTemplate,
} from './types';

type CacheEntry<T> = { expiresAt: number; value: T };

const cache = new Map<string, CacheEntry<unknown>>();

const cacheGet = <T>(key: string, now: number): T | undefined => {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
};

const cacheSet = <T>(key: string, value: T, ttlMs: number, now: number): void => {
  cache.set(key, { expiresAt: now + ttlMs, value });
};

export const invalidateApprovalListCache = (userId?: string): void => {
  if (!userId) {
    cache.clear();
    return;
  }
  const prefix = `${userId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix) || key.includes(`:${userId}:`)) cache.delete(key);
  }
};

let scanTimeBudgetMs = SCAN_TIME_BUDGET_MS;

export const resetApprovalListCacheForTest = (): void => {
  cache.clear();
  scanTimeBudgetMs = SCAN_TIME_BUDGET_MS;
};

export const setApprovalScanTimeBudgetForTest = (ms?: number): void => {
  scanTimeBudgetMs = ms ?? SCAN_TIME_BUDGET_MS;
};

const clampLimit = (limit?: number): number => {
  if (limit == null) return DEFAULT_LIST_LIMIT;
  if (!Number.isFinite(limit)) return DEFAULT_LIST_LIMIT;
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(limit)));
};

const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) return [];
  const results: R[] = Array.from({ length: items.length });
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index] as T);
      }
    }),
  );
  return results;
};

const originatorNameOf = (
  staffId: string | undefined,
  names: Map<string, string>,
): string | undefined => {
  if (!staffId) return undefined;
  return names.get(staffId) ?? staffId;
};

const loadOriginatorNames = async (
  db: LobeChatDatabase,
  staffIds: Array<string | undefined>,
): Promise<Map<string, string>> => {
  const unique = [...new Set(staffIds.filter((id): id is string => Boolean(id?.trim())))];
  if (unique.length === 0) return new Map();
  const users = await new DingTalkDirectoryModel(db).getUsers(unique);
  const names = new Map<string, string>();
  for (const user of users) {
    if (user.name) names.set(user.staffId, user.name);
  }
  return names;
};

const rowFromDetail = (
  detail: ProcessInstanceDetail,
  processName: string | undefined,
  taskId: string,
  names: Map<string, string>,
): PendingApprovalRow => ({
  createdAt: detail.createTime,
  originatorName: originatorNameOf(detail.originatorUserId, names),
  processInstanceId: detail.processInstanceId,
  processName,
  summary: formSummary(detail.formComponentValues, SUMMARY_FIELD_LIMIT),
  taskId,
  title: detail.title,
});

const REASON_RANK: Record<ApprovalScanIncompleteReason, number> = {
  cap: 2,
  rate_limited: 0,
  time_budget: 1,
};

const pickReason = (
  current: ApprovalScanIncompleteReason | undefined,
  next: ApprovalScanIncompleteReason,
): ApprovalScanIncompleteReason => {
  if (!current) return next;
  return REASON_RANK[next] < REASON_RANK[current] ? next : current;
};

const modifiedMs = (value?: string): number => {
  if (!value?.trim()) return 0;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : 0;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
};

const sortTemplatesForScan = (templates: VisibleTemplate[]): VisibleTemplate[] => {
  if (!templates.some((item) => item.modifiedAt)) return templates;
  return [...templates].sort(
    (left, right) => modifiedMs(right.modifiedAt) - modifiedMs(left.modifiedAt),
  );
};

const cacheTtlMs = (result: ApprovalListResult<unknown>): number =>
  result.incomplete ? INCOMPLETE_CACHE_TTL_MS : PENDING_CACHE_TTL_MS;

type CollectedInstanceIds = {
  ids: Array<{ id: string; processCode: string }>;
  incomplete?: ApprovalScanIncomplete;
};

const collectInstanceIds = async (input: {
  deadlineMs: number;
  sinceMs: number;
  statuses?: string[];
  templates: VisibleTemplate[];
  userIds?: string[];
}): Promise<CollectedInstanceIds> => {
  const templates = sortTemplatesForScan(input.templates);
  const totalTemplates = templates.length;
  if (totalTemplates === 0) return { ids: [] };

  const ids: Array<{ id: string; processCode: string }> = [];
  let scannedTemplates = 0;
  let reason: ApprovalScanIncompleteReason | undefined;
  const mark = (next: ApprovalScanIncompleteReason) => {
    reason = pickReason(reason, next);
  };

  await mapWithConcurrency(templates, INSTANCE_IDS_QUERY_CONCURRENCY, async (template) => {
    if (Date.now() >= input.deadlineMs) {
      mark('time_budget');
      return;
    }
    if (ids.length >= PENDING_INSTANCE_CAP) {
      mark('cap');
      return;
    }
    try {
      const page = await listInstanceIds({
        deadlineMs: input.deadlineMs,
        max: PENDING_INSTANCE_CAP,
        processCode: template.processCode,
        startTime: input.sinceMs,
        statuses: input.statuses,
        userIds: input.userIds,
      });
      scannedTemplates += 1;
      if (page.stopped) mark(page.stopped);
      else if (page.truncated) mark('cap');
      for (const id of page.ids) {
        if (ids.length >= PENDING_INSTANCE_CAP) {
          mark('cap');
          return;
        }
        ids.push({ id, processCode: template.processCode });
      }
    } catch (error) {
      if (isRateLimitedError(error)) {
        mark('rate_limited');
        return;
      }
      throw error;
    }
  });

  if (scannedTemplates === 0) {
    throw new DingtalkWorkspaceError('DINGTALK_RATE_LIMITED');
  }

  if (ids.length > PENDING_INSTANCE_CAP) mark('cap');
  const sliced = ids.slice(0, PENDING_INSTANCE_CAP);
  if (sliced.length >= PENDING_INSTANCE_CAP && scannedTemplates < totalTemplates) mark('cap');

  return {
    ids: sliced,
    incomplete: reason ? { reason, scannedTemplates, totalTemplates } : undefined,
  };
};

const loadInstanceDetails = async (
  ids: Array<{ id: string; processCode: string }>,
  deadlineMs: number,
  mark: (reason: ApprovalScanIncompleteReason) => void,
): Promise<Array<{ detail: ProcessInstanceDetail; processCode: string } | undefined>> =>
  mapWithConcurrency(ids, INSTANCE_DETAIL_CONCURRENCY, async (item) => {
    if (Date.now() >= deadlineMs) {
      mark('time_budget');
      return undefined;
    }
    try {
      const detail = await getInstanceDetail(item.id);
      return { detail, processCode: item.processCode };
    } catch (error) {
      if (isRateLimitedError(error)) mark('rate_limited');
      return undefined;
    }
  });

const listPendingByScan = async (
  db: LobeChatDatabase,
  staffId: string,
  templates: VisibleTemplate[],
  limit: number,
): Promise<ApprovalListResult<PendingApprovalRow>> => {
  const deadlineMs = Date.now() + scanTimeBudgetMs;
  const collected = await collectInstanceIds({
    deadlineMs,
    sinceMs: Date.now() - PENDING_LOOKBACK_MS,
    statuses: ['RUNNING'],
    templates,
  });

  let reason = collected.incomplete?.reason;
  const mark = (next: ApprovalScanIncompleteReason) => {
    reason = pickReason(reason, next);
  };

  const details = await loadInstanceDetails(collected.ids, deadlineMs, mark);
  const names = await loadOriginatorNames(
    db,
    details.map((item) => item?.detail.originatorUserId),
  );
  const nameByCode = new Map(templates.map((item) => [item.processCode, item.name]));

  const rows: PendingApprovalRow[] = [];
  for (const item of details) {
    if (!item) continue;
    for (const task of item.detail.tasks) {
      if (task.userId !== staffId || task.status !== 'RUNNING') continue;
      rows.push(rowFromDetail(item.detail, nameByCode.get(item.processCode), task.taskId, names));
    }
  }

  rows.sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''));
  const sliced = rows.slice(0, limit);
  const incomplete = reason
    ? {
        reason,
        scannedTemplates: collected.incomplete?.scannedTemplates ?? templates.length,
        totalTemplates: templates.length,
      }
    : undefined;
  return {
    incomplete,
    rows: sliced,
    truncated: Boolean(incomplete) || rows.length > limit,
  };
};

const enrichPremiumRows = async (
  db: LobeChatDatabase,
  list: Array<{
    formMassage?: string;
    originatorName?: string;
    processCreateTime?: string;
    processInstanceId: string;
    taskId: string;
    title: string;
  }>,
  processNameByInstance: Map<string, string>,
): Promise<PendingApprovalRow[]> => {
  const details = await mapWithConcurrency(list, INSTANCE_DETAIL_CONCURRENCY, async (item) => {
    try {
      return await getInstanceDetail(item.processInstanceId);
    } catch {
      return undefined;
    }
  });

  const names = await loadOriginatorNames(
    db,
    details.map((detail) => detail?.originatorUserId),
  );

  return list.map((item, index) => {
    const detail = details[index];
    const summary = detail
      ? formSummary(detail.formComponentValues, SUMMARY_FIELD_LIMIT)
      : item.formMassage
        ? [{ label: '表单', value: item.formMassage }]
        : [];
    return {
      createdAt: item.processCreateTime ?? detail?.createTime,
      originatorName: item.originatorName ?? originatorNameOf(detail?.originatorUserId, names),
      processInstanceId: item.processInstanceId,
      processName: processNameByInstance.get(item.processInstanceId),
      summary,
      taskId: item.taskId,
      title: item.title || detail?.title || '',
    };
  });
};

export const listPendingApprovals = async (input: {
  db: LobeChatDatabase;
  limit?: number;
  staffId: string;
  templates: VisibleTemplate[];
  userId: string;
}): Promise<ApprovalListResult<PendingApprovalRow>> => {
  const limit = clampLimit(input.limit);
  const now = Date.now();
  const cacheKey = `${input.userId}:pending:${limit}`;
  const cached = cacheGet<ApprovalListResult<PendingApprovalRow>>(cacheKey, now);
  if (cached) return cached;

  let result: ApprovalListResult<PendingApprovalRow>;
  try {
    const premium = await listPremiumTodoTasks(input.staffId, { limit });
    const nameByCode = new Map(input.templates.map((item) => [item.processCode, item.name]));
    const processNameByInstance = new Map<string, string>();
    for (const row of premium.list) {
      const match = input.templates.find((template) => row.title.includes(template.name));
      if (match) processNameByInstance.set(row.processInstanceId, match.name);
      else if (nameByCode.size === 1) {
        processNameByInstance.set(row.processInstanceId, input.templates[0].name);
      }
    }
    const rows = await enrichPremiumRows(
      input.db,
      premium.list.slice(0, limit),
      processNameByInstance,
    );
    result = { rows, truncated: premium.hasMore || premium.list.length > limit };
  } catch (error) {
    if (!isPremiumUnavailable(error)) throw error;
    result = await listPendingByScan(input.db, input.staffId, input.templates, limit);
  }

  cacheSet(cacheKey, result, cacheTtlMs(result), Date.now());
  return result;
};

export const listInitiatedApprovals = async (input: {
  db: LobeChatDatabase;
  limit?: number;
  staffId: string;
  status?: string;
  templates: VisibleTemplate[];
  userId: string;
}): Promise<ApprovalListResult<InitiatedApprovalRow>> => {
  const limit = clampLimit(input.limit);
  const now = Date.now();
  const cacheKey = `${input.userId}:initiated:${input.status ?? 'all'}:${limit}`;
  const cached = cacheGet<ApprovalListResult<InitiatedApprovalRow>>(cacheKey, now);
  if (cached) return cached;

  const deadlineMs = Date.now() + scanTimeBudgetMs;
  const collected = await collectInstanceIds({
    deadlineMs,
    sinceMs: Date.now() - PENDING_LOOKBACK_MS,
    statuses: input.status ? [input.status] : undefined,
    templates: input.templates,
    userIds: [input.staffId],
  });

  let reason = collected.incomplete?.reason;
  const mark = (next: ApprovalScanIncompleteReason) => {
    reason = pickReason(reason, next);
  };

  const nameByCode = new Map(input.templates.map((item) => [item.processCode, item.name]));
  const details = await loadInstanceDetails(collected.ids, deadlineMs, mark);

  const originatorNames = await loadOriginatorNames(
    input.db,
    details.map((item) => item?.detail.originatorUserId),
  );

  const rows: InitiatedApprovalRow[] = [];
  for (const item of details) {
    if (!item) continue;
    rows.push({
      createdAt: item.detail.createTime,
      originatorName: originatorNameOf(item.detail.originatorUserId, originatorNames),
      processInstanceId: item.detail.processInstanceId,
      processName: nameByCode.get(item.processCode),
      result: item.detail.result,
      status: item.detail.status,
      summary: formSummary(item.detail.formComponentValues, SUMMARY_FIELD_LIMIT),
      title: item.detail.title,
    });
  }
  rows.sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''));
  const sliced = rows.slice(0, limit);
  const incomplete = reason
    ? {
        reason,
        scannedTemplates: collected.incomplete?.scannedTemplates ?? input.templates.length,
        totalTemplates: input.templates.length,
      }
    : undefined;
  const result: ApprovalListResult<InitiatedApprovalRow> = {
    incomplete,
    rows: sliced,
    truncated: Boolean(incomplete) || rows.length > limit,
  };
  cacheSet(cacheKey, result, cacheTtlMs(result), Date.now());
  return result;
};

export const loadVisibleTemplatesCached = async (
  userId: string,
  staffId: string,
  ttlMs: number,
): Promise<VisibleTemplate[]> => {
  const now = Date.now();
  const cacheKey = `${userId}:templates`;
  const cached = cacheGet<VisibleTemplate[]>(cacheKey, now);
  if (cached) return cached;
  const templates = await listVisibleTemplates(staffId);
  cacheSet(cacheKey, templates, ttlMs, now);
  return templates;
};
