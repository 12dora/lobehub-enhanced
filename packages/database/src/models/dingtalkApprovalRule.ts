import type {
  ApprovalRuleAction,
  ApprovalRuleConditions,
  ApprovalRuleDisabledReason,
  ApprovalRuleRunStatus,
} from '@lobechat/types';
import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  isNull,
  like,
  lt,
  not,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

import type {
  DingtalkApprovalRuleItem,
  DingtalkApprovalRuleRunItem,
  NewDingtalkApprovalRule,
} from '../schemas/dingtalkApprovalRule';
import { dingtalkApprovalRuleRuns, dingtalkApprovalRules } from '../schemas/dingtalkApprovalRule';
import { users } from '../schemas/user';
import type { LobeChatDatabase, Transaction } from '../type';
import { idGenerator } from '../utils/idGenerator';

type ApprovalRuleDb = LobeChatDatabase | Transaction;

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const DEFAULT_ADMIN_PAGE_SIZE = 20;
const MAX_ADMIN_PAGE_SIZE = 100;

/**
 * In-progress claim marker stored on `dingtalk_approval_rule_runs`.
 *
 * The run table has no dedicated in-progress status (and we cannot add one
 * without a migration), so a claim is inserted as `status='failed'` with
 * `error_code='IN_PROGRESS'`. That is **not** a terminal failure: the worker
 * treats it as a lease. A row older than {@link RUN_CLAIM_STALE_MS} that is
 * still `IN_PROGRESS` is reclaimable so a crash between claim and execute is
 * retried. Terminal outcomes overwrite the marker; transients delete the row.
 */
export const RUN_CLAIM_IN_PROGRESS = 'IN_PROGRESS';
export const RUN_CLAIM_STALE_MS = 10 * 60 * 1000;

/** Synthetic task_id used to notify over-cap once per Shanghai day. */
export const QUOTA_NOTIFY_TASK_PREFIX = '__quota_notify__:';

export const quotaNotifyTaskId = (date: string): string => `${QUOTA_NOTIFY_TASK_PREFIX}${date}`;

/**
 * Thrown when an owner `enabled: true` write matches zero rows because a
 * concurrent admin/identity/tier stop or expiry won the CAS.
 */
export class DingtalkApprovalRuleEnableBlockedError extends Error {
  readonly blocked: 'expired' | 'forbidden';

  constructor(blocked: 'expired' | 'forbidden') {
    super('Approval rule cannot be enabled');
    this.name = 'DingtalkApprovalRuleEnableBlockedError';
    this.blocked = blocked;
  }
}

const isExpiresAtPast = (expiresAt: Date | string | null | undefined, now: Date): boolean => {
  if (!expiresAt) return false;
  const at = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return true;
  return at.getTime() <= now.getTime();
};

const ownerEnableCondition = (id: string, userId: string, now: Date) =>
  and(
    eq(dingtalkApprovalRules.id, id),
    eq(dingtalkApprovalRules.userId, userId),
    or(
      isNull(dingtalkApprovalRules.disabledReason),
      eq(dingtalkApprovalRules.disabledReason, 'user'),
    ),
    or(isNull(dingtalkApprovalRules.expiresAt), gt(dingtalkApprovalRules.expiresAt, now)),
  );

const clampLimit = (limit: number | undefined, fallback: number, max = MAX_LIST_LIMIT): number => {
  if (limit === undefined) return fallback;
  return Math.min(Math.max(limit, 1), max);
};

const activeCondition = () =>
  and(
    eq(dingtalkApprovalRules.enabled, true),
    or(isNull(dingtalkApprovalRules.expiresAt), gt(dingtalkApprovalRules.expiresAt, new Date())),
  );

export interface DingtalkApprovalRuleCreateInput {
  action: ApprovalRuleAction;
  conditions: ApprovalRuleConditions;
  createdByTopicId?: string | null;
  expiresAt?: Date | null;
  name: string;
  processCode: string;
  processName: string;
  redirectToName?: string | null;
  redirectToStaffId?: string | null;
  remark?: string | null;
  staffId: string;
}

export interface DingtalkApprovalRuleUpdatePatch {
  action?: ApprovalRuleAction;
  conditions?: ApprovalRuleConditions;
  disabledReason?: ApprovalRuleDisabledReason | null;
  enabled?: boolean;
  expiresAt?: Date | null;
  name?: string;
  processCode?: string;
  processName?: string;
  redirectToName?: string | null;
  redirectToStaffId?: string | null;
  remark?: string | null;
}

