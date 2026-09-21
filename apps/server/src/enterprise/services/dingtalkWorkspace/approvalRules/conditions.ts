import type { ApprovalRuleConditions } from '@lobechat/types';
import { eq } from 'drizzle-orm';

import { DingTalkDirectoryModel } from '@/database/models/dingtalkDirectory';
import { dingtalkApprovalRules } from '@/database/schemas/dingtalkApprovalRule';
import type { LobeChatDatabase } from '@/database/type';

import { type DingtalkStaffCandidate, resolveStaff, type ResolveStaffResult } from '../directory';
import { DingtalkWorkspaceError } from '../errors';
import {
  DINGTALK_DEPT_ID_PREFIX,
  DINGTALK_STAFF_ID_PREFIX,
  isSelfOriginatorAlias,
  stripDingtalkIdPrefix,
} from './ids';

export interface ApprovalOriginatorCandidate {
  deptId?: string;
  deptPath: string;
  name: string;
  staffId?: string;
}

export interface NormalizeStoredRuleConditionsResult {
  scanned: number;
  updated: number;
}

const isStaffHit = (value: ResolveStaffResult): value is DingtalkStaffCandidate =>
  'staffId' in value && !('ambiguous' in value) && !('notFound' in value);

const throwWorkspace: (code: DingtalkWorkspaceError['code']) => never = (code) => {
  throw new DingtalkWorkspaceError(code);
};

const throwAmbiguous: (candidates: ApprovalOriginatorCandidate[]) => never = (candidates) => {
  const error = new DingtalkWorkspaceError('DINGTALK_AMBIGUOUS');
  Object.assign(error, { candidates });
  throw error;
};

const uniquePreserve = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
};

const rewriteOriginatorIds = (
  values: string[] | undefined,
  prefix: string,
): string[] | undefined => {
  if (!values) return undefined;
  return uniquePreserve(
    values.map((value) => stripDingtalkIdPrefix(value, prefix)).filter(Boolean),
  );
};

/**
 * Idempotent rewrite used by the one-off production backfill: strip `staff:` /
 * `dept:` prefixes and de-duplicate. Does not call DingTalk or the directory.
 */
export const rewriteStoredRuleConditions = (
  conditions: ApprovalRuleConditions,
): ApprovalRuleConditions => {
  const originators = conditions.originators;
  if (!originators) return conditions;

  const staffIds = rewriteOriginatorIds(originators.staffIds, DINGTALK_STAFF_ID_PREFIX);
  const deptIds = rewriteOriginatorIds(originators.deptIds, DINGTALK_DEPT_ID_PREFIX);

  return {
    ...conditions,
    originators: {
      ...(originators.deptIds ? { deptIds: deptIds ?? [] } : {}),
      ...(originators.staffIds ? { staffIds: staffIds ?? [] } : {}),
    },
  };
};

const originatorsFingerprint = (conditions: ApprovalRuleConditions): string =>
  JSON.stringify({
    deptIds: conditions.originators?.deptIds ?? [],
    staffIds: conditions.originators?.staffIds ?? [],
  });

const resolveStaffOriginator = async (
  db: LobeChatDatabase,
  directory: DingTalkDirectoryModel,
  raw: string,
  identityStaffId: string,
): Promise<string> => {
  const trimmed = raw.trim();
  if (!trimmed) throwWorkspace('DINGTALK_INVALID');
  if (isSelfOriginatorAlias(trimmed)) return identityStaffId;

  const stripped = stripDingtalkIdPrefix(trimmed, DINGTALK_STAFF_ID_PREFIX);
  const hadPrefix = stripped !== trimmed;

  if (hadPrefix) {
    if (!stripped) throwWorkspace('DINGTALK_INVALID');
    const [row] = await directory.getUsers([stripped]);
    if (!row?.staffId) throwWorkspace('DINGTALK_NOT_FOUND');
    return row.staffId;
  }

  const [byId] = await directory.getUsers([trimmed]);
  if (byId?.staffId) return byId.staffId;

  const resolved = await resolveStaff(db, trimmed);
  if (isStaffHit(resolved)) return resolved.staffId;
  if ('ambiguous' in resolved) {
    throwAmbiguous(
      resolved.ambiguous.map((item) => ({
        deptPath: item.deptPath,
        name: item.name,
        staffId: item.staffId,
      })),
    );
  }
  throwWorkspace('DINGTALK_NOT_FOUND');
};

