/**
 * The two failures that are not failures.
 *
 * `dingtalkApprovalRule.list` refuses a member whose DingTalk identity was never bound
 * (`DINGTALK_IDENTITY_UNBOUND`) or is not verified yet (`DINGTALK_IDENTITY_UNVERIFIED`). Production
 * logged both from members who simply signed in with email: nothing is broken, the page has nothing
 * to show them, and a 「加载失败，请重试」 with a Retry button invites them to keep asking a question
 * the server will keep answering the same way.
 *
 * The codes reach the client inside the TRPC error message (the router maps both to `FORBIDDEN`, so
 * the status alone cannot tell them from an administrator's refusal), which is why this scans the
 * serialized error rather than reading one field. Kept dependency-free so both the table and its
 * test can use it without standing up SWR.
 */

/** Codes that mean「this member has no DingTalk identity yet」, not「the request failed」. */
export const DINGTALK_IDENTITY_MISSING_CODES = [
  'DINGTALK_IDENTITY_UNBOUND',
  'DINGTALK_IDENTITY_UNVERIFIED',
] as const;

export type DingTalkIdentityMissingCode = (typeof DINGTALK_IDENTITY_MISSING_CODES)[number];

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    // A circular or non-serializable error still has a message worth scanning.
    return '';
  }
};

/**
 * The code the error carries, when it is one of the two.
 *
 * `DINGTALK_IDENTITY_INACTIVE` deliberately does not count: an identity that was bound and then
 * deactivated is a change the member (or an administrator) has to act on, so it keeps the ordinary
 * error state with its Retry.
 */
export const resolveDingTalkIdentityMissingCode = (
  error: unknown,
): DingTalkIdentityMissingCode | undefined => {
  if (!error) return undefined;

  const haystack =
    typeof error === 'string'
      ? error
      : `${(error as { message?: unknown }).message ?? ''} ${safeStringify(error)}`;

  return DINGTALK_IDENTITY_MISSING_CODES.find((code) => haystack.includes(code));
};

/** Whether the page should say「需使用钉钉登录」instead of「加载失败」. */
export const isDingTalkIdentityMissing = (error: unknown): boolean =>
  resolveDingTalkIdentityMissingCode(error) !== undefined;
