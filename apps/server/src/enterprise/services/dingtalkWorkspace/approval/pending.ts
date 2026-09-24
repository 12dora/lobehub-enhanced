import { DingTalkDirectoryModel } from '@/database/models/dingtalkDirectory';
import type { LobeChatDatabase } from '@/database/type';

import { DingtalkWorkspaceError } from '../errors';
import {
  countPendingTasks,
  getInstanceDetail,
  isPremiumUnavailable,
  listInstanceIds,
  listPremiumTodoTasks,
  listVisibleTemplates,
  type PremiumTodoTask,
} from './api';
import {
  acquireApprovalSweepLock,
  approvalSweepEpochIsCurrent,
  bumpApprovalSweepEpoch,
  bumpApprovalUserGeneration,
  captureApprovalCacheGeneration,
  invalidateAllApprovalListCaches,
  invalidateApprovalInstanceCache,
  invalidateApprovalUserCache,
  readApprovalScopedCache,
  resetApprovalCacheForTest,
  waitForApprovalScopedCache,
  writeApprovalScopedCache,
} from './cache';
import { formSummary } from './formValues';
import { isRateLimitedError } from './scanPace';
import {
  type ApprovalListResult,
  type ApprovalScanIncomplete,
  type ApprovalScanIncompleteReason,
  DEFAULT_LIST_LIMIT,
  INCOMPLETE_CACHE_TTL_MS,
  INITIATED_CACHE_TTL_MS,
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
  SWEEP_CACHE_TTL_MS,
  type VisibleTemplate,
} from './types';

/** AIHub user plus the verified DingTalk staff id. Identity changes must not share rows. */
const scopeOf = (userId: string, staffId: string): string => `${userId}:${staffId}`;

const scopedKey = (userId: string, staffId: string, suffix: string): string =>
  `${scopeOf(userId, staffId)}:${suffix}`;

const sweepKeyFor = (userId: string, staffId: string): string =>
  scopedKey(userId, staffId, 'sweep');

const keyBelongsToUser = (key: string, userId: string): boolean =>
  key.startsWith(`${userId}:`) || key.includes(`:${userId}:`);

const dropMapKeysForUser = <T>(map: Map<string, T>, userId: string): void => {
  for (const key of map.keys()) {
    if (keyBelongsToUser(key, userId)) map.delete(key);
  }
};

type SharedSweepResult = {
  details: Array<{ detail: ProcessInstanceDetail; processCode: string }>;
  incomplete?: ApprovalScanIncomplete;
};

type SweepSession = {
  pendingTarget?: number;
  wantInitiated: boolean;
};

type SweepFlight = {
  epoch: number;
  promise: Promise<SharedSweepResult>;
  /** True when this flight was started by refresh. Concurrent refreshes share it. */
  refresh: boolean;
  session: SweepSession;
};

const sweepFlights = new Map<string, SweepFlight>();
/** Latest sweep epoch per user+staff. An older flight must not cache over a newer one. */
const sweepEpochs = new Map<string, number>();
/**
 * Pending-list write token per user+staff. refresh bumps it so an in-flight
 * list that started earlier cannot write its rows back over the refresh.
 */
const pendingWriteTokens = new Map<string, number>();

const SWEEP_SUFFIX = 'sweep';

const beginPendingWrite = (scope: string, refresh: boolean): number => {
  const current = pendingWriteTokens.get(scope) ?? 0;
  if (!refresh) return current;
  const next = current + 1;
  pendingWriteTokens.set(scope, next);
  return next;
};

const pendingWriteIsCurrent = (scope: string, token: number): boolean =>
  (pendingWriteTokens.get(scope) ?? 0) === token;

const dropUserPendingCaches = (userId: string): void => {
  invalidateApprovalUserCache(userId);
  dropMapKeysForUser(sweepFlights, userId);
  dropMapKeysForUser(sweepEpochs, userId);
  dropMapKeysForUser(pendingWriteTokens, userId);
};

export { invalidateApprovalInstanceCache };

