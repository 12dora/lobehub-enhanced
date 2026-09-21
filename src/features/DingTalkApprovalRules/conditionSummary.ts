import type { ApprovalRuleConditions, ApprovalRuleFieldCondition } from '@lobechat/types';
import type { TFunction } from 'i18next';

/**
 * Comparison symbols are read the same in every locale, so they stay in code;
 * only the two word operators come from the locale table.
 */
const OP_SYMBOL = {
  eq: '=',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  ne: '≠',
} as const;

/**
 * Explicit operator → key map. Building the key by template literal would need
 * an `as never` cast and silently survive a renamed or missing key.
 */
const WORD_OP_KEY = {
  contains: 'approvalRule.condition.op.contains',
  in: 'approvalRule.condition.op.in',
} as const;

const joinValues = (value: ApprovalRuleFieldCondition['value'], separator: string): string => {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? '').trim())
      .filter((item) => item.length > 0)
      .join(separator);
  }
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return String(value ?? '').trim();
};

const formatFieldClause = (
  field: ApprovalRuleFieldCondition,
  t: TFunction<'setting'>,
  listSeparator: string,
): string => {
  const label = field.label?.trim() || field.componentId?.trim();
  const value = joinValues(field.value, listSeparator);

  // A clause we cannot spell out is still a constraint: naming it generically
  // keeps the summary honest, where dropping it would claim the rule matches
  // every request of the template.
  if (!label || !value) return t('approvalRule.condition.otherField');

  const op =
    field.op === 'contains' || field.op === 'in' ? t(WORD_OP_KEY[field.op]) : OP_SYMBOL[field.op];

  if (!op) return t('approvalRule.condition.otherField');

  return t('approvalRule.condition.clause', { label, op, value });
};

/**
 * Human-readable summary of a rule's structured conditions, e.g.
 * 「发起人:张三、研发部;请假天数 ≤ 1」.
 *
 * Every clause of a rule has to hold (`match: 'all'`), so they are simply
 * joined. Originators are stored as DingTalk ids; `labels` carries the display
 * names the server resolved for them. Without a name for any of them the
 * summary says "selected people" rather than printing raw staff ids — an id is
 * not an answer to "who does this rule cover?".
 *
 * A rule with no conditions matches every request of its template, which the
 * summary states explicitly instead of rendering an empty cell.
 */
export const buildRuleConditionSummary = (
  conditions: ApprovalRuleConditions | null | undefined,
  t: TFunction<'setting'>,
  labels?: Record<string, string> | null,
): string => {
  const listSeparator = t('approvalRule.condition.listSeparator');
  const clauses: string[] = [];

  const originatorIds = [
    ...(conditions?.originators?.staffIds ?? []),
    ...(conditions?.originators?.deptIds ?? []),
  ].filter((id) => typeof id === 'string' && id.length > 0);

  if (originatorIds.length > 0) {
    const names = originatorIds
      .map((id) => labels?.[id]?.trim())
      .filter((name): name is string => !!name);

    clauses.push(
      names.length > 0
        ? t('approvalRule.condition.originator', { targets: names.join(listSeparator) })
        : t('approvalRule.condition.originatorSpecific'),
    );
  }

  for (const field of conditions?.fields ?? []) {
    clauses.push(formatFieldClause(field, t, listSeparator));
  }

  if (clauses.length === 0) return t('approvalRule.condition.any');

  return clauses.join(t('approvalRule.condition.clauseSeparator'));
};