export interface DingtalkApprovalRuleRunInput {
  action: ApprovalRuleAction;
  errorCode?: string | null;
  instanceTitle?: string | null;
  originatorName?: string | null;
  processInstanceId: string;
  ruleId: string;
  status: ApprovalRuleRunStatus;
  taskId: string;
  userId: string;
}

export interface DingtalkApprovalRuleAdminListItem extends DingtalkApprovalRuleItem {
  userDisplayName: string | null;
  userEmail: string | null;
}

export interface DingtalkApprovalRuleAdminListResult {
  items: DingtalkApprovalRuleAdminListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export class DingtalkApprovalRuleModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  create = async (input: DingtalkApprovalRuleCreateInput): Promise<DingtalkApprovalRuleItem> => {
    const [row] = await this.db
      .insert(dingtalkApprovalRules)
      .values({
        action: input.action,
        conditions: input.conditions,
        createdByTopicId: input.createdByTopicId ?? null,
        expiresAt: input.expiresAt ?? null,
        id: idGenerator('dingtalkApprovalRules'),
        name: input.name,
        processCode: input.processCode,
        processName: input.processName,
        redirectToName: input.redirectToName ?? null,
        redirectToStaffId: input.redirectToStaffId ?? null,
        remark: input.remark ?? null,
        staffId: input.staffId,
        userId: this.userId,
      })
      .returning();

    return row;
  };

  update = async (
    id: string,
    patch: DingtalkApprovalRuleUpdatePatch,
  ): Promise<DingtalkApprovalRuleItem> => {
    const next: Partial<NewDingtalkApprovalRule> = { ...patch };

    if (patch.enabled === false && patch.disabledReason === undefined) {
      next.disabledReason = 'user';
    }
    if (patch.enabled === true && patch.disabledReason === undefined) {
      next.disabledReason = null;
    }

    const enabling = patch.enabled === true;
    const now = new Date();
    const where = enabling
      ? ownerEnableCondition(id, this.userId, now)
      : and(eq(dingtalkApprovalRules.id, id), eq(dingtalkApprovalRules.userId, this.userId));

    const [row] = Object.keys(next).length
      ? await this.db.update(dingtalkApprovalRules).set(next).where(where).returning()
      : await this.db.select().from(dingtalkApprovalRules).where(where).limit(1);

    if (!row) {
      if (enabling) {
        const existing = await this.findById(id);
        if (!existing) {
          throw new Error(`Approval rule not found: ${id}`);
        }
        const expired =
          existing.disabledReason === 'expired' || isExpiresAtPast(existing.expiresAt, now);
        throw new DingtalkApprovalRuleEnableBlockedError(expired ? 'expired' : 'forbidden');
      }
      throw new Error(`Approval rule not found: ${id}`);
    }
    return row;
  };

  delete = async (id: string): Promise<boolean> => {
    const rows = await this.db
      .delete(dingtalkApprovalRules)
      .where(and(eq(dingtalkApprovalRules.id, id), eq(dingtalkApprovalRules.userId, this.userId)))
      .returning({ id: dingtalkApprovalRules.id });
    return rows.length > 0;
  };

  findById = async (id: string): Promise<DingtalkApprovalRuleItem | null> => {
    const [row] = await this.db
      .select()
      .from(dingtalkApprovalRules)
      .where(and(eq(dingtalkApprovalRules.id, id), eq(dingtalkApprovalRules.userId, this.userId)))
      .limit(1);
    return row ?? null;
  };

  list = async (opts?: { includeDisabled?: boolean }): Promise<DingtalkApprovalRuleItem[]> => {
    const conditions = [eq(dingtalkApprovalRules.userId, this.userId)];
    if (!opts?.includeDisabled) conditions.push(eq(dingtalkApprovalRules.enabled, true));

    return this.db
      .select()
      .from(dingtalkApprovalRules)
      .where(and(...conditions))
      .orderBy(desc(dingtalkApprovalRules.createdAt), desc(dingtalkApprovalRules.id));
  };

  listRuns = async (
    ruleId: string,
    opts?: { limit?: number },
  ): Promise<DingtalkApprovalRuleRunItem[]> => {
    const owned = await this.findById(ruleId);
    if (!owned) return [];

    const limit = clampLimit(opts?.limit, DEFAULT_LIST_LIMIT);
    return this.db
      .select()
      .from(dingtalkApprovalRuleRuns)
      .where(
        and(
          eq(dingtalkApprovalRuleRuns.ruleId, ruleId),
          not(like(dingtalkApprovalRuleRuns.taskId, `${QUOTA_NOTIFY_TASK_PREFIX}%`)),
        ),
      )
      .orderBy(desc(dingtalkApprovalRuleRuns.createdAt), desc(dingtalkApprovalRuleRuns.id))
      .limit(limit);
  };

