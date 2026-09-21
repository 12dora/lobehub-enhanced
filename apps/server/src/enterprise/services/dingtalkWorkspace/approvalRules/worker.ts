import type { ApprovalAutomationTier, ApprovalRuleAction } from '@lobechat/types';
import { APPROVAL_AUTOMATION_TIERS } from '@lobechat/types';
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

import { AUDIT_ACTION } from '../../audit/auditActionCatalog';
import { PlatformAuditService } from '../../platformAudit';
import {
  addCommentAs,
  executeTaskAs,
  getInstanceDetail,
  listRunningInstanceIds,
  redirectTaskAs,
} from '../approval/api';
import { getDingtalkWorkspaceCapabilities } from '../capabilities';
import { DingtalkWorkspaceError } from '../errors';
import { resolveVerifiedDingtalkIdentity } from '../identity';
import { notifyUser } from '../notify';
import { type ApprovalMatchFormValue, matchApprovalRule } from './match';
import { ruleExceedsTierMaxExpiry } from './tier';

export const APPROVAL_RULE_SWEEP_INTERVAL_MS = 120_000;
export const APPROVAL_RULE_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
export const APPROVAL_RULE_INSTANCE_CAP = 300;
export const APPROVAL_RULE_DETAIL_CONCURRENCY = 5;
export const APPROVAL_RULE_PROCESS_CODE_CAP = 50;

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
    ruleId: string;
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

