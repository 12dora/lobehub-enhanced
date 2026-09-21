import { inArray } from 'drizzle-orm';

import { dingtalkDirectoryUsers } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { resolveStaff } from '@/server/enterprise/services/dingtalkWorkspace/directory';
import { DingtalkWorkspaceError } from '@/server/enterprise/services/dingtalkWorkspace/errors';

export interface DingtalkStaffRef {
  deptPath: string;
  name: string;
  staffId: string;
  unionId: string;
}

export interface DingtalkStaffCandidate {
  deptPath: string;
  name: string;
  staffId: string;
}

export const failWorkspace = (code: DingtalkWorkspaceError['code']): never => {
  throw new DingtalkWorkspaceError(code);
};

export const failAmbiguous = (candidates: DingtalkStaffCandidate[]): never => {
  const error = new DingtalkWorkspaceError('DINGTALK_AMBIGUOUS');
  Object.assign(error, { candidates });
  throw error;
};

const asCandidate = (value: unknown): DingtalkStaffCandidate | null => {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.staffId !== 'string' || typeof row.name !== 'string') return null;
  return {
    deptPath: typeof row.deptPath === 'string' ? row.deptPath : '',
    name: row.name,
    staffId: row.staffId,
  };
};

const isResolvedStaff = (value: unknown): value is DingtalkStaffRef => {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.staffId === 'string' &&
    typeof row.unionId === 'string' &&
    typeof row.name === 'string' &&
    !('ambiguous' in row) &&
    !('notFound' in row)
  );
};

export const resolveStaffToken = async (
  db: LobeChatDatabase,
  token: string,
): Promise<DingtalkStaffRef> => {
  const trimmed = token.trim();
  if (!trimmed) return failWorkspace('DINGTALK_INVALID');
  const result = await resolveStaff(db, trimmed);
  if (isResolvedStaff(result)) {
    if (!result.unionId) return failWorkspace('DINGTALK_NOT_FOUND');
    return {
      deptPath: result.deptPath ?? '',
      name: result.name,
      staffId: result.staffId,
      unionId: result.unionId,
    };
  }
  if (result && typeof result === 'object' && 'ambiguous' in result) {
    const candidates = Array.isArray(result.ambiguous)
      ? result.ambiguous.map(asCandidate).filter((item): item is DingtalkStaffCandidate => !!item)
      : [];
    return failAmbiguous(candidates);
  }
  const suggestions =
    result &&
    typeof result === 'object' &&
    'suggestions' in result &&
    Array.isArray(result.suggestions)
      ? result.suggestions.map(asCandidate).filter((item): item is DingtalkStaffCandidate => !!item)
      : [];
  if (suggestions.length > 0) return failAmbiguous(suggestions);
  return failWorkspace('DINGTALK_NOT_FOUND');
};

export const resolveStaffTokens = async (
  db: LobeChatDatabase,
  tokens: string[] | undefined,
  limit: number,
): Promise<DingtalkStaffRef[]> => {
  if (!tokens || tokens.length === 0) return [];
  if (tokens.length > limit) return failWorkspace('DINGTALK_INVALID');
  const resolved: DingtalkStaffRef[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const staff = await resolveStaffToken(db, token);
    if (seen.has(staff.unionId)) continue;
    seen.add(staff.unionId);
    resolved.push(staff);
  }
  return resolved;
};

export const toStaffToken = (staffId: string): string =>
  staffId.startsWith('staff:') ? staffId : `staff:${staffId}`;

/**
 * Map calendar/todo unionIds back to staff:<id> tokens from the directory
 * mirror. Directory misses are omitted (callers keep displayName + unresolved).
 * Query failures propagate as DINGTALK_UNAVAILABLE — never an empty map that
 * would wipe every token on the page.
 */
export const lookupStaffByUnionIds = async (
  db: LobeChatDatabase,
  unionIds: string[],
): Promise<Map<string, DingtalkStaffRef>> => {
  const unique = [...new Set(unionIds.map((id) => id.trim()).filter(Boolean))];
  const result = new Map<string, DingtalkStaffRef>();
  if (unique.length === 0) return result;
  if (typeof db?.select !== 'function') return result;
  try {
    const rows = await db
      .select({
        deptPath: dingtalkDirectoryUsers.deptPath,
        name: dingtalkDirectoryUsers.name,
        staffId: dingtalkDirectoryUsers.staffId,
        unionId: dingtalkDirectoryUsers.unionId,
      })
      .from(dingtalkDirectoryUsers)
      .where(inArray(dingtalkDirectoryUsers.unionId, unique));
    for (const row of rows) {
      if (!row.unionId || !row.staffId) continue;
      result.set(row.unionId, {
        deptPath: row.deptPath ?? '',
        name: row.name,
        staffId: row.staffId,
        unionId: row.unionId,
      });
    }
  } catch (error) {
    if (error instanceof DingtalkWorkspaceError) throw error;
    return failWorkspace('DINGTALK_UNAVAILABLE');
  }
  return result;
};

export const formatStaffLabel = (staff: Pick<DingtalkStaffRef, 'name' | 'deptPath'>): string =>
  staff.deptPath ? `${staff.name} · ${staff.deptPath}` : staff.name;

export const actingAsFromIdentity = async (
  db: LobeChatDatabase,
  identity: { name: string; staffId: string },
): Promise<{ deptPath: string; name: string }> => {
  try {
    const self = await resolveStaffToken(db, `staff:${identity.staffId}`);
    return { deptPath: self.deptPath, name: self.name || identity.name };
  } catch {
    return { deptPath: '', name: identity.name };
  }
};
