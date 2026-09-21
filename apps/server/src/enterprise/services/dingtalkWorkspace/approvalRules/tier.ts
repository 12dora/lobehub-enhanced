import type { ApprovalAutomationTier } from '@lobechat/types';
import { APPROVAL_AUTOMATION_TIERS } from '@lobechat/types';

import { DingtalkApprovalRuleModel } from '@/database/models/dingtalkApprovalRule';
import type { DingtalkApprovalRuleItem } from '@/database/schemas/dingtalkApprovalRule';
import type { LobeChatDatabase, Transaction } from '@/database/type';

import { notifyUser } from '../notify';

export const STRICT_MAX_EXPIRY_DAYS = 90;

const SHANGHAI = 'Asia/Shanghai';

export const addUtcDays = (now: Date, days: number): Date =>
  new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

export const formatShanghaiDate = (value: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: SHANGHAI,
    year: 'numeric',
  }).format(value);

/**
 * Truncate over-long expiries when the saved automation tier is strict.
 * Does **not** send work notices — the caller must notify after the
 * surrounding transaction commits, using {@link notifyAutomationTierTruncation}.
 *
 * Truncation is idempotent: whenever `next === 'strict'`, rules whose expiry
 * is null or beyond now+90d are shortened, even if `prev === next`. When the
 * UPDATE matches nothing, `rows` still includes owners whose expiry is at or
 * over the cap so a swallowed first notice can be retried.
 */
export const applyAutomationTierChange = async (
  db: LobeChatDatabase | Transaction,
  _prev: ApprovalAutomationTier,
  next: ApprovalAutomationTier,
  now: Date = new Date(),
): Promise<{ rows: DingtalkApprovalRuleItem[]; truncated: number }> => {
  if (next !== 'strict') return { rows: [], truncated: 0 };

  const maxExpiresAt = addUtcDays(now, STRICT_MAX_EXPIRY_DAYS);
  const affected = await DingtalkApprovalRuleModel.truncateExpiry(db, maxExpiresAt);
  if (affected.length > 0) return { rows: affected, truncated: affected.length };

  const atCap = await DingtalkApprovalRuleModel.listRulesAtOrOverMaxExpiry(db, maxExpiresAt);
  return { rows: atCap, truncated: 0 };
};

/** Best-effort work notices for rows returned by {@link applyAutomationTierChange}. */
export const notifyAutomationTierTruncation = async (
  rows: DingtalkApprovalRuleItem[],
  now: Date = new Date(),
): Promise<void> => {
  if (rows.length === 0) return;

  const dateLabel = formatShanghaiDate(addUtcDays(now, STRICT_MAX_EXPIRY_DAYS));
  const byStaff = new Map<string, DingtalkApprovalRuleItem[]>();
  for (const rule of rows) {
    const list = byStaff.get(rule.staffId) ?? [];
    list.push(rule);
    byStaff.set(rule.staffId, list);
  }

  await Promise.all(
    [...byStaff.entries()].map(async ([staffId, rules]) => {
      try {
        await notifyUser(staffId, {
          lines: [
            `自动审批档位已调整为严格，您有 ${rules.length} 条规则的有效期已缩短至 ${dateLabel}。`,
            ...rules.slice(0, 8).map((rule) => rule.name),
          ],
          title: '自动审批规则有效期已调整',
        });
      } catch (error) {
        console.error('[dingtalk-approval-rules] tier notify failed', {
          errorClass: error instanceof Error ? error.name : 'UnknownError',
        });
      }
    }),
  );
};

export const getAutomationTierLimits = (tier: ApprovalAutomationTier) =>
  APPROVAL_AUTOMATION_TIERS[tier];

/**
 * Under a tier with `maxExpiryDays`, rules with no expiry or an expiry past
 * `now + maxExpiryDays` must not execute (safety net if truncation failed).
 */
export const ruleExceedsTierMaxExpiry = (
  expiresAt: Date | string | null | undefined,
  maxExpiryDays: number | null,
  now: Date,
): boolean => {
  if (maxExpiryDays == null) return false;
  if (expiresAt == null || expiresAt === '') return true;
  const at = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return true;
  return at.getTime() > addUtcDays(now, maxExpiryDays).getTime();
};