  countActive = async (): Promise<number> => {
    const [row] = await this.db
      .select({ count: count() })
      .from(dingtalkApprovalRules)
      .where(and(eq(dingtalkApprovalRules.userId, this.userId), activeCondition()));
    return row?.count ?? 0;
  };

  static listAllActiveRules = async (db: ApprovalRuleDb): Promise<DingtalkApprovalRuleItem[]> => {
    return db
      .select()
      .from(dingtalkApprovalRules)
      .where(activeCondition())
      .orderBy(dingtalkApprovalRules.processCode, dingtalkApprovalRules.id);
  };

  static adminList = async (
    db: ApprovalRuleDb,
    opts?: { page?: number; pageSize?: number; q?: string },
  ): Promise<DingtalkApprovalRuleAdminListResult> => {
    const page = Math.max(opts?.page ?? 1, 1);
    const pageSize = clampLimit(opts?.pageSize, DEFAULT_ADMIN_PAGE_SIZE, MAX_ADMIN_PAGE_SIZE);
    const q = opts?.q?.trim();

    const filters: SQL[] = [];
    if (q) {
      const pattern = `%${q}%`;
      filters.push(
        or(
          ilike(dingtalkApprovalRules.name, pattern),
          ilike(dingtalkApprovalRules.processName, pattern),
          ilike(dingtalkApprovalRules.processCode, pattern),
          ilike(users.fullName, pattern),
          ilike(users.email, pattern),
          ilike(users.username, pattern),
        )!,
      );
    }

    const where = filters.length > 0 ? and(...filters) : undefined;

    const [totalRow] = await db
      .select({ count: count() })
      .from(dingtalkApprovalRules)
      .innerJoin(users, eq(dingtalkApprovalRules.userId, users.id))
      .where(where);

    const items = await db
      .select({
        action: dingtalkApprovalRules.action,
        conditions: dingtalkApprovalRules.conditions,
        createdAt: dingtalkApprovalRules.createdAt,
        createdByTopicId: dingtalkApprovalRules.createdByTopicId,
        dailyCount: dingtalkApprovalRules.dailyCount,
        dailyCountDate: dingtalkApprovalRules.dailyCountDate,
        disabledReason: dingtalkApprovalRules.disabledReason,
        enabled: dingtalkApprovalRules.enabled,
        expiresAt: dingtalkApprovalRules.expiresAt,
        id: dingtalkApprovalRules.id,
        lastRunAt: dingtalkApprovalRules.lastRunAt,
        name: dingtalkApprovalRules.name,
        processCode: dingtalkApprovalRules.processCode,
        processName: dingtalkApprovalRules.processName,
        redirectToName: dingtalkApprovalRules.redirectToName,
        redirectToStaffId: dingtalkApprovalRules.redirectToStaffId,
        remark: dingtalkApprovalRules.remark,
        staffId: dingtalkApprovalRules.staffId,
        updatedAt: dingtalkApprovalRules.updatedAt,
        userDisplayName: users.fullName,
        userEmail: users.email,
        userId: dingtalkApprovalRules.userId,
      })
      .from(dingtalkApprovalRules)
      .innerJoin(users, eq(dingtalkApprovalRules.userId, users.id))
      .where(where)
      .orderBy(desc(dingtalkApprovalRules.createdAt), desc(dingtalkApprovalRules.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return { items, page, pageSize, total: totalRow?.count ?? 0 };
  };

  static adminDisable = async (
    db: ApprovalRuleDb,
    ruleId: string,
  ): Promise<DingtalkApprovalRuleItem | null> => {
    return DingtalkApprovalRuleModel.disable(db, ruleId, 'admin');
  };

  /**
   * Insert a run row. Used as the idempotency claim: the worker inserts
   * `status='failed'` + `error_code='IN_PROGRESS'` (see {@link RUN_CLAIM_IN_PROGRESS}).
   * ON CONFLICT DO NOTHING — returns false when `(rule_id, task_id)` already exists.
   */
  static recordRun = async (
    db: ApprovalRuleDb,
    run: DingtalkApprovalRuleRunInput,
  ): Promise<boolean> => {
    const rows = await db
      .insert(dingtalkApprovalRuleRuns)
      .values({
        action: run.action,
        errorCode: run.errorCode ?? null,
        id: idGenerator('dingtalkApprovalRuleRuns'),
        instanceTitle: run.instanceTitle ?? null,
        originatorName: run.originatorName ?? null,
        processInstanceId: run.processInstanceId,
        ruleId: run.ruleId,
        status: run.status,
        taskId: run.taskId,
        userId: run.userId,
      })
      .onConflictDoNothing({
        target: [dingtalkApprovalRuleRuns.ruleId, dingtalkApprovalRuleRuns.taskId],
      })
      .returning({ id: dingtalkApprovalRuleRuns.id });

    return rows.length > 0;
  };

  /**
   * Re-claim a stale in-progress row (crash between claim and execute).
   * Succeeds only when `error_code='IN_PROGRESS'` and `created_at` is older
   * than {@link RUN_CLAIM_STALE_MS}. Refreshes `created_at` so two workers
   * cannot both reclaim the same lease.
   */
  static reclaimStaleRun = async (
    db: ApprovalRuleDb,
    input: {
      now?: Date;
      ruleId: string;
      taskId: string;
    },
  ): Promise<boolean> => {
    const now = input.now ?? new Date();
    const staleBefore = new Date(now.getTime() - RUN_CLAIM_STALE_MS);
    const [row] = await db
      .update(dingtalkApprovalRuleRuns)
      .set({
        createdAt: now,
        errorCode: RUN_CLAIM_IN_PROGRESS,
        status: 'failed',
      })
      .where(
        and(
          eq(dingtalkApprovalRuleRuns.ruleId, input.ruleId),
          eq(dingtalkApprovalRuleRuns.taskId, input.taskId),
          eq(dingtalkApprovalRuleRuns.errorCode, RUN_CLAIM_IN_PROGRESS),
          lt(dingtalkApprovalRuleRuns.createdAt, staleBefore),
        ),
      )
      .returning({ id: dingtalkApprovalRuleRuns.id });
    return Boolean(row);
  };

  /**
   * Claim `(rule_id, task_id)`: insert an in-progress marker, or reclaim a
   * stale in-progress row. Returns `'inserted' | 'reclaimed' | false`.
   */
  static claimRun = async (
    db: ApprovalRuleDb,
    run: DingtalkApprovalRuleRunInput,
    now: Date = new Date(),
  ): Promise<'inserted' | 'reclaimed' | false> => {
    const inserted = await DingtalkApprovalRuleModel.recordRun(db, {
      ...run,
      errorCode: RUN_CLAIM_IN_PROGRESS,
      status: 'failed',
    });
    if (inserted) return 'inserted';
    const reclaimed = await DingtalkApprovalRuleModel.reclaimStaleRun(db, {
      now,
      ruleId: run.ruleId,
      taskId: run.taskId,
    });
    return reclaimed ? 'reclaimed' : false;
  };

  /**
   * Insert a synthetic skipped_quota row so over-cap is notified at most once
   * per Shanghai day without occupying a real `(rule_id, task_id)` claim.
   */
  static tryRecordQuotaNotify = async (
    db: ApprovalRuleDb,
    input: {
      action: DingtalkApprovalRuleRunInput['action'];
      date: string;
      ruleId: string;
      userId: string;
    },
  ): Promise<boolean> => {
    return DingtalkApprovalRuleModel.recordRun(db, {
      action: input.action,
      processInstanceId: 'quota',
      ruleId: input.ruleId,
      status: 'skipped_quota',
      taskId: quotaNotifyTaskId(input.date),
      userId: input.userId,
    });
  };

  /**
   * Finalize a claimed `(rule_id, task_id)` run. CAS: only matches while
   * `error_code='IN_PROGRESS'`, so a reclaim that already wrote a terminal
   * status cannot be overwritten and a double-finalize is a no-op.
   */
  static updateRun = async (
    db: ApprovalRuleDb,
    input: {
      errorCode?: string | null;
      ruleId: string;
      status: ApprovalRuleRunStatus;
      taskId: string;
    },
  ): Promise<boolean> => {
    const [row] = await db
      .update(dingtalkApprovalRuleRuns)
      .set({
        errorCode: input.errorCode ?? null,
        status: input.status,
      })
      .where(
        and(
          eq(dingtalkApprovalRuleRuns.ruleId, input.ruleId),
          eq(dingtalkApprovalRuleRuns.taskId, input.taskId),
          eq(dingtalkApprovalRuleRuns.errorCode, RUN_CLAIM_IN_PROGRESS),
        ),
      )
      .returning({ id: dingtalkApprovalRuleRuns.id });
    return Boolean(row);
  };

  /**
   * Release a claimed run so the next sweep can retry (e.g. DingTalk rate limit).
   */
  static deleteRun = async (
    db: ApprovalRuleDb,
    input: { ruleId: string; taskId: string },
  ): Promise<boolean> => {
    const rows = await db
      .delete(dingtalkApprovalRuleRuns)
      .where(
        and(
          eq(dingtalkApprovalRuleRuns.ruleId, input.ruleId),
          eq(dingtalkApprovalRuleRuns.taskId, input.taskId),
        ),
      )
      .returning({ id: dingtalkApprovalRuleRuns.id });
    return rows.length > 0;
  };

  /**
   * Atomic daily reservation. Resets to 1 when `daily_count_date` differs from
   * `date`; otherwise increments. Also stamps `last_run_at`.
   *
   * When `cap` is set, the UPDATE only matches if the date differs or
   * `daily_count < cap`. Returns `null` when the row is already at cap for
   * `date` (no increment). The counter never goes past `cap`.
   */
  static bumpDailyCount = async (
    db: ApprovalRuleDb,
    ruleId: string,
    date: string,
    opts?: { cap?: number | null },
  ): Promise<number | null> => {
    const cap = opts?.cap;
    const where =
      cap == null
        ? eq(dingtalkApprovalRules.id, ruleId)
        : and(
            eq(dingtalkApprovalRules.id, ruleId),
            or(
              sql`${dingtalkApprovalRules.dailyCountDate} IS DISTINCT FROM ${date}`,
              lt(dingtalkApprovalRules.dailyCount, cap),
            ),
          );

    const [row] = await db
      .update(dingtalkApprovalRules)
      .set({
        dailyCount: sql`
          CASE
            WHEN ${dingtalkApprovalRules.dailyCountDate} IS DISTINCT FROM ${date} THEN 1
            ELSE ${dingtalkApprovalRules.dailyCount} + 1
          END
        `,
        dailyCountDate: date,
        lastRunAt: new Date(),
      })
      .where(where)
      .returning({ dailyCount: dingtalkApprovalRules.dailyCount });

    if (cap == null) return row?.dailyCount ?? 0;
    return row?.dailyCount ?? null;
  };

  /**
   * Undo one same-day increment (rate-limit release / abandoned claim).
   */
  static rollbackDailyCount = async (
    db: ApprovalRuleDb,
    ruleId: string,
    date: string,
  ): Promise<number> => {
    const [row] = await db
      .update(dingtalkApprovalRules)
      .set({
        dailyCount: sql`
          CASE
            WHEN ${dingtalkApprovalRules.dailyCountDate} IS NOT DISTINCT FROM ${date}
              AND ${dingtalkApprovalRules.dailyCount} > 0
            THEN ${dingtalkApprovalRules.dailyCount} - 1
            ELSE ${dingtalkApprovalRules.dailyCount}
          END
        `,
      })
      .where(eq(dingtalkApprovalRules.id, ruleId))
      .returning({ dailyCount: dingtalkApprovalRules.dailyCount });

    return row?.dailyCount ?? 0;
  };

  static disable = async (
    db: ApprovalRuleDb,
    ruleId: string,
    reason: ApprovalRuleDisabledReason,
  ): Promise<DingtalkApprovalRuleItem | null> => {
    const [row] = await db
      .update(dingtalkApprovalRules)
      .set({ disabledReason: reason, enabled: false })
      .where(eq(dingtalkApprovalRules.id, ruleId))
      .returning();
    return row ?? null;
  };

  static truncateExpiry = async (
    db: ApprovalRuleDb,
    maxExpiresAt: Date,
  ): Promise<DingtalkApprovalRuleItem[]> => {
    return db
      .update(dingtalkApprovalRules)
      .set({ expiresAt: maxExpiresAt })
      .where(
        or(
          isNull(dingtalkApprovalRules.expiresAt),
          gt(dingtalkApprovalRules.expiresAt, maxExpiresAt),
        ),
      )
      .returning();
  };

  /**
   * Rules whose expiry is still null or at/over `maxExpiresAt` (timestamp or
   * the same Asia/Shanghai calendar day as the cap). Used to notify owners
   * after a strict-tier save when `truncateExpiry` matches nothing because a
   * previous pass already shortened them.
   */
  static listRulesAtOrOverMaxExpiry = async (
    db: ApprovalRuleDb,
    maxExpiresAt: Date,
  ): Promise<DingtalkApprovalRuleItem[]> => {
    return db
      .select()
      .from(dingtalkApprovalRules)
      .where(
        or(
          isNull(dingtalkApprovalRules.expiresAt),
          gte(dingtalkApprovalRules.expiresAt, maxExpiresAt),
          sql`(${dingtalkApprovalRules.expiresAt} AT TIME ZONE 'Asia/Shanghai')::date >= (${maxExpiresAt}::timestamptz AT TIME ZONE 'Asia/Shanghai')::date`,
        ),
      );
  };
}
