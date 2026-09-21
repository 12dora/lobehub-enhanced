export const DINGTALK_WORKSPACE_ERROR_CODES = [
  'DINGTALK_NOT_CONFIGURED',
  'DINGTALK_FEATURE_DISABLED',
  'DINGTALK_FORBIDDEN',
  'DINGTALK_PREMIUM_REQUIRED',
  'DINGTALK_NOT_FOUND',
  'DINGTALK_INVALID',
  'DINGTALK_RATE_LIMITED',
  'DINGTALK_UNAVAILABLE',
  'DINGTALK_IDENTITY_UNBOUND',
  'DINGTALK_IDENTITY_UNVERIFIED',
  'DINGTALK_IDENTITY_INACTIVE',
  'DINGTALK_NOT_TASK_OWNER',
  'DINGTALK_NOT_ORIGINATOR',
  'DINGTALK_NOT_APPROVAL_ADMIN',
  'DINGTALK_AUTOMATION_OFF',
  'DINGTALK_RULE_LIMIT',
  'DINGTALK_AMBIGUOUS',
] as const;

export type DingtalkWorkspaceErrorCode = (typeof DINGTALK_WORKSPACE_ERROR_CODES)[number];

const CODE_SET = new Set<string>(DINGTALK_WORKSPACE_ERROR_CODES);

export const isDingtalkWorkspaceErrorCode = (value: unknown): value is DingtalkWorkspaceErrorCode =>
  typeof value === 'string' && CODE_SET.has(value);

/**
 * Stable DingTalk workspace failure. `upstreamCode` is for logs only — never
 * put it in model-facing or client-facing copy. `missingScopes` are DingTalk
 * scope codes parsed from a 403 body (never the message text or apply URL).
 */
export class DingtalkWorkspaceError extends Error {
  readonly code: DingtalkWorkspaceErrorCode;
  readonly missingScopes?: string[];
  readonly upstreamCode?: string;

  constructor(
    code: DingtalkWorkspaceErrorCode,
    upstreamCode?: string,
    missingScopes?: readonly string[],
  ) {
    super(code);
    this.name = 'DingtalkWorkspaceError';
    this.code = code;
    if (upstreamCode) this.upstreamCode = upstreamCode;
    if (missingScopes && missingScopes.length > 0) {
      const unique: string[] = [];
      const seen = new Set<string>();
      for (const scope of missingScopes) {
        if (!scope || seen.has(scope)) continue;
        seen.add(scope);
        unique.push(scope);
      }
      if (unique.length > 0) this.missingScopes = unique;
    }
  }
}

export const DINGTALK_APPROVAL_TOOL_IDENTIFIER = 'lobe-dingtalk-approval';
export const DINGTALK_WORKSPACE_TOOL_IDENTIFIER = 'lobe-dingtalk-workspace';
