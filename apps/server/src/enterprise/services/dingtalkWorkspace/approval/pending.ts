import { DingTalkDirectoryModel } from '@/database/models/dingtalkDirectory';
import type { LobeChatDatabase } from '@/database/type';

import {
  getInstanceDetail,
  isPremiumUnavailable,
  listInstanceIds,
  listPremiumTodoTasks,
  listVisibleTemplates,
} from './api';
import { formSummary } from './formValues';
import {
  type ApprovalListResult,
  DEFAULT_LIST_LIMIT,
  type InitiatedApprovalRow,
  INSTANCE_DETAIL_CONCURRENCY,
  MAX_LIST_LIMIT,
  PENDING_CACHE_TTL_MS,
  PENDING_INSTANCE_CAP,
  PENDING_LOOKBACK_MS,
  type PendingApprovalRow,
  type ProcessInstanceDetail,
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

export const resetApprovalListCacheForTest = (): void => {
  cache.clear();
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

const listPendingByScan = async (
  db: LobeChatDatabase,
  staffId: string,
  templates: VisibleTemplate[],
  limit: number,
): Promise<ApprovalListResult<PendingApprovalRow>> => {
  const sinceMs = Date.now() - PENDING_LOOKBACK_MS;
  const nameByCode = new Map(templates.map((item) => [item.processCode, item.name]));
  const ids: Array<{ id: string; processCode: string }> = [];
  let truncated = false;

  for (const template of templates) {
    if (ids.length >= PENDING_INSTANCE_CAP) {
      truncated = true;
      break;
    }
    const page = await listInstanceIds({
      max: PENDING_INSTANCE_CAP - ids.length,
      processCode: template.processCode,
      startTime: sinceMs,
      statuses: ['RUNNING'],
    });
    truncated = truncated || page.truncated;
    for (const id of page.ids) {
      ids.push({ id, processCode: template.processCode });
      if (ids.length >= PENDING_INSTANCE_CAP) {
        truncated = true;
        break;
      }
    }
  }

  const details = await mapWithConcurrency(ids, INSTANCE_DETAIL_CONCURRENCY, async (item) => {
    try {
      const detail = await getInstanceDetail(item.id);
      return { detail, processCode: item.processCode };
    } catch {
      return undefined;
    }
  });

  const names = await loadOriginatorNames(
    db,
    details.map((item) => item?.detail.originatorUserId),
  );

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
  return { rows: sliced, truncated: truncated || rows.length > limit };
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

  cacheSet(cacheKey, result, PENDING_CACHE_TTL_MS, now);
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

  const sinceMs = Date.now() - PENDING_LOOKBACK_MS;
  const ids: Array<{ id: string; processCode: string }> = [];
  let truncated = false;
  const statuses = input.status ? [input.status] : undefined;

  for (const template of input.templates) {
    if (ids.length >= PENDING_INSTANCE_CAP) {
      truncated = true;
      break;
    }
    const page = await listInstanceIds({
      max: PENDING_INSTANCE_CAP - ids.length,
      processCode: template.processCode,
      startTime: sinceMs,
      statuses,
      userIds: [input.staffId],
    });
    truncated = truncated || page.truncated;
    for (const id of page.ids) {
      ids.push({ id, processCode: template.processCode });
      if (ids.length >= PENDING_INSTANCE_CAP) {
        truncated = true;
        break;
      }
    }
  }

  const nameByCode = new Map(input.templates.map((item) => [item.processCode, item.name]));
  const details = await mapWithConcurrency(ids, INSTANCE_DETAIL_CONCURRENCY, async (item) => {
    try {
      const detail = await getInstanceDetail(item.id);
      return { detail, processCode: item.processCode };
    } catch {
      return undefined;
    }
  });

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
  const result = { rows: sliced, truncated: truncated || rows.length > limit };
  cacheSet(cacheKey, result, PENDING_CACHE_TTL_MS, now);
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
