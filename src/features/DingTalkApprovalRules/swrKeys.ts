import { mutate } from '@/libs/swr';

/**
 * SWR keys of the 自动审批规则 reads, in one place so every mutation (停用 /
 * 启用 / 删除) invalidates the same caches.
 *
 * `mutate` from `@/libs/swr` is the workspace-scoped one; concrete keys are
 * augmented with the active workspace id, which is why the invalidation below
 * uses a predicate instead of the literal tuples.
 */
export const APPROVAL_RULE_KEY_PREFIX = 'dingtalkApprovalRule:';

export const APPROVAL_RULE_LIST_KEY = 'dingtalkApprovalRule:list';
export const APPROVAL_RULE_RUNS_KEY = 'dingtalkApprovalRule:listRuns';

/** Key of the rule table. */
export const approvalRuleListKey = () => [APPROVAL_RULE_LIST_KEY] as const;

/** Key of one rule's run history; `null` keeps the drawer from fetching while closed. */
export const approvalRuleRunsKey = (ruleId?: string | null) =>
  ruleId ? ([APPROVAL_RULE_RUNS_KEY, ruleId] as const) : null;

/** Revalidate the rule table and every open run history after a mutation. */
export const mutateApprovalRuleLists = () =>
  mutate(
    (key: unknown) =>
      Array.isArray(key) &&
      typeof key[0] === 'string' &&
      (key[0] as string).startsWith(APPROVAL_RULE_KEY_PREFIX),
  );
