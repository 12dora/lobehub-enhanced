import type { ApprovalAutomationTier, ApprovalRuleAction } from '@lobechat/types';
import { APPROVAL_AUTOMATION_TIERS } from '@lobechat/types';
import debug from 'debug';
import { and, eq, isNotNull, lte } from 'drizzle-orm';

import { getServerDB } from '@/database/core/db-adaptor';
import {
  DingtalkApprovalRuleModel,
  RUN_CLAIM_IN_PROGRESS,
} from '@/database/models/dingtalkApprovalRule';
import { DingTalkDirectoryModel } from '@/database/models/dingtalkDirectory';
import type { DingtalkApprovalRuleItem } from '@/database/schemas/dingtalkApprovalRule';
import { dingtalkApprovalRules as approvalRulesTable } from '@/database/schemas/dingtalkApprovalRule';
import { dingtalkUserDepartments } from '@/database/schemas/dingtalkDirectory';
import type { LobeChatDatabase, Transaction } from '@/database/type';
import { recordRuntimeError } from '@/server/enterprise/services/platformSystem/runtimeErrors';
import {
  markWorkerFailed,
  markWorkerStarted,
  markWorkerTick,
} from '@/server/enterprise/services/platformSystem/workerHeartbeat';

import { AUDIT_ACTION, AUDIT_TARGET_TYPE } from '../../audit/auditActionCatalog';
import { PlatformAuditService } from '../../platformAudit';
import {
  addCommentAs,
  executeTaskAs,
  getInstanceDetail,
  listRunningInstanceIds,
  redirectTaskAs,
} from '../approval/api';
import { invalidatePendingCaches } from '../approval/pending';
import { getDingtalkWorkspaceCapabilities } from '../capabilities';
import { DingtalkWorkspaceError } from '../errors';
import { resolveVerifiedDingtalkIdentity } from '../identity';
import { notifyUser } from '../notify';
import { type ApprovalMatchFormValue, matchApprovalRule } from './match';
import { ruleExceedsTierMaxExpiry } from './tier';
import { getPendingApprovalTaskCount } from './todoCount';
import {
  APPROVAL_RULE_EVALUATED_TTL_MS,
  APPROVAL_RULE_REVERIFY_MS,
  fingerprintEnabledApprovalRules,
  markOwnerScanStarted,
  ownerTaskIsRemembered,
  rememberOwnerTask,
  resetApprovalRuleWorkerMemoryForTest,
  syncOwnerTaskMemory,
} from './workerMemory';

export {
  APPROVAL_RULE_EVALUATED_TTL_MS,
  APPROVAL_RULE_REVERIFY_MS,
  invalidateApprovalRuleWorkerMemory,
} from './workerMemory';

const log = debug('lobe-server:dingtalk-workspace:approval-rules');

export const APPROVAL_RULE_SWEEP_INTERVAL_MS = 180_000;
export const APPROVAL_RULE_SWEEP_JITTER_MS = 30_000;
export const APPROVAL_RULE_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
export const APPROVAL_RULE_INSTANCE_CAP = 300;
export const APPROVAL_RULE_DETAIL_CONCURRENCY = 5;
export const APPROVAL_RULE_PROCESS_CODE_CAP = 50;

export const nextApprovalRuleSweepDelayMs = (random: () => number = Math.random): number => {
  const jitter = Math.round((random() * 2 - 1) * APPROVAL_RULE_SWEEP_JITTER_MS);
  return Math.max(0, APPROVAL_RULE_SWEEP_INTERVAL_MS + jitter);
};

/** Terminal DingTalk outcomes: keep the unique run row so the task is not retried. */
const TERMINAL_EXECUTE_CODES = new Set([
  'DINGTALK_FORBIDDEN',
  'DINGTALK_INVALID',
  'DINGTALK_NOT_FOUND',
  'DINGTALK_NOT_TASK_OWNER',
]);

let processCodeOffset = 0;

type ListRunningInstanceIds = (
  processCode: string,
  sinceMs: number,
  max?: number,
) => Promise<string[]>;

const SHANGHAI = 'Asia/Shanghai';
const ANCESTOR_WALK_LIMIT = 32;

export const shanghaiDate = (now: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: SHANGHAI,
    year: 'numeric',
  }).format(now);

