import { DingTalkDirectoryModel } from '@/database/models/dingtalkDirectory';
import type { LobeChatDatabase } from '@/database/type';

export const DINGTALK_STAFF_TOKEN_PREFIX = 'staff:';

export interface DingtalkStaffCandidate {
  deptPath: string;
  name: string;
  staffId: string;
  unionId: string;
}

export type ResolveStaffResult =
  | DingtalkStaffCandidate
  | { ambiguous: DingtalkStaffCandidate[] }
  | { notFound: true; suggestions: DingtalkStaffCandidate[] };

const parseStaffToken = (token: string): string | null => {
  const trimmed = token.trim();
  if (!trimmed.toLowerCase().startsWith(DINGTALK_STAFF_TOKEN_PREFIX)) return null;
  const id = trimmed.slice(DINGTALK_STAFF_TOKEN_PREFIX.length).trim();
  return id.length > 0 ? id : null;
};

const toCandidate = (row: {
  deptPath?: string;
  name: string;
  staffId: string;
  unionId?: string | null;
}): DingtalkStaffCandidate => ({
  deptPath: row.deptPath ?? '',
  name: row.name,
  staffId: row.staffId,
  unionId: typeof row.unionId === 'string' ? row.unionId : '',
});

const hydrate = async (
  directory: DingTalkDirectoryModel,
  staffIds: string[],
): Promise<DingtalkStaffCandidate[]> => {
  if (staffIds.length === 0) return [];
  const rows = await directory.getUsers(staffIds);
  const byId = new Map(rows.map((row) => [row.staffId, toCandidate(row)]));
  return staffIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
};

/**
 * Resolve a `staff:<id>` token or a directory name. Never guesses between
 * duplicate names — returns `ambiguous` instead.
 */
export const resolveStaff = async (
  db: LobeChatDatabase,
  token: string,
): Promise<ResolveStaffResult> => {
  const directory = new DingTalkDirectoryModel(db);
  const trimmed = token.trim();
  if (!trimmed) return { notFound: true, suggestions: [] };

  const staffId = parseStaffToken(trimmed);
  if (staffId) {
    const [row] = await directory.getUsers([staffId]);
    if (row) return toCandidate(row);
    return { notFound: true, suggestions: [] };
  }

  const hits = await directory.search(trimmed, { kind: 'user' });
  if (hits.users.length === 1) {
    const [full] = await directory.getUsers([hits.users[0]!.staffId]);
    if (full) return toCandidate(full);
    return toCandidate(hits.users[0]!);
  }
  if (hits.users.length > 1) {
    const ambiguous = await hydrate(
      directory,
      hits.users.map((user) => user.staffId),
    );
    return {
      ambiguous: ambiguous.length > 0 ? ambiguous : hits.users.map((user) => toCandidate(user)),
    };
  }

  const near = await directory.listActiveUsersNearName(trimmed);
  const suggestions = await hydrate(
    directory,
    near.map((user) => user.staffId),
  );
  // A miss may mean the mirror is stale (sync runs every 12 h): ask for an early
  // sync. The helper allows one walk per 6 h and remembers this name for 6 h.
  // Never blocks the lookup.
  void import('@/server/enterprise/services/dingtalkDirectory/sync')
    .then(({ requestDirectorySyncOnLookupMiss }) =>
      requestDirectorySyncOnLookupMiss(db, {}, trimmed),
    )
    .catch(() => undefined);
  return {
    notFound: true,
    suggestions: suggestions.length > 0 ? suggestions : near.map((user) => toCandidate(user)),
  };
};
