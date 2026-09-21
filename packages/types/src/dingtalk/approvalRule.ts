/**
 * DingTalk approval-automation rule types (persisted on `dingtalk_approval_rules`).
 */

export type ApprovalRuleAction = 'agree' | 'comment' | 'redirect' | 'refuse';

export type ApprovalRuleDisabledReason =
  'admin' | 'expired' | 'identity_invalid' | 'tier_off' | 'user';

export type ApprovalRuleRunStatus = 'failed' | 'skipped_quota' | 'succeeded';

export type ApprovalAutomationTier = 'moderate' | 'off' | 'relaxed' | 'strict';

export type ApprovalRuleFieldOp = 'contains' | 'eq' | 'gt' | 'gte' | 'in' | 'lt' | 'lte' | 'ne';

export interface ApprovalRuleFieldCondition {
  componentId: string;
  label: string;
  op: ApprovalRuleFieldOp;
  value: number | string | string[];
}

export interface ApprovalRuleConditions {
  fields?: ApprovalRuleFieldCondition[];
  match: 'all';
  originators?: { deptIds?: string[]; staffIds?: string[] };
}

export interface ApprovalAutomationTierLimits {
  /** Default expiry in days when creating a rule; null = none. */
  defaultExpiryDays: number | null;
  /** When false, rules cannot be created or executed. */
  executable: boolean;
  /** Whether an expiry is required on every rule. */
  expiryRequired: boolean;
  /** Max expiry in days from now; null = unlimited. */
  maxExpiryDays: number | null;
  /** Per-rule daily execution cap; null = unlimited. */
  perRuleDailyCap: number | null;
}

export const APPROVAL_AUTOMATION_TIERS: Record<
  ApprovalAutomationTier,
  ApprovalAutomationTierLimits
> = {
  moderate: {
    defaultExpiryDays: null,
    executable: true,
    expiryRequired: false,
    maxExpiryDays: null,
    perRuleDailyCap: 50,
  },
  off: {
    defaultExpiryDays: null,
    executable: false,
    expiryRequired: false,
    maxExpiryDays: null,
    perRuleDailyCap: null,
  },
  relaxed: {
    defaultExpiryDays: null,
    executable: true,
    expiryRequired: false,
    maxExpiryDays: null,
    perRuleDailyCap: null,
  },
  strict: {
    defaultExpiryDays: 30,
    executable: true,
    expiryRequired: true,
    maxExpiryDays: 90,
    perRuleDailyCap: 20,
  },
};