export const isApprovalRuleWorkerRuntime = (
  env: Partial<NodeJS.ProcessEnv> = process.env,
): boolean => {
  if (!env.DATABASE_URL) return false;
  if (env.VERCEL === '1' || Boolean(env.VERCEL_ENV)) return false;
  if (env.NEXT_RUNTIME === 'edge') return false;
  if (env.AWS_LAMBDA_FUNCTION_NAME) return false;
  return true;
};

const actionVerb = (action: ApprovalRuleAction): string => {
  switch (action) {
    case 'agree': {
      return '同意';
    }
    case 'refuse': {
      return '拒绝';
    }
    case 'redirect': {
      return '转交';
    }
    case 'comment': {
      return '评论';
    }
    default: {
      return action;
    }
  }
};

const errorCodeOf = (error: unknown): string => {
  if (error instanceof DingtalkWorkspaceError) return error.code;
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('DINGTALK_')) return code;
  }
  return 'DINGTALK_UNAVAILABLE';
};

const isRateLimited = (error: unknown): boolean => errorCodeOf(error) === 'DINGTALK_RATE_LIMITED';

const isSameShanghaiDay = (value: Date | string | null | undefined, day: string): boolean => {
  if (!value) return false;
  if (typeof value === 'string') return value.slice(0, 10) === day;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return shanghaiDate(value) === day;
  return false;
};

export interface ApprovalInstanceFormValue {
  componentType?: string;
  id?: string;
  name?: string;
  value?: string | null;
}

export interface ApprovalInstanceTask {
  status?: string;
  taskId: number | string;
  userId?: string;
}

export interface ApprovalInstanceOperationRecord {
  remark?: string;
  type?: string;
  userId?: string;
}

export interface ApprovalInstanceDetail {
  formComponentValues?: ApprovalInstanceFormValue[];
  operationRecords?: ApprovalInstanceOperationRecord[];
  originatorDeptId?: number | string | null;
  originatorDeptName?: string;
  originatorUserId?: string;
  status?: string;
  tasks?: ApprovalInstanceTask[];
  title?: string;
}

export interface ApprovalRuleCycleCounts {
  executed: number;
  expired: number;
  failed: number;
  skipped: number;
}

export interface ApprovalRuleCycleResult {
  counts: ApprovalRuleCycleCounts;
  dingtalkCalls: number;
  skippedReason?: 'automation_off' | 'feature_disabled' | 'in_flight';
}

export interface ApprovalRuleCycleDeps {
  addCommentAs?: typeof addCommentAs;
  bumpDailyCount?: typeof DingtalkApprovalRuleModel.bumpDailyCount;
  capabilities?: () => Promise<{
    approval: boolean;
    automationTier: ApprovalAutomationTier;
    calendar: boolean;
    todo: boolean;
  }>;
  collectOriginatorDeptIds?: (
    staffId: string,
    originatorDeptId?: string | null,
  ) => Promise<string[]>;
  deleteRun?: typeof DingtalkApprovalRuleModel.deleteRun;
  disable?: typeof DingtalkApprovalRuleModel.disable;
  executeTaskAs?: typeof executeTaskAs;
  getInstanceDetail?: typeof getInstanceDetail;
  getPendingTaskCount?: (staffId: string) => Promise<number>;
  listAllActiveRules?: typeof DingtalkApprovalRuleModel.listAllActiveRules;
  listExpiredEnabled?: (now: Date) => Promise<DingtalkApprovalRuleItem[]>;
  listRunningInstanceIds?: ListRunningInstanceIds;
  lookupOriginatorNames?: (staffIds: string[]) => Promise<Map<string, string>>;
  notifyUser?: typeof notifyUser;
  now?: Date;
  reclaimStaleRun?: typeof DingtalkApprovalRuleModel.reclaimStaleRun;
  recordRun?: typeof DingtalkApprovalRuleModel.recordRun;
  redirectTaskAs?: typeof redirectTaskAs;
  resolveVerifiedDingtalkIdentity?: typeof resolveVerifiedDingtalkIdentity;
  rollbackDailyCount?: typeof DingtalkApprovalRuleModel.rollbackDailyCount;
  transact?: <T>(fn: (tx: LobeChatDatabase | Transaction) => Promise<T>) => Promise<T>;
  tryRecordQuotaNotify?: typeof DingtalkApprovalRuleModel.tryRecordQuotaNotify;
  updateRun?: typeof DingtalkApprovalRuleModel.updateRun;
  writeAudit?: (input: {
    action: ApprovalRuleAction;
    processInstanceId: string;
    processName?: string;
    ruleId: string;
    ruleName?: string;
    taskId: string;
    title?: string;
    userId: string;
  }) => Promise<void>;
}

