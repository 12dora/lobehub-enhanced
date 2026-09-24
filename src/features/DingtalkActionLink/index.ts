import { APP_LINK_PATHS, DINGTALK_CONSOLE_LINKS } from '@lobechat/utils/appLink';

import { resolveActionHref } from '@/components/ActionLink/href';

/**
 * The page that fixes a DingTalk failure, by who has to act:
 * - member: `binding` (link the DingTalk identity), `personalAuthorize`, `approvalRules`, `patConfirm`
 * - AIHub admin: `adminImConnectors` (switches, CorpId, 服务号, automation tier)
 * - DingTalk org admin: `cliSettings` (开发者后台 → CLI 设置)
 */
export type DingtalkActionKind =
  | 'adminImConnectors'
  | 'approvalRules'
  | 'binding'
  | 'cliSettings'
  | 'patConfirm'
  | 'personalAuthorize';

export interface DingtalkAction {
  href: string;
  kind: DingtalkActionKind;
}

/** Kinds with a fixed target (everything but DingTalk's own per-call PAT page). */
export type FixedActionKind = Exclude<DingtalkActionKind, 'patConfirm'>;

export const DINGTALK_ACTION_HREF: Record<FixedActionKind, string> = {
  adminImConnectors: APP_LINK_PATHS.adminImConnectors,
  approvalRules: APP_LINK_PATHS.approvalRules,
  binding: APP_LINK_PATHS.dingtalkBinding,
  cliSettings: DINGTALK_CONSOLE_LINKS.cliSettings,
  personalAuthorize: APP_LINK_PATHS.dingtalkPersonalAuthorize,
};

/** `plugin` namespace labels, shared by the three DingTalk tool cards. */
export const DINGTALK_ACTION_PLUGIN_LABEL_KEY = {
  adminImConnectors: 'builtins.dingtalk.action.adminImConnectors',
  approvalRules: 'builtins.dingtalk.action.approvalRules',
  binding: 'builtins.dingtalk.action.binding',
  cliSettings: 'builtins.dingtalk.action.cliSettings',
  patConfirm: 'builtins.dingtalk.action.patConfirm',
  personalAuthorize: 'builtins.dingtalk.action.personalAuthorize',
} as const satisfies Record<DingtalkActionKind, string>;

/**
 * Stable codes of the workspace / approval / personal toolsets (and the personal login's
 * `ORG_CLI_DISABLED`). Codes nobody can fix from a page — an inactive identity, a missing OA
 * premium or approval-admin role — have no entry and stay text only.
 */
const KIND_BY_CODE = new Map<string, FixedActionKind>([
  ['DINGTALK_AUTOMATION_OFF', 'adminImConnectors'],
  ['DINGTALK_FEATURE_DISABLED', 'adminImConnectors'],
  ['DINGTALK_IDENTITY_UNBOUND', 'binding'],
  ['DINGTALK_IDENTITY_UNVERIFIED', 'binding'],
  ['DINGTALK_NOT_CONFIGURED', 'adminImConnectors'],
  ['DINGTALK_PERSONAL_CORP_ID_MISSING', 'adminImConnectors'],
  ['DINGTALK_PERSONAL_DISABLED', 'adminImConnectors'],
  ['DINGTALK_PERSONAL_EXPIRED', 'personalAuthorize'],
  ['DINGTALK_PERSONAL_FEATURE_DISABLED', 'adminImConnectors'],
  ['DINGTALK_PERSONAL_LOGIN_NOT_FOUND', 'personalAuthorize'],
  ['DINGTALK_PERSONAL_ORG_POLICY_DENIED', 'cliSettings'],
  ['DINGTALK_PERSONAL_UNAUTHORIZED', 'personalAuthorize'],
  ['DINGTALK_RULE_LIMIT', 'approvalRules'],
  ['ORG_CLI_DISABLED', 'cliSettings'],
]);

export const resolveDingtalkActionKind = (
  code: string | null | undefined,
): FixedActionKind | undefined => (code ? KIND_BY_CODE.get(code) : undefined);

const URL_IN_TEXT = /https:\/\/[^\s"'<>()[\]（）「」，。]+/;

/**
 * Where a transport may have put the service's `details`. A tRPC client error nests it under
 * `data.errorData` (the lambda error formatter exposes `cause.data` as `errorData`), so a URL in
 * error → data → errorData → details → message is read four levels down; the limit leaves one
 * level for a wrapper such as `{ error }`.
 */
const NESTED_KEYS = ['details', 'body', 'data', 'errorData', 'error', 'cause'] as const;

const MAX_DEPTH = 5;

const readUri = (value: unknown, depth = 0): string | undefined => {
  if (!value || depth > MAX_DEPTH) return undefined;

  if (typeof value === 'string') {
    const match = value.match(URL_IN_TEXT)?.[0];
    return match && resolveActionHref(match)?.external ? match : undefined;
  }
  if (typeof value !== 'object') return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ['uri', 'patUri']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && resolveActionHref(candidate)?.external)
      return candidate.trim();
  }
  for (const key of NESTED_KEYS) {
    const nested = readUri(record[key], depth + 1);
    if (nested) return nested;
  }

  return typeof record.message === 'string' ? readUri(record.message, depth + 1) : undefined;
};

/**
 * DingTalk's own permission page for `DINGTALK_PERSONAL_PAT_REQUIRED`: a `uri` field on the error or
 * the state, or the https URL the tool wrote into its message. https only.
 */
export const extractDingtalkPatUri = (...sources: unknown[]): string | undefined => {
  for (const source of sources) {
    const uri = readUri(source);
    if (uri) return uri;
  }
  return undefined;
};

/** The link a DingTalk failure card offers, or `undefined` when no page can fix it. */
export const resolveDingtalkAction = (
  code: string | null | undefined,
  options: { patUri?: string } = {},
): DingtalkAction | undefined => {
  if (code === 'DINGTALK_PERSONAL_PAT_REQUIRED') {
    const target = resolveActionHref(options.patUri);
    return target?.external ? { href: target.href, kind: 'patConfirm' } : undefined;
  }

  const kind = resolveDingtalkActionKind(code);
  return kind ? { href: DINGTALK_ACTION_HREF[kind], kind } : undefined;
};
