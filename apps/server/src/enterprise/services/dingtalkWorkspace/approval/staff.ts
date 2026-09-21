import { DingTalkDirectoryModel } from '@/database/models/dingtalkDirectory';
import type { LobeChatDatabase } from '@/database/type';

import { type DingtalkStaffCandidate, resolveStaff, type ResolveStaffResult } from '../directory';
import { DingtalkWorkspaceError } from '../errors';
import type { ProcessInstanceDetail } from './types';

const isHit = (value: ResolveStaffResult): value is DingtalkStaffCandidate =>
  'staffId' in value && !('ambiguous' in value) && !('notFound' in value);

export const formatStaffLabel = (staff: { deptPath?: string; name: string }): string =>
  staff.deptPath ? `${staff.name} · ${staff.deptPath}` : staff.name;

export const requireStaff = async (
  db: LobeChatDatabase,
  token: string,
): Promise<DingtalkStaffCandidate> => {
  const resolved = await resolveStaff(db, token);
  if (isHit(resolved)) return resolved;
  if ('ambiguous' in resolved) {
    const error = new DingtalkWorkspaceError('DINGTALK_AMBIGUOUS') as DingtalkWorkspaceError & {
      candidates: DingtalkStaffCandidate[];
    };
    error.candidates = resolved.ambiguous;
    throw error;
  }
  throw new DingtalkWorkspaceError('DINGTALK_NOT_FOUND');
};

export const requireStaffList = async (
  db: LobeChatDatabase,
  tokens: string[],
): Promise<DingtalkStaffCandidate[]> => {
  const staff: DingtalkStaffCandidate[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const hit = await requireStaff(db, token);
    if (seen.has(hit.staffId)) continue;
    seen.add(hit.staffId);
    staff.push(hit);
  }
  return staff;
};

export const actingAsFromIdentity = async (
  db: LobeChatDatabase,
  identity: { name: string; staffId: string },
): Promise<{ deptPath: string; name: string }> => {
  try {
    const staff = await requireStaff(db, `staff:${identity.staffId}`);
    return { deptPath: staff.deptPath, name: staff.name || identity.name };
  } catch {
    return { deptPath: '', name: identity.name };
  }
};

export const lookupStaffNames = async (
  db: LobeChatDatabase,
  staffIds: Array<string | undefined | null>,
): Promise<Map<string, string>> => {
  const unique = [
    ...new Set(
      staffIds.map((id) => (typeof id === 'string' ? id.trim() : '')).filter((id) => id.length > 0),
    ),
  ];
  if (unique.length === 0) return new Map();
  const users = await new DingTalkDirectoryModel(db).getUsers(unique);
  const names = new Map<string, string>();
  for (const user of users) {
    if (user.name) names.set(user.staffId, user.name);
  }
  return names;
};

const collectInstancePersonIds = (detail: ProcessInstanceDetail): string[] => {
  const ids: string[] = [detail.originatorUserId, ...detail.ccUserIds];
  for (const task of detail.tasks) ids.push(task.userId);
  for (const record of detail.operationRecords) {
    if (record.userId) ids.push(record.userId);
    if (record.ccUserIds) ids.push(...record.ccUserIds);
  }
  return ids;
};

const nameOf = (
  names: Map<string, string>,
  userId?: string,
  fallback?: string,
): string | undefined => (userId ? names.get(userId) : undefined) ?? fallback;

export const attachInstancePersonNames = async (
  db: LobeChatDatabase,
  detail: ProcessInstanceDetail,
): Promise<ProcessInstanceDetail> => {
  const names = await lookupStaffNames(db, collectInstancePersonIds(detail));
  return {
    ...detail,
    ccUsers: detail.ccUserIds.map((userId) => ({
      name: nameOf(names, userId),
      userId,
    })),
    operationRecords: detail.operationRecords.map((record) => ({
      ...record,
      ccUsers: record.ccUserIds?.map((userId) => ({
        name: nameOf(names, userId),
        userId,
      })),
      name: nameOf(names, record.userId, record.showName),
    })),
    originatorName: nameOf(names, detail.originatorUserId),
    tasks: detail.tasks.map((task) => ({
      ...task,
      name: nameOf(names, task.userId),
    })),
  };
};
