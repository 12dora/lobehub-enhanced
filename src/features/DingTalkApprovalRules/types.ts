/**
 * UI-facing shapes of the 自动审批规则 payloads returned by
 * `dingtalkApprovalRuleService` (lambda router `dingtalkApprovalRule`).
 *
 * The unions come from `@lobechat/types`; the rows are kept local (and
 * intentionally tolerant — timestamps may arrive as ISO strings or `Date`, and
 * fields the server does not resolve are optional) so the table renders without
 * importing database row types.
 */
import type {
  ApprovalRuleAction,
  ApprovalRuleConditions,
  ApprovalRuleDisabledReason,
  ApprovalRuleRunStatus,
} from '@lobechat/types';

export type {
  ApprovalRuleAction,
  ApprovalRuleConditions,
  ApprovalRuleDisabledReason,
  ApprovalRuleFieldCondition,
  ApprovalRuleFieldOp,
  ApprovalRuleRunStatus,
} from '@lobechat/types';

/** One row of the 自动审批规则 table. */
export interface ApprovalRuleRow {
  action: ApprovalRuleAction;
  conditions?: ApprovalRuleConditions | null;
  /**
   * Executions allowed per day, resolved server-side from the automation tier:
   * a number caps the rule, `null` means unlimited. Absent when the server does
   * not report it — the cell then shows the count alone rather than a made-up cap.
   */
  dailyCap?: number | null;
  dailyCount?: number | null;
  /** Day the counter belongs to (Asia/Shanghai). A past day means today is 0. */
  dailyCountDate?: string | null;
  disabledReason?: ApprovalRuleDisabledReason | null;
  enabled: boolean;
  expiresAt?: Date | string | null;
  id: string;
  lastRunAt?: Date | string | null;
  name: string;
  /**
   * staffId / deptId → display name, resolved server-side. Without it the
   * condition summary says "selected people" instead of printing raw ids.
   */
  originatorLabels?: Record<string, string> | null;
  processName: string;
  redirectToName?: string | null;
  remark?: string | null;
}

/**
 * `list` payload. A bare array is also accepted (see `normalizeApprovalRuleList`)
 * so the table keeps working whichever shape the router settles on.
 */
export interface ApprovalRuleListPayload {
  rules: ApprovalRuleRow[];
}

/** One row of the run-history drawer. */
export interface ApprovalRuleRunRow {
  action: ApprovalRuleAction;
  createdAt: Date | string;
  errorCode?: string | null;
  id: string;
  instanceTitle?: string | null;
  originatorName?: string | null;
  status: ApprovalRuleRunStatus;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object';

/**
 * Accept either `ApprovalRuleRow[]` or `{ rules: ApprovalRuleRow[] }`. The rule
 * router is written in parallel with this page, so a shape disagreement must
 * degrade to "no rules" rather than to a crashed settings tab.
 */
export const normalizeApprovalRuleList = (raw: unknown): ApprovalRuleRow[] => {
  if (Array.isArray(raw)) return raw as ApprovalRuleRow[];
  if (isRecord(raw) && Array.isArray(raw.rules)) return raw.rules as ApprovalRuleRow[];
  return [];
};

/** Same tolerance for the run list. */
export const normalizeApprovalRuleRuns = (raw: unknown): ApprovalRuleRunRow[] => {
  if (Array.isArray(raw)) return raw as ApprovalRuleRunRow[];
  if (isRecord(raw) && Array.isArray(raw.runs)) return raw.runs as ApprovalRuleRunRow[];
  return [];
};
