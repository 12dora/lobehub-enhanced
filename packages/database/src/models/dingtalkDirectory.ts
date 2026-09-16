import { count, desc, eq, inArray, or, type SQL, sql, type SQLWrapper } from 'drizzle-orm';

import { escapeLike, likeContains } from '../repositories/platformSearch';
import type {
  DingTalkDepartmentItem,
  DingTalkDirectoryUserItem,
  NewDingTalkDepartment,
  NewDingTalkDirectoryUser,
  NewDingTalkUserDepartment,
} from '../schemas/dingtalkDirectory';
import {
  dingtalkDepartments,
  dingtalkDirectoryUsers,
  dingtalkUserDepartments,
} from '../schemas/dingtalkDirectory';
import type { LobeChatDatabase, Transaction } from '../type';
import { pinyinFull, pinyinInitials } from '../utils/pinyin';

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
const SUBTREE_DEPTH_LIMIT = 32;

export interface DirectoryUserHit {
  active: boolean;
  deptPath: string;
  leafDeptId: string | null;
  leafDeptName: string;
  name: string;
  staffId: string;
}

export interface DirectoryDepartmentHit {
  deptId: string;
  memberCount: number;
  name: string;
  pathNames: string;
}

export interface DingTalkDirectoryStats {
  departments: number;
  lastSyncedAt: Date | null;
  users: number;
}

export interface DingTalkDirectoryReplaceAllInput {
  departments: NewDingTalkDepartment[];
  memberships: NewDingTalkUserDepartment[];
  users: NewDingTalkDirectoryUser[];
}

interface DirectoryDeptIdRow {
  dept_id: string;
}

interface DirectoryStaffIdRow {
  staff_id: string;
}

const clampLimit = (limit?: number): number => {
  if (limit === undefined) return DEFAULT_SEARCH_LIMIT;
  return Math.min(Math.max(limit, 1), MAX_SEARCH_LIMIT);
};

const asQueryRows = <T>(result: { rows: T[] } | T[]): T[] =>
  Array.isArray(result) ? result : result.rows;

const withPinyin = <
  T extends { name: string; namePinyinFull?: string; namePinyinInitials?: string },
>(
  row: T,
): T => ({
  ...row,
  namePinyinFull: row.namePinyinFull ?? pinyinFull(row.name) ?? '',
  namePinyinInitials: row.namePinyinInitials ?? pinyinInitials(row.name) ?? '',
});

const buildNameSearchConditions = (
  q: string,
  columns: { name: SQLWrapper; pinyinFull: SQLWrapper; pinyinInitials: SQLWrapper },
): SQL => {
  const qLower = q.trim().toLowerCase();
  const contains = likeContains(qLower);
  const prefix = `${escapeLike(qLower)}%`;

  return or(
    sql`lower(${columns.name}) LIKE ${contains} ESCAPE '\\'`,
    sql`${columns.pinyinFull} LIKE ${prefix} ESCAPE '\\'`,
    sql`${columns.pinyinFull} LIKE ${contains} ESCAPE '\\'`,
    sql`${columns.pinyinInitials} LIKE ${prefix} ESCAPE '\\'`,
  )!;
};

/**
 * DingTalk org-chart mirror. Not user-scoped — the directory is tenant-global.
 */
export class DingTalkDirectoryModel {
  constructor(private readonly db: LobeChatDatabase) {}

  search = async (
    q: string,
    opts?: { kind?: 'department' | 'user'; limit?: number },
  ): Promise<{ departments: DirectoryDepartmentHit[]; users: DirectoryUserHit[] }> => {
    const trimmed = q.trim();
    if (!trimmed) return { departments: [], users: [] };

    const limit = clampLimit(opts?.limit);
    const kind = opts?.kind;
    const users: DirectoryUserHit[] = [];
    const departments: DirectoryDepartmentHit[] = [];

    if (kind !== 'department') {
      const rows = await this.db
        .select({
          active: dingtalkDirectoryUsers.active,
          deptPath: dingtalkDirectoryUsers.deptPath,
          leafDeptId: dingtalkDirectoryUsers.leafDeptId,
          leafDeptName: dingtalkDirectoryUsers.leafDeptName,
          name: dingtalkDirectoryUsers.name,
          staffId: dingtalkDirectoryUsers.staffId,
        })
        .from(dingtalkDirectoryUsers)
        .where(
          buildNameSearchConditions(trimmed, {
            name: dingtalkDirectoryUsers.name,
            pinyinFull: dingtalkDirectoryUsers.namePinyinFull,
            pinyinInitials: dingtalkDirectoryUsers.namePinyinInitials,
          }),
        )
        .orderBy(dingtalkDirectoryUsers.name, dingtalkDirectoryUsers.staffId)
        .limit(limit);

      users.push(...rows);
    }

    if (kind !== 'user') {
      const rows = await this.db
        .select({
          deptId: dingtalkDepartments.deptId,
          name: dingtalkDepartments.name,
          pathNames: dingtalkDepartments.pathNames,
        })
        .from(dingtalkDepartments)
        .where(
          buildNameSearchConditions(trimmed, {
            name: dingtalkDepartments.name,
            pinyinFull: dingtalkDepartments.namePinyinFull,
            pinyinInitials: dingtalkDepartments.namePinyinInitials,
          }),
        )
        .orderBy(dingtalkDepartments.sortOrder, dingtalkDepartments.deptId)
        .limit(limit);

      for (const row of rows) {
        const staffIds = await this.subtreeMemberStaffIds(row.deptId);
        departments.push({
          deptId: row.deptId,
          memberCount: staffIds.length,
          name: row.name,
          pathNames: row.pathNames,
        });
      }
    }

    return { departments, users };
  };