const resolveDeptOriginator = async (
  directory: DingTalkDirectoryModel,
  raw: string,
): Promise<string> => {
  const trimmed = raw.trim();
  if (!trimmed) throwWorkspace('DINGTALK_INVALID');

  const stripped = stripDingtalkIdPrefix(trimmed, DINGTALK_DEPT_ID_PREFIX);
  const hadPrefix = stripped !== trimmed;

  if (hadPrefix) {
    if (!stripped) throwWorkspace('DINGTALK_INVALID');
    const row = await directory.getDepartment(stripped);
    if (!row?.deptId) throwWorkspace('DINGTALK_NOT_FOUND');
    return row.deptId;
  }

  const byId = await directory.getDepartment(trimmed);
  if (byId?.deptId) return byId.deptId;

  const hits = await directory.search(trimmed, { kind: 'department' });
  if (hits.departments.length === 1) {
    const deptId = hits.departments[0]?.deptId;
    if (!deptId) throwWorkspace('DINGTALK_NOT_FOUND');
    return deptId;
  }
  if (hits.departments.length > 1) {
    throwAmbiguous(
      hits.departments.map((item) => ({
        deptId: item.deptId,
        deptPath: item.pathNames,
        name: item.name,
      })),
    );
  }
  throwWorkspace('DINGTALK_NOT_FOUND');
};

/**
 * Canonicalise originator ids on create/update/preview: strip `staff:`/`dept:`
 * prefixes, resolve plain names, accept 我/本人/me as the caller, de-duplicate,
 * reject unknown ids. Directory only — no DingTalk OpenAPI calls.
 */
export const normalizeApprovalRuleConditions = async (
  db: LobeChatDatabase,
  conditions: ApprovalRuleConditions,
  identityStaffId: string,
): Promise<ApprovalRuleConditions> => {
  const originators = conditions.originators;
  if (!originators) return conditions;

  const directory = new DingTalkDirectoryModel(db);
  const staffIds: string[] = [];
  for (const raw of originators.staffIds ?? []) {
    staffIds.push(await resolveStaffOriginator(db, directory, raw, identityStaffId));
  }
  const deptIds: string[] = [];
  for (const raw of originators.deptIds ?? []) {
    deptIds.push(await resolveDeptOriginator(directory, raw));
  }

  const nextStaff = uniquePreserve(staffIds);
  const nextDept = uniquePreserve(deptIds);
  if (nextStaff.length === 0 && nextDept.length === 0) {
    return { ...conditions, originators: undefined };
  }
  return {
    ...conditions,
    originators: {
      ...(nextDept.length > 0 ? { deptIds: nextDept } : {}),
      ...(nextStaff.length > 0 ? { staffIds: nextStaff } : {}),
    },
  };
};

/**
 * One-off idempotent backfill: rewrite stored `staff:` / `dept:` originator
 * tokens to raw DingTalk ids. Commander runs this once against production.
 * Does not call DingTalk.
 */
export const normalizeStoredRuleConditions = async (
  db: LobeChatDatabase,
): Promise<NormalizeStoredRuleConditionsResult> => {
  const rows = await db
    .select({
      conditions: dingtalkApprovalRules.conditions,
      id: dingtalkApprovalRules.id,
    })
    .from(dingtalkApprovalRules);

  let updated = 0;
  for (const row of rows) {
    const next = rewriteStoredRuleConditions(row.conditions);
    if (originatorsFingerprint(row.conditions) === originatorsFingerprint(next)) continue;
    await db
      .update(dingtalkApprovalRules)
      .set({ conditions: next })
      .where(eq(dingtalkApprovalRules.id, row.id));
    updated += 1;
  }
  return { scanned: rows.length, updated };
};