/**
 * Drop the per-user pending/initiated result cache, shared sweep, and any
 * count memo. Best-effort: never throws (writes must not fail because of this).
 */
export const invalidatePendingCaches = (userId: string): void => {
  try {
    const id = userId.trim();
    if (!id) return;
    dropUserPendingCaches(id);
  } catch {
    // best-effort
  }
};

export const invalidateApprovalListCache = (userId?: string): void => {
  try {
    if (!userId?.trim()) {
      invalidateAllApprovalListCaches();
      sweepFlights.clear();
      sweepEpochs.clear();
      pendingWriteTokens.clear();
      return;
    }
    dropUserPendingCaches(userId.trim());
  } catch {
    // best-effort
  }
};

let scanTimeBudgetMs = SCAN_TIME_BUDGET_MS;

export const resetApprovalListCacheForTest = (): void => {
  resetApprovalCacheForTest();
  sweepFlights.clear();
  sweepEpochs.clear();
  pendingWriteTokens.clear();
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

const countRunningTasksFor = (
  details: Array<{ detail: ProcessInstanceDetail } | undefined>,
  staffId: string,
): number => {
  let count = 0;
  for (const item of details) {
    if (!item) continue;
    for (const task of item.detail.tasks) {
      if (task.userId === staffId && task.status === 'RUNNING') count += 1;
    }
  }
  return count;
};

const runSharedSweep = async (
  staffId: string,
  templatesInput: VisibleTemplate[],
  session: SweepSession,
  fresh = false,
): Promise<SharedSweepResult> => {
  const deadlineMs = Date.now() + scanTimeBudgetMs;
  const templates = sortTemplatesForScan(templatesInput);
  const totalTemplates = templates.length;
  if (totalTemplates === 0) return { details: [] };

  const details: Array<{ detail: ProcessInstanceDetail; processCode: string }> = [];
  let scannedTemplates = 0;
  let foundPending = 0;
  let reason: ApprovalScanIncompleteReason | undefined;
  const mark = (next: ApprovalScanIncompleteReason) => {
    reason = pickReason(reason, next);
  };
  const sinceMs = Date.now() - PENDING_LOOKBACK_MS;

  await mapWithConcurrency(templates, INSTANCE_IDS_QUERY_CONCURRENCY, async (template) => {
    if (Date.now() >= deadlineMs) {
      mark('time_budget');
      return;
    }
    if (details.length >= PENDING_INSTANCE_CAP) {
      mark('cap');
      return;
    }
    if (
      session.pendingTarget != null &&
      foundPending >= session.pendingTarget &&
      !session.wantInitiated
    ) {
      return;
    }
    try {
      const page = await listInstanceIds({
        deadlineMs,
        max: PENDING_INSTANCE_CAP,
        processCode: template.processCode,
        startTime: sinceMs,
        statuses: ['RUNNING'],
      });
      scannedTemplates += 1;
      if (page.stopped) mark(page.stopped);
      else if (page.truncated) mark('cap');
      const pageIds: Array<{ id: string; processCode: string }> = [];
      for (const id of page.ids) {
        if (details.length + pageIds.length >= PENDING_INSTANCE_CAP) {
          mark('cap');
          break;
        }
        pageIds.push({ id, processCode: template.processCode });
      }
      const loaded = await loadInstanceDetails(pageIds, deadlineMs, mark, fresh);
      for (const item of loaded) {
        if (!item) continue;
        details.push(item);
        foundPending += countRunningTasksFor([item], staffId);
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

  const incomplete =
    reason || scannedTemplates < totalTemplates
      ? {
          reason: reason ?? 'cap',
          scannedTemplates,
          totalTemplates,
        }
      : undefined;
  return { details, incomplete };
};

/** Ids and the fields the pending / initiated rows actually read. Drops records that blow the 1 MB cap. */
const compactDetailForSweepCache = (detail: ProcessInstanceDetail): ProcessInstanceDetail => ({
  ccUserIds: [],
  ...(detail.createTime ? { createTime: detail.createTime } : {}),
  formComponentValues: formSummary(detail.formComponentValues, SUMMARY_FIELD_LIMIT).map((item) => ({
    name: item.label,
    value: item.value,
  })),
  operationRecords: [],
  originatorUserId: detail.originatorUserId,
  processInstanceId: detail.processInstanceId,
  ...(detail.result ? { result: detail.result } : {}),
  ...(detail.status ? { status: detail.status } : {}),
  tasks: detail.tasks.map((task) => ({
    status: task.status,
    taskId: task.taskId,
    userId: task.userId,
  })),
  title: detail.title,
});

const compactSweepForCache = (result: SharedSweepResult): SharedSweepResult => ({
  ...(result.incomplete ? { incomplete: result.incomplete } : {}),
  details: result.details.map((item) => ({
    detail: compactDetailForSweepCache(item.detail),
    processCode: item.processCode,
  })),
});

const rememberSweep = async (
  input: { staffId: string; userId: string },
  generation: string,
  redisEpoch: string | undefined,
  epoch: number,
  key: string,
  result: SharedSweepResult,
): Promise<void> => {
  if (sweepEpochs.get(key) !== epoch) return;
  if (redisEpoch && !(await approvalSweepEpochIsCurrent(input.userId, input.staffId, redisEpoch))) {
    return;
  }
  await writeApprovalScopedCache({
    generation,
    now: Date.now(),
    staffId: input.staffId,
    suffix: SWEEP_SUFFIX,
    ttlMs: result.incomplete ? INCOMPLETE_CACHE_TTL_MS : SWEEP_CACHE_TTL_MS,
    userId: input.userId,
    value: compactSweepForCache(result),
  });
};

const loadSharedSweep = async (input: {
  pendingTarget?: number;
  refresh?: boolean;
  staffId: string;
  templates: VisibleTemplate[];
  userId: string;
  wantInitiated?: boolean;
}): Promise<SharedSweepResult> => {
  const now = Date.now();
  const key = sweepKeyFor(input.userId, input.staffId);
  if (!input.refresh) {
    const cached = await readApprovalScopedCache<SharedSweepResult>(
      input.userId,
      input.staffId,
      SWEEP_SUFFIX,
      now,
    );
    if (cached) return cached;
  }

  const existing = sweepFlights.get(key);
  // Refresh starts a new flight instead of joining one that began earlier.
  // Concurrent refreshes for the same user and staff still share one flight.
  const joinInFlight = existing && (!input.refresh || existing.refresh);
  if (existing && joinInFlight) {
    if (input.pendingTarget != null) {
      existing.session.pendingTarget =
        existing.session.pendingTarget == null
          ? input.pendingTarget
          : Math.max(existing.session.pendingTarget, input.pendingTarget);
    }
    if (input.wantInitiated) existing.session.wantInitiated = true;
    return existing.promise;
  }

  // The cache read above already awaited. Register the flight in this turn,
  // before the lock await, so the next caller joins instead of scanning.
  const epoch = (sweepEpochs.get(key) ?? 0) + 1;
  sweepEpochs.set(key, epoch);
  const nextSession: SweepSession = {
    pendingTarget: input.pendingTarget,
    wantInitiated: input.wantInitiated === true,
  };
  const promise = (async (): Promise<SharedSweepResult> => {
    let lock = await acquireApprovalSweepLock(
      input.userId,
      input.staffId,
      input.refresh ? 'refresh' : 'scan',
    );
    let release = lock.kind === 'acquired' ? lock.release : undefined;
    try {
      if (lock.kind === 'busy') {
        const waited = await waitForApprovalScopedCache<SharedSweepResult>(
          input.userId,
          input.staffId,
          SWEEP_SUFFIX,
        );
        if (waited) return waited;
        lock = await acquireApprovalSweepLock(
          input.userId,
          input.staffId,
          input.refresh ? 'refresh' : 'scan',
        );
        release = lock.kind === 'acquired' ? lock.release : undefined;
      }
      // Epoch moves only while this process holds the lock. An unlocked sweep
      // must not discard the holder's cached result.
      const holdsLock = lock.kind === 'acquired';
      const redisEpoch = holdsLock
        ? await bumpApprovalSweepEpoch(input.userId, input.staffId)
        : undefined;
      const generation = await captureApprovalCacheGeneration(input.userId);
      const result = await runSharedSweep(
        input.staffId,
        input.templates,
        nextSession,
        input.refresh === true,
      );
      if (holdsLock || lock.kind === 'down') {
        await rememberSweep(input, generation, redisEpoch, epoch, key, result);
      }
      return result;
    } finally {
      const current = sweepFlights.get(key);
      if (current?.epoch === epoch) sweepFlights.delete(key);
      if (release) void release();
    }
  })();
  sweepFlights.set(key, {
    epoch,
    promise,
    refresh: input.refresh === true,
    session: nextSession,
  });
  return promise;
};

const filterTemplatesForInitiated = (
  templates: VisibleTemplate[],
  input?: { processCode?: string; q?: string },
): VisibleTemplate[] => {
  const processCode = input?.processCode?.trim();
  const q = input?.q?.trim().toLowerCase();
  if (processCode) {
    const hit = templates.find((item) => item.processCode === processCode);
    return [hit ?? { name: processCode, processCode }];
  }
  if (!q) return templates;
  return templates.filter(
    (item) => item.name.toLowerCase().includes(q) || item.processCode.toLowerCase().includes(q),
  );
};

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

async function loadInstanceDetails(
  ids: Array<{ id: string; processCode: string }>,
  deadlineMs: number,
  mark: (reason: ApprovalScanIncompleteReason) => void,
  fresh = false,
): Promise<Array<{ detail: ProcessInstanceDetail; processCode: string } | undefined>> {
  return mapWithConcurrency(ids, INSTANCE_DETAIL_CONCURRENCY, async (item) => {
    if (Date.now() >= deadlineMs) {
      mark('time_budget');
      return undefined;
    }
    try {
      const detail = fresh
        ? await getInstanceDetail(item.id, { fresh: true })
        : await getInstanceDetail(item.id);
      return { detail, processCode: item.processCode };
    } catch (error) {
      if (isRateLimitedError(error)) mark('rate_limited');
      return undefined;
    }
  });
}

const pendingRowsFromSweep = (
  sweep: SharedSweepResult,
  staffId: string,
  templates: VisibleTemplate[],
  names: Map<string, string>,
  limit: number,
  pendingTarget?: number,
): ApprovalListResult<PendingApprovalRow> => {
  const nameByCode = new Map(templates.map((item) => [item.processCode, item.name]));
  const rows: PendingApprovalRow[] = [];
  for (const item of sweep.details) {
    for (const task of item.detail.tasks) {
      if (task.userId !== staffId || task.status !== 'RUNNING') continue;
      rows.push(rowFromDetail(item.detail, nameByCode.get(item.processCode), task.taskId, names));
    }
  }
  rows.sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''));
  const sliced = rows.slice(0, limit);
  const foundAllKnown = pendingTarget != null && pendingTarget >= 0 && rows.length >= pendingTarget;
  const missingKnown = pendingTarget != null && rows.length < pendingTarget;
  // A finished sweep can still miss todos (stale cache, lookback, early-stop).
  // Never present a complete-looking list when the live count is higher.
  let incomplete: ApprovalScanIncomplete | undefined;
  if (foundAllKnown) {
    incomplete = undefined;
  } else if (sweep.incomplete) {
    incomplete = sweep.incomplete;
  } else if (missingKnown) {
    incomplete = {
      reason: 'cap',
      scannedTemplates: templates.length,
      totalTemplates: templates.length,
    };
  }
  return {
    incomplete,
    rows: sliced,
    truncated: Boolean(incomplete) || missingKnown || rows.length > limit,
  };
};

const listPendingByScan = async (
  db: LobeChatDatabase,
  staffId: string,
  templates: VisibleTemplate[],
  limit: number,
  userId: string,
  pendingTarget?: number,
  refresh = false,
): Promise<ApprovalListResult<PendingApprovalRow>> => {
  const sweep = await loadSharedSweep({
    pendingTarget,
    refresh,
    staffId,
    templates,
    userId,
    wantInitiated: false,
  });
  const names = await loadOriginatorNames(
    db,
    sweep.details.map((item) => item.detail.originatorUserId),
  );
  return pendingRowsFromSweep(sweep, staffId, templates, names, limit, pendingTarget);
};

/**
 * Detail fills gaps the premium row does not already carry.
 * Originator and create time are part of the tool row, same as title and the form summary.
 */
const premiumRowNeedsInstanceDetail = (item: PremiumTodoTask): boolean =>
  !item.title.trim() ||
  !item.formMassage?.trim() ||
  !item.originatorName?.trim() ||
  !item.processCreateTime?.trim();

const enrichPremiumRows = async (
  db: LobeChatDatabase,
  list: PremiumTodoTask[],
  processNameByInstance: Map<string, string>,
): Promise<PendingApprovalRow[]> => {
  const details = await mapWithConcurrency(list, INSTANCE_DETAIL_CONCURRENCY, async (item) => {
    if (!premiumRowNeedsInstanceDetail(item)) return undefined;
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
  refresh?: boolean;
  staffId: string;
  templates: VisibleTemplate[];
  userId: string;
}): Promise<ApprovalListResult<PendingApprovalRow>> => {
  const limit = clampLimit(input.limit);
  const now = Date.now();
  const cacheSuffix = `pending:${limit}`;
  if (!input.refresh) {
    const cached = await readApprovalScopedCache<ApprovalListResult<PendingApprovalRow>>(
      input.userId,
      input.staffId,
      cacheSuffix,
      now,
    );
    if (cached) return cached;
  }
  const scope = scopeOf(input.userId, input.staffId);
  // Redis generation, not only the in-process token: a slower list on another
  // replica captured the old generation and must not overwrite this refresh.
  if (input.refresh) await bumpApprovalUserGeneration(input.userId);
  const writeToken = beginPendingWrite(scope, input.refresh === true);
  const generation = await captureApprovalCacheGeneration(input.userId);
  const storePending = async (
    value: ApprovalListResult<PendingApprovalRow>,
    ttlMs: number,
  ): Promise<void> => {
    if (!pendingWriteIsCurrent(scope, writeToken)) return;
    await writeApprovalScopedCache({
      generation,
      now: Date.now(),
      staffId: input.staffId,
      suffix: cacheSuffix,
      ttlMs,
      userId: input.userId,
      value,
    });
  };

  let pendingTarget: number | undefined;
  try {
    pendingTarget = await countPendingTasks(input.staffId);
  } catch {
    pendingTarget = undefined;
  }
  if (pendingTarget === 0) {
    const empty: ApprovalListResult<PendingApprovalRow> = { rows: [], truncated: false };
    await storePending(empty, PENDING_CACHE_TTL_MS);
    return empty;
  }

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
    result = await listPendingByScan(
      input.db,
      input.staffId,
      input.templates,
      limit,
      input.userId,
      pendingTarget,
      input.refresh === true,
    );
  }

  await storePending(result, result.incomplete ? INCOMPLETE_CACHE_TTL_MS : PENDING_CACHE_TTL_MS);
  return result;
};

const initiatedRowsFromDetails = (
  details: Array<{ detail: ProcessInstanceDetail; processCode: string } | undefined>,
  templates: VisibleTemplate[],
  originatorNames: Map<string, string>,
  staffId: string,
  limit: number,
  incomplete: ApprovalScanIncomplete | undefined,
  status?: string,
): ApprovalListResult<InitiatedApprovalRow> => {
  const nameByCode = new Map(templates.map((item) => [item.processCode, item.name]));
  const rows: InitiatedApprovalRow[] = [];
  for (const item of details) {
    if (!item) continue;
    if (item.detail.originatorUserId !== staffId) continue;
    if (status && item.detail.status !== status) continue;
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
  return {
    incomplete,
    rows: sliced,
    truncated: Boolean(incomplete) || rows.length > limit,
  };
};

const listInitiatedByTemplateScan = async (input: {
  db: LobeChatDatabase;
  limit: number;
  staffId: string;
  status?: string;
  templates: VisibleTemplate[];
}): Promise<ApprovalListResult<InitiatedApprovalRow>> => {
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
  const details = await loadInstanceDetails(collected.ids, deadlineMs, mark);
  const originatorNames = await loadOriginatorNames(
    input.db,
    details.map((item) => item?.detail.originatorUserId),
  );
  const incomplete = reason
    ? {
        reason,
        scannedTemplates: collected.incomplete?.scannedTemplates ?? input.templates.length,
        totalTemplates: input.templates.length,
      }
    : undefined;
  return initiatedRowsFromDetails(
    details,
    input.templates,
    originatorNames,
    input.staffId,
    input.limit,
    incomplete,
    input.status,
  );
};

export const listInitiatedApprovals = async (input: {
  db: LobeChatDatabase;
  limit?: number;
  processCode?: string;
  q?: string;
  staffId: string;
  status?: string;
  templates: VisibleTemplate[];
  userId: string;
}): Promise<ApprovalListResult<InitiatedApprovalRow>> => {
  const limit = clampLimit(input.limit);
  const templates = filterTemplatesForInitiated(input.templates, {
    processCode: input.processCode,
    q: input.q,
  });
  const now = Date.now();
  const cacheSuffix = [
    'initiated',
    input.status ?? 'all',
    input.processCode ?? '',
    input.q ?? '',
    String(limit),
  ].join(':');
  const cached = await readApprovalScopedCache<ApprovalListResult<InitiatedApprovalRow>>(
    input.userId,
    input.staffId,
    cacheSuffix,
    now,
  );
  if (cached) return cached;
  const generation = await captureApprovalCacheGeneration(input.userId);

  const targeted = Boolean(input.processCode?.trim() || input.q?.trim());
  const otherStatus = Boolean(input.status && input.status !== 'RUNNING');
  const useShared = !targeted && !otherStatus;

  let result: ApprovalListResult<InitiatedApprovalRow>;
  if (useShared) {
    const sweep = await loadSharedSweep({
      staffId: input.staffId,
      templates,
      userId: input.userId,
      wantInitiated: true,
    });
    const originatorNames = await loadOriginatorNames(
      input.db,
      sweep.details.map((item) => item.detail.originatorUserId),
    );
    result = initiatedRowsFromDetails(
      sweep.details,
      templates,
      originatorNames,
      input.staffId,
      limit,
      sweep.incomplete,
      input.status,
    );
  } else {
    result = await listInitiatedByTemplateScan({
      db: input.db,
      limit,
      staffId: input.staffId,
      status: input.status,
      templates,
    });
  }

  await writeApprovalScopedCache({
    generation,
    now: Date.now(),
    staffId: input.staffId,
    suffix: cacheSuffix,
    ttlMs: result.incomplete ? INCOMPLETE_CACHE_TTL_MS : INITIATED_CACHE_TTL_MS,
    userId: input.userId,
    value: result,
  });
  return result;
};

export const loadVisibleTemplatesCached = async (
  userId: string,
  staffId: string,
  ttlMs: number,
  refresh = false,
): Promise<VisibleTemplate[]> => {
  const now = Date.now();
  const cacheSuffix = 'templates';
  if (!refresh) {
    const cached = await readApprovalScopedCache<VisibleTemplate[]>(
      userId,
      staffId,
      cacheSuffix,
      now,
    );
    if (cached) return cached;
  }
  const generation = await captureApprovalCacheGeneration(userId);
  const templates = await listVisibleTemplates(staffId);
  await writeApprovalScopedCache({
    generation,
    now,
    staffId,
    suffix: cacheSuffix,
    ttlMs,
    userId,
    value: templates,
  });
  return templates;
};