const emptyCounts = (): ApprovalRuleCycleCounts => ({
  executed: 0,
  expired: 0,
  failed: 0,
  skipped: 0,
});

const toFormValues = (detail: ApprovalInstanceDetail): ApprovalMatchFormValue[] =>
  (detail.formComponentValues ?? []).map((item) => ({
    componentId: item.id,
    componentType: item.componentType,
    label: item.name,
    value: item.value,
  }));

const walkAncestorDeptIds = async (
  directory: DingTalkDirectoryModel,
  seed: string,
): Promise<string[]> => {
  const ids: string[] = [];
  const seen = new Set<string>();
  let current: string | null = seed;
  for (let depth = 0; depth < ANCESTOR_WALK_LIMIT && current; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    ids.push(current);
    const department = await directory.getDepartment(current);
    current = department?.parentId ?? null;
  }
  return ids;
};

export const collectOriginatorDeptIds = async (
  db: LobeChatDatabase,
  staffId: string,
  originatorDeptId?: string | null,
): Promise<string[]> => {
  const directory = new DingTalkDirectoryModel(db);
  const memberships = await db
    .select({ deptId: dingtalkUserDepartments.deptId })
    .from(dingtalkUserDepartments)
    .where(eq(dingtalkUserDepartments.staffId, staffId));
  const seeds = new Set<string>();
  for (const row of memberships) {
    if (row.deptId) seeds.add(String(row.deptId));
  }
  if (originatorDeptId) seeds.add(String(originatorDeptId));

  const ids = new Set<string>();
  for (const seed of seeds) {
    for (const deptId of await walkAncestorDeptIds(directory, seed)) ids.add(deptId);
  }
  return [...ids];
};

const listExpiredEnabledRules = async (
  db: LobeChatDatabase,
  now: Date,
): Promise<DingtalkApprovalRuleItem[]> =>
  db
    .select()
    .from(approvalRulesTable)
    .where(
      and(
        eq(approvalRulesTable.enabled, true),
        isNotNull(approvalRulesTable.expiresAt),
        lte(approvalRulesTable.expiresAt, now),
      ),
    );

/** Shanghai midnight of the next calendar day (UTC+8, no DST). */
const shanghaiDayEndMs = (day: string): number => {
  const ms = Date.parse(`${day}T16:00:00.000Z`);
  return Number.isFinite(ms) ? ms : Number.NaN;
};

const logCycle = (result: ApprovalRuleCycleResult): ApprovalRuleCycleResult => {
  log('cycle %O', {
    dingtalkCalls: result.dingtalkCalls,
    executed: result.counts.executed,
    expired: result.counts.expired,
    failed: result.counts.failed,
    skipped: result.counts.skipped,
    skippedReason: result.skippedReason,
  });
  return result;
};

const emptyResult = (
  skippedReason?: ApprovalRuleCycleResult['skippedReason'],
  dingtalkCalls = 0,
  counts: ApprovalRuleCycleCounts = emptyCounts(),
): ApprovalRuleCycleResult =>
  logCycle({
    counts,
    dingtalkCalls,
    ...(skippedReason ? { skippedReason } : {}),
  });

