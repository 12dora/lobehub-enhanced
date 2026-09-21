import type { ApprovalRuleConditions } from '@lobechat/types';
import { inArray } from 'drizzle-orm';

import { DingTalkDirectoryModel } from '@/database/models/dingtalkDirectory';
import { dingtalkDepartments } from '@/database/schemas/dingtalkDirectory';
import type { LobeChatDatabase } from '@/database/type';

import { DINGTALK_DEPT_ID_PREFIX, DINGTALK_STAFF_ID_PREFIX, stripDingtalkIdPrefix } from './ids';

const uniqueIds = (values: Array<string | undefined> | undefined, prefix?: string): string[] => {
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const id = prefix ? stripDingtalkIdPrefix(trimmed, prefix) : trimmed;
    if (id) seen.add(id);
  }
  return [...seen];
};

export const collectOriginatorIds = (
  conditions: ApprovalRuleConditions | null | undefined,
): { deptIds: string[]; staffIds: string[] } => ({
  deptIds: uniqueIds(conditions?.originators?.deptIds, DINGTALK_DEPT_ID_PREFIX),
  staffIds: uniqueIds(conditions?.originators?.staffIds, DINGTALK_STAFF_ID_PREFIX),
});

export const pickOriginatorLabels = (
  conditions: ApprovalRuleConditions | null | undefined,
  allLabels: Record<string, string>,
): Record<string, string> => {
  const { deptIds, staffIds } = collectOriginatorIds(conditions);
  const picked: Record<string, string> = {};
  for (const id of [...staffIds, ...deptIds]) {
    const name = allLabels[id];
    if (name) picked[id] = name;
  }
  return picked;
};

/**
 * staffId / deptId → display name from the DingTalk directory mirror.
 * Missing directory rows are omitted (the UI then says "selected people").
 */
export const resolveOriginatorLabels = async (
  db: LobeChatDatabase,
  conditionsList: Array<ApprovalRuleConditions | null | undefined>,
): Promise<Record<string, string>> => {
  const staffIds = new Set<string>();
  const deptIds = new Set<string>();
  for (const conditions of conditionsList) {
    const ids = collectOriginatorIds(conditions);
    for (const id of ids.staffIds) staffIds.add(id);
    for (const id of ids.deptIds) deptIds.add(id);
  }
  if (staffIds.size === 0 && deptIds.size === 0) return {};

  const directory = new DingTalkDirectoryModel(db);
  const labels: Record<string, string> = {};

  if (staffIds.size > 0) {
    const users = await directory.getUsers([...staffIds]);
    for (const user of users) {
      if (user.staffId && user.name) labels[user.staffId] = user.name;
    }
  }

  if (deptIds.size > 0) {
    const departments = await db
      .select({ deptId: dingtalkDepartments.deptId, name: dingtalkDepartments.name })
      .from(dingtalkDepartments)
      .where(inArray(dingtalkDepartments.deptId, [...deptIds]));
    for (const department of departments) {
      if (department.deptId && department.name) labels[department.deptId] = department.name;
    }
  }

  return labels;
};
