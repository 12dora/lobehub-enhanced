import { mutate } from '@/libs/swr';

/** SWR key of the platform-wide DingTalk approval-rule list. */
export const ADMIN_DINGTALK_APPROVAL_RULES_KEY = 'admin.dingtalkApprovalRules.list';

/**
 * `null` disables the request entirely — used while the operator's access is
 * still resolving or lacks SYSTEM_READ, so an unauthorized surface asks the
 * server for nothing.
 *
 * The search term and page are part of the key because the list is filtered and
 * paged server-side.
 */
export const buildAdminDingtalkApprovalRulesKey = (
  enabled: boolean,
  page: number,
  pageSize: number,
  q: string,
) => (enabled ? ([ADMIN_DINGTALK_APPROVAL_RULES_KEY, page, pageSize, q] as const) : null);

/** Revalidate every page of the list after a forced disable. */
export const invalidateAdminDingtalkApprovalRules = () =>
  mutate((key: unknown) => Array.isArray(key) && key[0] === ADMIN_DINGTALK_APPROVAL_RULES_KEY);