const notifyBestEffort = async (
  send: typeof notifyUser,
  staffId: string,
  payload: { lines: string[]; title: string },
): Promise<void> => {
  try {
    await send(staffId, payload);
  } catch (error) {
    console.error('[dingtalk-approval-rules] notify failed', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
  }
};

const lookupOriginatorNames = async (
  db: LobeChatDatabase,
  staffIds: string[],
): Promise<Map<string, string>> => {
  const unique = [...new Set(staffIds.filter(Boolean))];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  const directory = new DingTalkDirectoryModel(db);
  const users = await directory.getUsers(unique);
  for (const user of users) {
    if (user.staffId && user.name) names.set(user.staffId, user.name);
  }
  return names;
};

const takeProcessCodes = (codes: string[]): string[] => {
  const sorted = [...codes].sort((left, right) => left.localeCompare(right));
  if (sorted.length <= APPROVAL_RULE_PROCESS_CODE_CAP) return sorted;
  const start = processCodeOffset % sorted.length;
  processCodeOffset = (start + APPROVAL_RULE_PROCESS_CODE_CAP) % sorted.length;
  return [...sorted.slice(start), ...sorted.slice(0, start)].slice(
    0,
    APPROVAL_RULE_PROCESS_CODE_CAP,
  );
};

export const runApprovalRulesCycle = async (
  db: LobeChatDatabase,
  deps: ApprovalRuleCycleDeps = {},
): Promise<ApprovalRuleCycleResult> => {
  const now = deps.now ?? new Date();
  const nowMs = now.getTime();
  const counts = emptyCounts();
  const capabilities = await (deps.capabilities ?? getDingtalkWorkspaceCapabilities)();
  if (!capabilities.approval) return emptyResult('feature_disabled');
  if (capabilities.automationTier === 'off') return emptyResult('automation_off');

  const limits = APPROVAL_AUTOMATION_TIERS[capabilities.automationTier];
  const cap = limits.perRuleDailyCap;
  const today = shanghaiDate(now);

  const disable = deps.disable ?? DingtalkApprovalRuleModel.disable;
  const notify = deps.notifyUser ?? notifyUser;
  const recordRun = deps.recordRun ?? DingtalkApprovalRuleModel.recordRun;
  const reclaimStaleRun = deps.reclaimStaleRun ?? DingtalkApprovalRuleModel.reclaimStaleRun;
  const tryRecordQuotaNotify =
    deps.tryRecordQuotaNotify ?? DingtalkApprovalRuleModel.tryRecordQuotaNotify;
  const updateRun = deps.updateRun ?? DingtalkApprovalRuleModel.updateRun;
  const deleteRun = deps.deleteRun ?? DingtalkApprovalRuleModel.deleteRun;
  const bumpDailyCount = deps.bumpDailyCount ?? DingtalkApprovalRuleModel.bumpDailyCount;
  const rollbackDailyCount =
    deps.rollbackDailyCount ?? DingtalkApprovalRuleModel.rollbackDailyCount;
  const resolveIdentity = deps.resolveVerifiedDingtalkIdentity ?? resolveVerifiedDingtalkIdentity;
  const listExpired =
    deps.listExpiredEnabled ?? ((stamp: Date) => listExpiredEnabledRules(db, stamp));
  const listActive = deps.listAllActiveRules ?? DingtalkApprovalRuleModel.listAllActiveRules;
  const listIds: ListRunningInstanceIds = (deps.listRunningInstanceIds ??
    listRunningInstanceIds) as ListRunningInstanceIds;
  const loadDetail = deps.getInstanceDetail ?? getInstanceDetail;
  const getPendingCount = deps.getPendingTaskCount ?? getPendingApprovalTaskCount;
  const execute = deps.executeTaskAs ?? executeTaskAs;
  const redirect = deps.redirectTaskAs ?? redirectTaskAs;
  const comment = deps.addCommentAs ?? addCommentAs;
  let dingtalkCalls = 0;
  const callDingTalk = async <T>(fn: () => Promise<T>): Promise<T> => {
    dingtalkCalls += 1;
    return fn();
  };
  const lookupNames =
    deps.lookupOriginatorNames ?? ((staffIds: string[]) => lookupOriginatorNames(db, staffIds));
  const transact =
    deps.transact ??
    (async <T>(fn: (tx: LobeChatDatabase | Transaction) => Promise<T>) =>
      db.transaction(async (tx) => fn(tx)));
  const collectDepts =
    deps.collectOriginatorDeptIds ??
    ((staffId: string, originatorDeptId?: string | null) =>
      collectOriginatorDeptIds(db, staffId, originatorDeptId));
  const writeAudit =
    deps.writeAudit ??
    (async (input) => {
      await new PlatformAuditService(db).append({
        action: AUDIT_ACTION.DINGTALK_APPROVAL_RULE_EXECUTED,
        actorUserId: input.userId,
        afterDiff: {
          action: input.action,
          processInstanceId: input.processInstanceId,
          processName: input.processName ?? null,
          ruleId: input.ruleId,
          ruleName: input.ruleName ?? null,
          taskId: input.taskId,
          title: input.title ?? null,
        },
        result: 'success',
        targetId: input.processInstanceId,
        targetType: AUDIT_TARGET_TYPE.DINGTALK_APPROVAL,
      });
    });

  const expired = await listExpired(now);
  for (const rule of expired) {
    await disable(db, rule.id, 'expired');
    counts.expired += 1;
    await notifyBestEffort(notify, rule.staffId, {
      lines: [`规则「${rule.name}」已过期并已停用。`],
      title: '自动审批规则已过期',
    });
  }

  const active = await listActive(db);
  if (active.length === 0) return emptyResult(undefined, 0, counts);

  const byOwner = new Map<string, DingtalkApprovalRuleItem[]>();
  for (const rule of active) {
    if (ruleExceedsTierMaxExpiry(rule.expiresAt, limits.maxExpiryDays, now)) continue;
    const list = byOwner.get(rule.staffId) ?? [];
    list.push(rule);
    byOwner.set(rule.staffId, list);
  }
  if (byOwner.size === 0) return emptyResult(undefined, 0, counts);

  const sinceMs = nowMs - APPROVAL_RULE_LOOKBACK_MS;
  const detailCache = new Map<string, ApprovalInstanceDetail>();
  const instanceIdsCache = new Map<string, string[]>();
  const deptCache = new Map<string, string[]>();
  let abortCycle = false;

  const releaseClaim = async (rule: DingtalkApprovalRuleItem, taskId: string): Promise<void> => {
    const nextCount = await transact(async (tx) => {
      await deleteRun(tx, { ruleId: rule.id, taskId });
      return rollbackDailyCount(tx, rule.id, today);
    });
    rule.dailyCount = nextCount;
    rule.dailyCountDate = today;
  };

  const commentAlreadyPosted = (
    detail: ApprovalInstanceDetail,
    staffId: string,
    text: string,
  ): boolean =>
    (detail.operationRecords ?? []).some(
      (record) =>
        record.type === 'ADD_REMARK' && record.userId === staffId && record.remark === text,
    );

  const notifyQuotaOnce = async (rule: DingtalkApprovalRuleItem, title: string): Promise<void> => {
    const marked = await tryRecordQuotaNotify(db, {
      action: rule.action,
      date: today,
      ruleId: rule.id,
      userId: rule.userId,
    });
    if (!marked) return;
    await notifyBestEffort(notify, rule.staffId, {
      lines: [`规则「${rule.name}」今日自动处理已达上限，已跳过「${title}」。`],
      title: '自动审批已达每日上限',
    });
  };

  const loadDetailCounted = async (instanceId: string): Promise<ApprovalInstanceDetail> => {
    const loaded = (await callDingTalk(() => loadDetail(instanceId))) as ApprovalInstanceDetail;
    detailCache.set(instanceId, loaded);
    return loaded;
  };

  const listIdsCounted = async (processCode: string): Promise<string[]> => {
    const cached = instanceIdsCache.get(processCode);
    if (cached) return cached;
    let ids = await callDingTalk(() => listIds(processCode, sinceMs, APPROVAL_RULE_INSTANCE_CAP));
    if (ids.length > APPROVAL_RULE_INSTANCE_CAP) ids = ids.slice(0, APPROVAL_RULE_INSTANCE_CAP);
    instanceIdsCache.set(processCode, ids);
    return ids;
  };

  const ownerIds = [...byOwner.keys()].sort((left, right) => left.localeCompare(right));

  for (const ownerStaffId of ownerIds) {
    if (abortCycle) break;
    const ownerRules = byOwner.get(ownerStaffId);
    if (!ownerRules || ownerRules.length === 0) continue;

    let pendingCount: number;
    try {
      pendingCount = await callDingTalk(() => getPendingCount(ownerStaffId));
    } catch (error) {
      console.error('[dingtalk-approval-rules] pending count failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
      if (isRateLimited(error)) break;
      continue;
    }
    if (pendingCount <= 0) continue;

    if (
      cap !== null &&
      ownerRules.every(
        (item) => isSameShanghaiDay(item.dailyCountDate, today) && item.dailyCount >= cap,
      )
    ) {
      continue;
    }

    const fingerprint = fingerprintEnabledApprovalRules(ownerRules);
    const memory = syncOwnerTaskMemory(ownerStaffId, fingerprint, nowMs);
    if (
      pendingCount <= memory.rememberedCount &&
      nowMs - memory.lastReverifyAtMs < APPROVAL_RULE_REVERIFY_MS
    ) {
      continue;
    }

    markOwnerScanStarted(ownerStaffId, fingerprint, nowMs);

    const evaluatedExpiry = nowMs + APPROVAL_RULE_EVALUATED_TTL_MS;
    const quotaExpiryMs = shanghaiDayEndMs(today);
    const quotaExpiry =
      Number.isFinite(quotaExpiryMs) && quotaExpiryMs > nowMs ? quotaExpiryMs : evaluatedExpiry;

    const selectedCodes = takeProcessCodes([
      ...new Set(ownerRules.map((rule) => rule.processCode)),
    ]);
    let ownerRunningFound = 0;

    ownerScan: for (const processCode of selectedCodes) {
      if (abortCycle || ownerRunningFound >= pendingCount) break;

      const rules = ownerRules
        .filter((rule) => rule.processCode === processCode)
        .sort((left, right) => {
          const byTime = left.createdAt.getTime() - right.createdAt.getTime();
          return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
        });
      if (rules.length === 0) continue;

      let instanceIds: string[];
      try {
        instanceIds = await listIdsCounted(processCode);
      } catch (error) {
        console.error('[dingtalk-approval-rules] list instances failed', {
          errorClass: error instanceof Error ? error.name : 'UnknownError',
        });
        if (isRateLimited(error)) {
          abortCycle = true;
          break;
        }
        continue;
      }

      for (const instanceId of instanceIds) {
        if (abortCycle || ownerRunningFound >= pendingCount) break ownerScan;

        let detail = detailCache.get(instanceId);
        if (!detail) {
          try {
            detail = await loadDetailCounted(instanceId);
          } catch (error) {
            console.error('[dingtalk-approval-rules] instance detail failed', {
              errorClass: error instanceof Error ? error.name : 'UnknownError',
            });
            if (isRateLimited(error)) {
              abortCycle = true;
              break ownerScan;
            }
            continue;
          }
        }
        if (detail.status && detail.status !== 'RUNNING') continue;

        const originatorStaffId = detail.originatorUserId ?? '';
        const originatorDeptId =
          detail.originatorDeptId === undefined || detail.originatorDeptId === null
            ? null
            : String(detail.originatorDeptId);
        const formValues = toFormValues(detail);
        const title = detail.title ?? '';

        const runningForOwner = (detail.tasks ?? []).filter(
          (task) => task.status === 'RUNNING' && task.userId === ownerStaffId,
        );
        ownerRunningFound += runningForOwner.length;
        if (runningForOwner.length === 0) continue;

        const originatorNames = await lookupNames(originatorStaffId ? [originatorStaffId] : []);
        const originatorName = originatorNames.get(originatorStaffId) ?? originatorStaffId;

        let originatorDeptIds = deptCache.get(originatorStaffId);
        if (!originatorDeptIds) {
          originatorDeptIds = await collectDepts(originatorStaffId, originatorDeptId);
          deptCache.set(originatorStaffId, originatorDeptIds);
        }

        for (const task of runningForOwner) {
          if (abortCycle) break ownerScan;
          const taskId = String(task.taskId);
          if (ownerTaskIsRemembered(ownerStaffId, taskId, nowMs, fingerprint)) continue;

          let matchedAny = false;
          let abortInstance = false;

          for (const rule of rules) {
            if (abortCycle || abortInstance) break;
            const matched = matchApprovalRule(rule.conditions, {
              formValues,
              originator: { deptIds: originatorDeptIds, staffId: originatorStaffId },
            });
            if (!matched) continue;
            matchedAny = true;

            const identity = await resolveIdentity(db, rule.userId);
            const identityStaffId = 'error' in identity ? null : identity.staffId;
            if (
              !identityStaffId ||
              identityStaffId !== rule.staffId ||
              identityStaffId !== ownerStaffId
            ) {
              await disable(db, rule.id, 'identity_invalid');
              await notifyBestEffort(notify, rule.staffId, {
                lines: [`规则「${rule.name}」已停用：钉钉身份已失效，请重新用钉钉登录。`],
                title: '自动审批规则已停用',
              });
              counts.skipped += 1;
              break;
            }

            if (
              cap !== null &&
              isSameShanghaiDay(rule.dailyCountDate, today) &&
              rule.dailyCount >= cap
            ) {
              rememberOwnerTask(ownerStaffId, taskId, quotaExpiry, fingerprint);
              await notifyQuotaOnce(rule, title);
              counts.skipped += 1;
              break;
            }

            const claim = await transact(async (tx) => {
              const inserted = await recordRun(tx, {
                action: rule.action,
                errorCode: RUN_CLAIM_IN_PROGRESS,
                instanceTitle: title,
                originatorName,
                processInstanceId: instanceId,
                ruleId: rule.id,
                status: 'failed',
                taskId,
                userId: rule.userId,
              });
              const via: 'inserted' | 'reclaimed' | false = inserted
                ? 'inserted'
                : (await reclaimStaleRun(tx, { now, ruleId: rule.id, taskId }))
                  ? 'reclaimed'
                  : false;
              if (!via) return { kind: 'busy' as const };

              if (via === 'inserted') {
                const reserved = await bumpDailyCount(
                  tx,
                  rule.id,
                  today,
                  cap === null ? undefined : { cap },
                );
                if (reserved === null) {
                  await deleteRun(tx, { ruleId: rule.id, taskId });
                  return { kind: 'over_cap' as const };
                }
                rule.dailyCount = reserved;
                rule.dailyCountDate = today;
              }
              return { kind: 'claimed' as const, via };
            });

            if (claim.kind === 'busy') {
              rememberOwnerTask(ownerStaffId, taskId, evaluatedExpiry, fingerprint);
              counts.skipped += 1;
              break;
            }
            if (claim.kind === 'over_cap') {
              if (cap !== null) {
                rule.dailyCount = cap;
                rule.dailyCountDate = today;
              }
              rememberOwnerTask(ownerStaffId, taskId, quotaExpiry, fingerprint);
              await notifyQuotaOnce(rule, title);
              counts.skipped += 1;
              break;
            }

            try {
              let fresh: ApprovalInstanceDetail;
              try {
                fresh = await loadDetailCounted(instanceId);
              } catch (error) {
                if (isRateLimited(error) || errorCodeOf(error) === 'DINGTALK_UNAVAILABLE') {
                  await releaseClaim(rule, taskId);
                  if (isRateLimited(error)) abortCycle = true;
                  abortInstance = true;
                  break;
                }
                throw error;
              }

              const stillOwned = (fresh.tasks ?? []).some(
                (item) =>
                  item.status === 'RUNNING' &&
                  item.userId === identityStaffId &&
                  String(item.taskId) === taskId,
              );
              if (!stillOwned) {
                await releaseClaim(rule, taskId);
                counts.skipped += 1;
                break;
              }

              const commentText = rule.remark || rule.name;
              const skipCommentRepost =
                claim.via === 'reclaimed' &&
                rule.action === 'comment' &&
                commentAlreadyPosted(fresh, identityStaffId, commentText);

              if (!skipCommentRepost) {
                if (rule.action === 'agree' || rule.action === 'refuse') {
                  const result = rule.action;
                  await callDingTalk(() =>
                    execute(identityStaffId, {
                      processInstanceId: instanceId,
                      remark: rule.remark ?? undefined,
                      result,
                      taskId: task.taskId,
                    }),
                  );
                } else if (rule.action === 'redirect') {
                  const toUserId = rule.redirectToStaffId;
                  if (!toUserId) throw new DingtalkWorkspaceError('DINGTALK_INVALID');
                  await callDingTalk(() =>
                    redirect(identityStaffId, {
                      remark: rule.remark ?? undefined,
                      taskId: task.taskId,
                      toUserId,
                    }),
                  );
                } else {
                  await callDingTalk(() =>
                    comment(identityStaffId, {
                      processInstanceId: instanceId,
                      text: commentText,
                    }),
                  );
                }
              }
            } catch (error) {
              const code = errorCodeOf(error);
              if (!TERMINAL_EXECUTE_CODES.has(code)) {
                await releaseClaim(rule, taskId);
                if (isRateLimited(error)) abortCycle = true;
                if (isRateLimited(error) || code === 'DINGTALK_UNAVAILABLE') {
                  console.error('[dingtalk-approval-rules] execute failed', {
                    errorClass: error instanceof Error ? error.name : 'UnknownError',
                  });
                  abortInstance = true;
                  break;
                }
                counts.failed += 1;
                console.error('[dingtalk-approval-rules] execute failed', {
                  errorClass: error instanceof Error ? error.name : 'UnknownError',
                });
                break;
              }
              const finalized = await updateRun(db, {
                errorCode: code,
                ruleId: rule.id,
                status: 'failed',
                taskId,
              });
              if (finalized) {
                rule.dailyCount = await rollbackDailyCount(db, rule.id, today);
                rule.dailyCountDate = today;
              }
              counts.failed += 1;
              console.error('[dingtalk-approval-rules] execute failed', {
                errorClass: error instanceof Error ? error.name : 'UnknownError',
              });
              break;
            }

            invalidatePendingCaches(rule.userId);

            const finalized = await updateRun(db, {
              errorCode: null,
              ruleId: rule.id,
              status: 'succeeded',
              taskId,
            });
            if (!finalized) {
              if (rule.action === 'comment') {
                rememberOwnerTask(ownerStaffId, taskId, evaluatedExpiry, fingerprint);
              }
              counts.skipped += 1;
              break;
            }
            try {
              await writeAudit({
                action: rule.action,
                processInstanceId: instanceId,
                processName: rule.processName,
                ruleId: rule.id,
                ruleName: rule.name,
                taskId,
                title,
                userId: rule.userId,
              });
            } catch (error) {
              console.error('[dingtalk-approval-rules] audit failed', {
                errorClass: error instanceof Error ? error.name : 'UnknownError',
              });
            }
            await notifyBestEffort(notify, rule.staffId, {
              lines: [`已按规则「${rule.name}」自动${actionVerb(rule.action)}：${title}`],
              title: '自动审批已执行',
            });
            counts.executed += 1;
            if (rule.action === 'comment') {
              rememberOwnerTask(ownerStaffId, taskId, evaluatedExpiry, fingerprint);
            }
            break;
          }

          if (!matchedAny) {
            rememberOwnerTask(ownerStaffId, taskId, evaluatedExpiry, fingerprint);
          }
          if (abortCycle) break ownerScan;
          if (abortInstance) break;
        }
      }
    }
  }

  return emptyResult(undefined, dingtalkCalls, counts);
};

let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let inflight: Promise<ApprovalRuleCycleResult> | null = null;

export const isApprovalRuleWorkerStarted = (): boolean => started;

const unrefTimer = (handle: ReturnType<typeof setTimeout>): void => {
  if (typeof handle === 'object' && handle !== null && 'unref' in handle) {
    const unref = Reflect.get(handle, 'unref');
    if (typeof unref === 'function') unref.call(handle);
  }
};

const tick = (deps: ApprovalRuleCycleDeps = {}): void => {
  if (!started) return;
  if (inflight) return;
  inflight = (async () => {
    markWorkerTick('approval_worker', APPROVAL_RULE_SWEEP_INTERVAL_MS);
    const db = await getServerDB();
    return runApprovalRulesCycle(db, deps);
  })()
    .catch((error) => {
      console.error('[dingtalk-approval-rules] sweep failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
      markWorkerFailed('approval_worker', error);
      void recordRuntimeError('approval_worker', error);
      return emptyResult();
    })
    .finally(() => {
      inflight = null;
    });
};

const scheduleNext = (deps: ApprovalRuleCycleDeps): void => {
  if (!started) return;
  timer = setTimeout(() => {
    tick(deps);
    scheduleNext(deps);
  }, nextApprovalRuleSweepDelayMs());
  unrefTimer(timer);
};

export const ensureDingtalkApprovalRuleWorkerStarted = (deps: ApprovalRuleCycleDeps = {}): void => {
  if (started) return;
  if (!isApprovalRuleWorkerRuntime()) return;
  started = true;
  markWorkerStarted('approval_worker', APPROVAL_RULE_SWEEP_INTERVAL_MS);
  tick(deps);
  scheduleNext(deps);
};

export const stopDingtalkApprovalRuleWorker = (): void => {
  started = false;
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
};

export const stopDingtalkApprovalRuleWorkerForTest = (): void => {
  stopDingtalkApprovalRuleWorker();
  inflight = null;
  processCodeOffset = 0;
  resetApprovalRuleWorkerMemoryForTest();
};

/** Test helper: run one cycle while holding the in-process single-flight latch. */
export const runApprovalRulesCycleSingleFlight = async (
  db: LobeChatDatabase,
  deps: ApprovalRuleCycleDeps = {},
): Promise<ApprovalRuleCycleResult> => {
  if (inflight) return emptyResult('in_flight');
  inflight = runApprovalRulesCycle(db, deps).finally(() => {
    inflight = null;
  });
  return inflight;
};