const mapPool = async <T>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<void>,
): Promise<void> => {
  if (items.length === 0) return;
  let cursor = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        const item = items[index];
        if (item === undefined) continue;
        await mapper(item);
      }
    }),
  );
};

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
  const counts = emptyCounts();
  const capabilities = await (deps.capabilities ?? getDingtalkWorkspaceCapabilities)();
  if (!capabilities.approval) return { counts, skippedReason: 'feature_disabled' };
  if (capabilities.automationTier === 'off') return { counts, skippedReason: 'automation_off' };

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
  const execute = deps.executeTaskAs ?? executeTaskAs;
  const redirect = deps.redirectTaskAs ?? redirectTaskAs;
  const comment = deps.addCommentAs ?? addCommentAs;
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
          ruleId: input.ruleId,
          taskId: input.taskId,
          title: input.title ?? null,
        },
        result: 'success',
        targetId: input.processInstanceId,
        targetType: 'user',
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
  if (active.length === 0) return { counts };

  const byProcess = new Map<string, DingtalkApprovalRuleItem[]>();
  for (const rule of active) {
    if (ruleExceedsTierMaxExpiry(rule.expiresAt, limits.maxExpiryDays, now)) continue;
    const list = byProcess.get(rule.processCode) ?? [];
    list.push(rule);
    byProcess.set(rule.processCode, list);
  }
  if (byProcess.size === 0) return { counts };

  const sinceMs = now.getTime() - APPROVAL_RULE_LOOKBACK_MS;
  const detailCache = new Map<string, ApprovalInstanceDetail>();
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

  const selectedCodes = takeProcessCodes([...byProcess.keys()]);

  for (const processCode of selectedCodes) {
    if (abortCycle) break;
    const rules = byProcess.get(processCode);
    if (!rules || rules.length === 0) continue;

    let instanceIds: string[];
    try {
      instanceIds = await listIds(processCode, sinceMs, APPROVAL_RULE_INSTANCE_CAP);
    } catch (error) {
      console.error('[dingtalk-approval-rules] list instances failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
      if (isRateLimited(error)) break;
      continue;
    }
    if (instanceIds.length > APPROVAL_RULE_INSTANCE_CAP) {
      instanceIds = instanceIds.slice(0, APPROVAL_RULE_INSTANCE_CAP);
    }

    await mapPool(instanceIds, APPROVAL_RULE_DETAIL_CONCURRENCY, async (instanceId) => {
      if (abortCycle || detailCache.has(instanceId)) return;
      try {
        const loaded = (await loadDetail(instanceId)) as ApprovalInstanceDetail;
        detailCache.set(instanceId, loaded);
      } catch (error) {
        console.error('[dingtalk-approval-rules] instance detail failed', {
          errorClass: error instanceof Error ? error.name : 'UnknownError',
        });
        if (isRateLimited(error)) abortCycle = true;
      }
    });
    if (abortCycle) break;

    const runningDetails: Array<{ detail: ApprovalInstanceDetail; instanceId: string }> = [];
    for (const instanceId of instanceIds) {
      const detail = detailCache.get(instanceId);
      if (!detail || (detail.status && detail.status !== 'RUNNING')) continue;
      runningDetails.push({ detail, instanceId });
    }

    const originatorNames = await lookupNames(
      runningDetails
        .map(({ detail }) => detail.originatorUserId)
        .filter((id): id is string => Boolean(id)),
    );

    await mapPool(
      runningDetails,
      APPROVAL_RULE_DETAIL_CONCURRENCY,
      async ({ detail, instanceId }) => {
        if (abortCycle) return;

        const originatorStaffId = detail.originatorUserId ?? '';
        const originatorDeptId =
          detail.originatorDeptId === undefined || detail.originatorDeptId === null
            ? null
            : String(detail.originatorDeptId);
        const originatorName = originatorNames.get(originatorStaffId) ?? originatorStaffId;
        const formValues = toFormValues(detail);
        const title = detail.title ?? '';

        const runningTasks = (detail.tasks ?? []).filter(
          (task) => task.status === 'RUNNING' && task.userId,
        );

        for (const task of runningTasks) {
          if (abortCycle) return;
          const handlerStaffId = task.userId;
          if (!handlerStaffId) continue;
          const ownerRules = rules
            .filter((rule) => rule.staffId === handlerStaffId)
            .sort((left, right) => {
              const byTime = left.createdAt.getTime() - right.createdAt.getTime();
              return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
            });
          if (ownerRules.length === 0) continue;

          let originatorDeptIds = deptCache.get(originatorStaffId);
          if (!originatorDeptIds) {
            originatorDeptIds = await collectDepts(originatorStaffId, originatorDeptId);
            deptCache.set(originatorStaffId, originatorDeptIds);
          }

          for (const rule of ownerRules) {
            if (abortCycle) return;
            const matched = matchApprovalRule(rule.conditions, {
              formValues,
              originator: { deptIds: originatorDeptIds, staffId: originatorStaffId },
            });
            if (!matched) continue;

            const identity = await resolveIdentity(db, rule.userId);
            const identityStaffId = 'error' in identity ? null : identity.staffId;
            if (
              !identityStaffId ||
              identityStaffId !== rule.staffId ||
              identityStaffId !== handlerStaffId
            ) {
              await disable(db, rule.id, 'identity_invalid');
              await notifyBestEffort(notify, rule.staffId, {
                lines: [`规则「${rule.name}」已停用：钉钉身份已失效，请重新用钉钉登录。`],
                title: '自动审批规则已停用',
              });
              counts.skipped += 1;
              break;
            }

            const taskId = String(task.taskId);

            if (
              cap !== null &&
              isSameShanghaiDay(rule.dailyCountDate, today) &&
              rule.dailyCount >= cap
            ) {
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
              counts.skipped += 1;
              break;
            }
            if (claim.kind === 'over_cap') {
              if (cap !== null) {
                rule.dailyCount = cap;
                rule.dailyCountDate = today;
              }
              await notifyQuotaOnce(rule, title);
              counts.skipped += 1;
              break;
            }

            try {
              let fresh: ApprovalInstanceDetail;
              try {
                fresh = (await loadDetail(instanceId)) as ApprovalInstanceDetail;
                detailCache.set(instanceId, fresh);
              } catch (error) {
                if (isRateLimited(error) || errorCodeOf(error) === 'DINGTALK_UNAVAILABLE') {
                  await releaseClaim(rule, taskId);
                  if (isRateLimited(error)) abortCycle = true;
                  return;
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
                  await execute(identityStaffId, {
                    processInstanceId: instanceId,
                    remark: rule.remark ?? undefined,
                    result: rule.action,
                    taskId: task.taskId,
                  });
                } else if (rule.action === 'redirect') {
                  if (!rule.redirectToStaffId) throw new DingtalkWorkspaceError('DINGTALK_INVALID');
                  await redirect(identityStaffId, {
                    remark: rule.remark ?? undefined,
                    taskId: task.taskId,
                    toUserId: rule.redirectToStaffId,
                  });
                } else {
                  await comment(identityStaffId, {
                    processInstanceId: instanceId,
                    text: commentText,
                  });
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
                  return;
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

            const finalized = await updateRun(db, {
              errorCode: null,
              ruleId: rule.id,
              status: 'succeeded',
              taskId,
            });
            if (!finalized) {
              counts.skipped += 1;
              break;
            }
            try {
              await writeAudit({
                action: rule.action,
                processInstanceId: instanceId,
                ruleId: rule.id,
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
            break;
          }
        }
      },
    );
  }

  return { counts };
};

let started = false;
let timer: ReturnType<typeof setInterval> | undefined;
let inflight: Promise<ApprovalRuleCycleResult> | null = null;

export const isApprovalRuleWorkerStarted = (): boolean => started;

const tick = (deps: ApprovalRuleCycleDeps = {}): void => {
  if (!started) return;
  if (inflight) return;
  inflight = (async () => {
    const db = await getServerDB();
    return runApprovalRulesCycle(db, deps);
  })()
    .catch((error) => {
      console.error('[dingtalk-approval-rules] sweep failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
      return { counts: emptyCounts() } satisfies ApprovalRuleCycleResult;
    })
    .finally(() => {
      inflight = null;
    });
};

export const ensureDingtalkApprovalRuleWorkerStarted = (deps: ApprovalRuleCycleDeps = {}): void => {
  if (started) return;
  if (!isApprovalRuleWorkerRuntime()) return;
  started = true;
  tick(deps);
  timer = setInterval(() => tick(deps), APPROVAL_RULE_SWEEP_INTERVAL_MS);
  timer.unref();
};

export const stopDingtalkApprovalRuleWorker = (): void => {
  started = false;
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
};

export const stopDingtalkApprovalRuleWorkerForTest = (): void => {
  stopDingtalkApprovalRuleWorker();
  inflight = null;
  processCodeOffset = 0;
};

/** Test helper: run one cycle while holding the in-process single-flight latch. */
export const runApprovalRulesCycleSingleFlight = async (
  db: LobeChatDatabase,
  deps: ApprovalRuleCycleDeps = {},
): Promise<ApprovalRuleCycleResult> => {
  if (inflight) return { counts: emptyCounts(), skippedReason: 'in_flight' };
  inflight = runApprovalRulesCycle(db, deps).finally(() => {
    inflight = null;
  });
  return inflight;
};