  getUsers = async (staffIds: string[]): Promise<DingTalkDirectoryUserItem[]> => {
    if (staffIds.length === 0) return [];
    return this.db
      .select()
      .from(dingtalkDirectoryUsers)
      .where(inArray(dingtalkDirectoryUsers.staffId, staffIds));
  };

  getDepartment = async (deptId: string): Promise<DingTalkDepartmentItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(dingtalkDepartments)
      .where(eq(dingtalkDepartments.deptId, deptId))
      .limit(1);
    return row;
  };

  subtreeDeptIds = async (deptId: string): Promise<string[]> => {
    const rows = asQueryRows<DirectoryDeptIdRow>(
      await this.db.execute<DirectoryDeptIdRow>(sql`
        WITH RECURSIVE subtree AS (
          SELECT ${dingtalkDepartments.deptId} AS dept_id, 0 AS depth
          FROM ${dingtalkDepartments}
          WHERE ${dingtalkDepartments.deptId} = ${deptId}
          UNION ALL
          SELECT ${dingtalkDepartments.deptId}, subtree.depth + 1
          FROM ${dingtalkDepartments}
          INNER JOIN subtree ON ${dingtalkDepartments.parentId} = subtree.dept_id
          WHERE subtree.depth < ${SUBTREE_DEPTH_LIMIT}
        )
        SELECT dept_id FROM subtree
      `),
    );
    return rows.map((row) => row.dept_id);
  };

  subtreeMemberStaffIds = async (deptId: string): Promise<string[]> => {
    const rows = asQueryRows<DirectoryStaffIdRow>(
      await this.db.execute<DirectoryStaffIdRow>(sql`
        WITH RECURSIVE subtree AS (
          SELECT ${dingtalkDepartments.deptId} AS dept_id, 0 AS depth
          FROM ${dingtalkDepartments}
          WHERE ${dingtalkDepartments.deptId} = ${deptId}
          UNION ALL
          SELECT ${dingtalkDepartments.deptId}, subtree.depth + 1
          FROM ${dingtalkDepartments}
          INNER JOIN subtree ON ${dingtalkDepartments.parentId} = subtree.dept_id
          WHERE subtree.depth < ${SUBTREE_DEPTH_LIMIT}
        )
        SELECT DISTINCT ${dingtalkDirectoryUsers.staffId} AS staff_id
        FROM ${dingtalkUserDepartments}
        INNER JOIN subtree ON ${dingtalkUserDepartments.deptId} = subtree.dept_id
        INNER JOIN ${dingtalkDirectoryUsers}
          ON ${dingtalkDirectoryUsers.staffId} = ${dingtalkUserDepartments.staffId}
        WHERE ${dingtalkDirectoryUsers.active} = true
      `),
    );
    return rows.map((row) => row.staff_id);
  };

  replaceAll = async (input: DingTalkDirectoryReplaceAllInput): Promise<void> => {
    const departments = input.departments.map((row) => withPinyin(row));
    const users = input.users.map((row) => withPinyin(row));

    await this.db.transaction(async (tx: Transaction) => {
      await tx.delete(dingtalkUserDepartments);
      await tx.delete(dingtalkDirectoryUsers);
      await tx.delete(dingtalkDepartments);

      if (departments.length > 0) {
        await tx.insert(dingtalkDepartments).values(departments);
      }
      if (users.length > 0) {
        await tx.insert(dingtalkDirectoryUsers).values(users);
      }
      if (input.memberships.length > 0) {
        await tx.insert(dingtalkUserDepartments).values(input.memberships);
      }
    });
  };

  stats = async (): Promise<DingTalkDirectoryStats> => {
    const [deptRow] = await this.db.select({ count: count() }).from(dingtalkDepartments);
    const [userRow] = await this.db.select({ count: count() }).from(dingtalkDirectoryUsers);
    const [syncRow] = await this.db
      .select({ lastSyncedAt: dingtalkDirectoryUsers.syncedAt })
      .from(dingtalkDirectoryUsers)
      .orderBy(desc(dingtalkDirectoryUsers.syncedAt))
      .limit(1);
    const [deptSyncRow] = await this.db
      .select({ lastSyncedAt: dingtalkDepartments.syncedAt })
      .from(dingtalkDepartments)
      .orderBy(desc(dingtalkDepartments.syncedAt))
      .limit(1);

    const userSynced = syncRow?.lastSyncedAt ?? null;
    const deptSynced = deptSyncRow?.lastSyncedAt ?? null;
    let lastSyncedAt: Date | null = userSynced;
    if (deptSynced && (!lastSyncedAt || deptSynced > lastSyncedAt)) {
      lastSyncedAt = deptSynced;
    }

    return {
      departments: deptRow?.count ?? 0,
      lastSyncedAt,
      users: userRow?.count ?? 0,
    };
  };
}
